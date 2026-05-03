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

// Допоміжні функції форматування
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
    let services = [];
    
    const processUnits = (res, bus) => {
        if (!res) return;
        res.recursiveUnpack()[0].forEach(u => {
            if (u[0].endsWith('.service')) {
                services.push({ 
                    name: u[0], 
                    activeState: u[3],
                    subState: u[4],
                    objectPath: u[6], // Шлях до об'єкта для отримання статистики
                    busType: bus
                });
            }
        });
    };

    try {
        const sysRes = await getSysConn().call('org.freedesktop.systemd1', '/org/freedesktop/systemd1', 'org.freedesktop.systemd1.Manager', 'ListUnits', null, null, Gio.DBusCallFlags.NONE, -1, null);
        processUnits(sysRes, 'system');
    } catch (e) {}

    try {
        const usrRes = await getUsrConn().call('org.freedesktop.systemd1', '/org/freedesktop/systemd1', 'org.freedesktop.systemd1.Manager', 'ListUnits', null, null, Gio.DBusCallFlags.NONE, -1, null);
        processUnits(usrRes, 'session');
    } catch (e) {}

    return services;
}

// Нова функція отримання статистики
export async function getServiceStats(objectPath, busType) {
    const conn = busType === 'system' ? getSysConn() : getUsrConn();
    let uptimeStr = 'N/A';
    let ramStr = 'N/A';

    try {
        // Отримуємо час старту
        const timeRes = await conn.call('org.freedesktop.systemd1', objectPath, 'org.freedesktop.DBus.Properties', 'Get', new GLib.Variant('(ss)', ['org.freedesktop.systemd1.Unit', 'ActiveEnterTimestamp']), null, Gio.DBusCallFlags.NONE, -1, null);
        const timeMicros = timeRes.recursiveUnpack()[0];
        if (timeMicros > 0) {
            const diffMs = Date.now() - (timeMicros / 1000);
            uptimeStr = formatUptime(diffMs);
        }
    } catch(e) {}

    try {
        // Отримуємо споживання RAM
        const memRes = await conn.call('org.freedesktop.systemd1', objectPath, 'org.freedesktop.DBus.Properties', 'Get', new GLib.Variant('(ss)', ['org.freedesktop.systemd1.Service', 'MemoryCurrent']), null, Gio.DBusCallFlags.NONE, -1, null);
        const memVal = memRes.recursiveUnpack()[0];
        // Якщо моніторинг пам'яті вимкнено, systemd повертає гігантське число (MaxUint64)
        if (memVal > 0 && memVal < Number.MAX_SAFE_INTEGER) {
            ramStr = formatBytes(memVal);
        }
    } catch(e) {}

    return { uptime: uptimeStr, ram: ramStr };
}

async function executeAction(unitName, action) {
    const args = new GLib.Variant('(ss)', [unitName, 'replace']);
    try {
        await getSysConn().call('org.freedesktop.systemd1', '/org/freedesktop/systemd1', 'org.freedesktop.systemd1.Manager', action, args, null, Gio.DBusCallFlags.ALLOW_INTERACTIVE_AUTHORIZATION, -1, null);
        return true;
    } catch (eSys) {
        try {
            await getUsrConn().call('org.freedesktop.systemd1', '/org/freedesktop/systemd1', 'org.freedesktop.systemd1.Manager', action, args, null, Gio.DBusCallFlags.ALLOW_INTERACTIVE_AUTHORIZATION, -1, null);
            return true;
        } catch (eUsr) {
            return false;
        }
    }
}

export async function startService(unitName) { return await executeAction(unitName, 'StartUnit'); }
export async function stopService(unitName) { return await executeAction(unitName, 'StopUnit'); }
export async function restartService(unitName) { return await executeAction(unitName, 'RestartUnit'); }