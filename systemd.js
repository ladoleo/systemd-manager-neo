/*
 * Systemd Manager Neo
 * Copyright (C) 2026 Lado Leo
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

function getSysConn() { return Gio.bus_get_sync(Gio.BusType.SYSTEM, null); }
function getUsrConn() { return Gio.bus_get_sync(Gio.BusType.SESSION, null); }

// Helper formatting functions for UI display
function formatUptime(ms) {
    const totalSec = Math.floor(ms / 1000);
    const d = Math.floor(totalSec / 86400);
    const h = Math.floor((totalSec % 86400) / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    let parts = [];
    if (d > 0) parts.push(`${d}d`);
    if (h > 0) parts.push(`${h}h`);
    if (m > 0) parts.push(`${m}m`);
    if (parts.length === 0) return '<1m';
    return parts.join(' ');
}

function formatBytes(bytes) {
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

export async function getLoadedServices() {
    const units = [];
    
    try {
        const resSys = await getSysConn().call('org.freedesktop.systemd1', '/org/freedesktop/systemd1', 'org.freedesktop.systemd1.Manager', 'ListUnits', null, null, Gio.DBusCallFlags.NONE, -1, null);
        const unitsSys = resSys.recursiveUnpack()[0];
        unitsSys.forEach(unit => {
            const name = unit[0];
            if (name.endsWith('.service') || name.endsWith('.timer') || name.endsWith('.socket')) {
                units.push({
                    name: name,
                    description: unit[1],
                    loadState: unit[2],
                    activeState: unit[3],
                    subState: unit[4],
                    objectPath: unit[6],
                    busType: 'system'
                });
            }
        });
    } catch(e) { console.error('[Systemd Manager Neo] System DBus Error:', e); }

    try {
        const resUsr = await getUsrConn().call('org.freedesktop.systemd1', '/org/freedesktop/systemd1', 'org.freedesktop.systemd1.Manager', 'ListUnits', null, null, Gio.DBusCallFlags.NONE, -1, null);
        const unitsUsr = resUsr.recursiveUnpack()[0];
        unitsUsr.forEach(unit => {
            const name = unit[0];
            if (name.endsWith('.service') || name.endsWith('.timer') || name.endsWith('.socket')) {
                units.push({
                    name: name,
                    description: unit[1],
                    loadState: unit[2],
                    activeState: unit[3],
                    subState: unit[4],
                    objectPath: unit[6],
                    busType: 'user'
                });
            }
        });
    } catch(e) { console.error('[Systemd Manager Neo] User DBus Error:', e); }

    return units;
}

// FIXED: Robust DBus property extractor (bypasses recursiveUnpack bugs)
async function getDBusPropertySafe(conn, objectPath, iface, propName) {
    try {
        const res = await conn.call('org.freedesktop.systemd1', objectPath, 'org.freedesktop.DBus.Properties', 'Get', new GLib.Variant('(ss)', [iface, propName]), null, Gio.DBusCallFlags.NONE, -1, null);
        const v = res.get_child_value(0).get_variant(); // Extract inner variant safely
        const typeStr = v.get_type_string();
        
        if (typeStr === 's' || typeStr === 'o') return v.get_string()[0];
        if (typeStr === 't' || typeStr === 'u') return Number(v.get_uint64 ? v.get_uint64() : v.get_uint32());
        
        if (v.deepUnpack) return v.deepUnpack();
        if (v.recursiveUnpack) return v.recursiveUnpack();
        return v.unpack();
    } catch (e) {
        return null;
    }
}

export async function getServiceStats(objectPath, busType) {
    const conn = busType === 'system' ? getSysConn() : getUsrConn();
    let uptimeStr = 'N/A', ramStr = 'N/A', fragmentPath = 'N/A';

    const ts = await getDBusPropertySafe(conn, objectPath, 'org.freedesktop.systemd1.Unit', 'ActiveEnterTimestamp');
    if (ts && ts > 0) uptimeStr = formatUptime(Date.now() - (ts / 1000));

    const mem = await getDBusPropertySafe(conn, objectPath, 'org.freedesktop.systemd1.Service', 'MemoryCurrent');
    if (mem && mem > 0 && mem < 9007199254740991) ramStr = formatBytes(mem);

    const path = await getDBusPropertySafe(conn, objectPath, 'org.freedesktop.systemd1.Unit', 'FragmentPath');
    if (path) fragmentPath = path;

    return { uptime: uptimeStr, ram: ramStr, fragmentPath: fragmentPath };
}

async function fallbackSystemctl(cmdAction, unitName, busType) {
    try {
        // Automatically check if running inside a sandbox (Flatpak)
        let isFlatpak = GLib.file_test('/.flatpak-info', GLib.FileTest.EXISTS);
        let cmd = busType === 'system' 
            ? ['pkexec', 'systemctl', cmdAction, unitName]
            : ['systemctl', '--user', cmdAction, unitName];
            
        if (isFlatpak) {
            cmd = ['flatpak-spawn', '--host'].concat(cmd);
        }
            
        const proc = Gio.Subprocess.new(cmd, Gio.SubprocessFlags.NONE);
        return await new Promise((resolve) => {
            proc.wait_async(null, (p, res) => {
                try {
                    p.wait_finish(res);
                    resolve(p.get_successful());
                } catch (e) { resolve(false); }
            });
        });
    } catch (e) { return false; }
}

async function executeAction(unitName, action, busType) {
    const args = new GLib.Variant('(ss)', [unitName, 'replace']);
    const conn = busType === 'system' ? getSysConn() : getUsrConn();
    
    try {
        await conn.call('org.freedesktop.systemd1', '/org/freedesktop/systemd1', 'org.freedesktop.systemd1.Manager', action, args, null, Gio.DBusCallFlags.ALLOW_INTERACTIVE_AUTHORIZATION, -1, null);
        return true;
    } catch (e) {
        const cmdAction = action.replace('Unit', '').toLowerCase(); 
        return await fallbackSystemctl(cmdAction, unitName, busType);
    }
}

export async function getTimerNextRun(objectPath, busType) {
    try {
        const conn = busType === 'system' ? getSysConn() : getUsrConn();
        const res = await conn.call('org.freedesktop.systemd1', objectPath, 'org.freedesktop.DBus.Properties', 'Get', new GLib.Variant('(ss)', ['org.freedesktop.systemd1.Timer', 'NextElapseUSecRealtime']), null, Gio.DBusCallFlags.NONE, -1, null);
        const usec = res.get_child_value(0).get_variant().get_uint64();
        if (usec > 0) return new Date(Number(usec) / 1000).toLocaleString();
    } catch(e) {}
    return 'N/A';
}

export async function startService(unitName, busType) { return await executeAction(unitName, 'StartUnit', busType); }
export async function stopService(unitName, busType) { return await executeAction(unitName, 'StopUnit', busType); }
export async function restartService(unitName, busType) { return await executeAction(unitName, 'RestartUnit', busType); }

export async function enableService(unitName, busType) {
    const conn = busType === 'system' ? getSysConn() : getUsrConn();
    const args = new GLib.Variant('(asbb)', [[unitName], false, true]);
    try {
        await conn.call('org.freedesktop.systemd1', '/org/freedesktop/systemd1', 'org.freedesktop.systemd1.Manager', 'EnableUnitFiles', args, null, Gio.DBusCallFlags.ALLOW_INTERACTIVE_AUTHORIZATION, -1, null);
        await conn.call('org.freedesktop.systemd1', '/org/freedesktop/systemd1', 'org.freedesktop.systemd1.Manager', 'Reload', null, null, Gio.DBusCallFlags.NONE, -1, null);
        return true;
    } catch (e) {
        return await fallbackSystemctl('enable', unitName, busType);
    }
}

export async function disableService(unitName, busType) {
    const conn = busType === 'system' ? getSysConn() : getUsrConn();
    const args = new GLib.Variant('(asb)', [[unitName], false]);
    try {
        await conn.call('org.freedesktop.systemd1', '/org/freedesktop/systemd1', 'org.freedesktop.systemd1.Manager', 'DisableUnitFiles', args, null, Gio.DBusCallFlags.ALLOW_INTERACTIVE_AUTHORIZATION, -1, null);
        await conn.call('org.freedesktop.systemd1', '/org/freedesktop/systemd1', 'org.freedesktop.systemd1.Manager', 'Reload', null, null, Gio.DBusCallFlags.NONE, -1, null);
        return true;
    } catch (e) {
        return await fallbackSystemctl('disable', unitName, busType);
    }
}

export async function getUnitDetails(unitName, busType) {
    let activeState = 'N/A', subState = 'N/A', fragmentPath = 'N/A', uptime = 'N/A', ram = 'N/A';
    const conn = busType === 'system' ? getSysConn() : getUsrConn();
    let objectPath = null;

    try {
        try {
            const pathRes = await conn.call('org.freedesktop.systemd1', '/org/freedesktop/systemd1', 'org.freedesktop.systemd1.Manager', 'GetUnit', new GLib.Variant('(s)', [unitName]), null, Gio.DBusCallFlags.NONE, -1, null);
            objectPath = pathRes.get_child_value(0).get_string()[0];
        } catch (e) {
            const loadRes = await conn.call('org.freedesktop.systemd1', '/org/freedesktop/systemd1', 'org.freedesktop.systemd1.Manager', 'LoadUnit', new GLib.Variant('(s)', [unitName]), null, Gio.DBusCallFlags.NONE, -1, null);
            objectPath = loadRes.get_child_value(0).get_string()[0];
        }

        if (objectPath) {
            const aState = await getDBusPropertySafe(conn, objectPath, 'org.freedesktop.systemd1.Unit', 'ActiveState');
            if (aState) activeState = aState;

            const sState = await getDBusPropertySafe(conn, objectPath, 'org.freedesktop.systemd1.Unit', 'SubState');
            if (sState) subState = sState;

            const stats = await getServiceStats(objectPath, busType);
            if (stats.fragmentPath !== 'N/A') fragmentPath = stats.fragmentPath;
            if (stats.uptime !== 'N/A') uptime = stats.uptime;
            if (stats.ram !== 'N/A') ram = stats.ram;
        }
    } catch (e) {
        console.error(`[Systemd Manager Neo] Details Error for ${unitName}:`, e);
    }

    // Ultimate Fallback: Parse `systemctl show` if DBus entirely failed us
    if (fragmentPath === 'N/A' || activeState === 'N/A') {
        try {
            let isFlatpak = GLib.file_test('/.flatpak-info', GLib.FileTest.EXISTS);
            let cmd = busType === 'system' 
                ? ['systemctl', 'show', unitName, '--property=ActiveState,SubState,FragmentPath,ActiveEnterTimestampMonotonic,MemoryCurrent'] 
                : ['systemctl', '--user', 'show', unitName, '--property=ActiveState,SubState,FragmentPath,ActiveEnterTimestampMonotonic,MemoryCurrent'];
            
            if (isFlatpak) cmd = ['flatpak-spawn', '--host'].concat(cmd);

            const proc = Gio.Subprocess.new(cmd, Gio.SubprocessFlags.STDOUT_PIPE);
            const stdout = await new Promise((resolve) => {
                proc.communicate_utf8_async(null, null, (p, res) => {
                    try { resolve(p.communicate_utf8_finish(res)[1] || ''); } catch (e) { resolve(''); }
                });
            });

            stdout.split('\n').forEach(line => {
                const parts = line.split('=');
                if (parts.length < 2) return;
                const k = parts[0];
                const val = parts.slice(1).join('=');

                if (k === 'ActiveState' && activeState === 'N/A') activeState = val;
                if (k === 'SubState' && subState === 'N/A') subState = val;
                if (k === 'FragmentPath' && val && fragmentPath === 'N/A') fragmentPath = val;
                if (k === 'MemoryCurrent' && val !== '[not set]' && val !== 'infinity' && ram === 'N/A') {
                    const bytes = parseInt(val, 10);
                    if (!isNaN(bytes) && bytes > 0) ram = formatBytes(bytes);
                }
                if (k === 'ActiveEnterTimestampMonotonic' && val !== '0' && uptime === 'N/A') {
                    const usec = parseInt(val, 10);
                    if (!isNaN(usec) && usec > 0) {
                        const nowMonotonic = GLib.get_monotonic_time();
                        const diffMs = (nowMonotonic - usec) / 1000;
                        if (diffMs > 0) uptime = formatUptime(diffMs);
                    }
                }
            });
        } catch (e) {}
    }

    return { activeState, subState, fragmentPath, uptime, ram };
}