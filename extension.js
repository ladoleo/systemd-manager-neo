/*
 * Systemd Manager Neo
 * Copyright (C) 2026 Lado Leo
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */

import { Extension, gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import GObject from 'gi://GObject';
import St from 'gi://St';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as Systemd from './systemd.js';
import GLib from 'gi://GLib';

const Indicator = GObject.registerClass(
class Indicator extends PanelMenu.Button {
    _init(extension) {
        super._init(0.0, _('Systemd Manager Neo'));
        this._extension = extension;
        this._settings = extension.getSettings();

        this.add_child(new St.Icon({
            icon_name: 'face-devilish-symbolic',
            style_class: 'system-status-icon',
        }));

        this._servicesSection = new PopupMenu.PopupMenuSection();
        this.menu.addMenuItem(this._servicesSection);
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        const prefsItem = new PopupMenu.PopupImageMenuItem(_('Settings'), 'preferences-system-symbolic');
        prefsItem.connect('activate', () => this._extension.openPreferences());
        this.menu.addMenuItem(prefsItem);

        this._onOpenId = this.menu.connect('open-state-changed', (m, open) => {
            if (open) this._buildMenu();
        });
    }

    async _buildMenu() {
        this._servicesSection.removeAll();
        
        const loadedServices = await Systemd.getLoadedServices(); 
        const favorites = this._settings.get_strv('favorite-services') || [];

        let groups = {};
        try {
            const jsonStr = this._settings.get_string('service-groups');
            const raw = jsonStr ? JSON.parse(jsonStr) : {};
            // Handle dynamic migration for older service group formats
            for (const [k, v] of Object.entries(raw)) {
                if (Array.isArray(v)) {
                    groups[k] = { type: 'service', services: v };
                } else {
                    groups[k] = v;
                }
            }
        } catch (e) {
            console.error('[Systemd Manager Neo] Error parsing groups:', e);
        }

        const groupedServices = new Set();
        Object.values(groups).forEach(groupData => {
            groupData.services.forEach(s => groupedServices.add(s));
        });

        const standaloneFavorites = favorites.filter(s => !groupedServices.has(s));

        if (favorites.length === 0 && Object.keys(groups).length === 0) {
            const item = new PopupMenu.PopupMenuItem(_('List is empty. Open Settings.'));
            item.sensitive = false;
            this._servicesSection.addMenuItem(item);
            return;
        }

        const fetchServiceData = async (favName) => {
            const loadedSvc = loadedServices.find(s => s.name === favName);
            const timerName = favName.replace('.service', '.timer');
            const loadedTimer = loadedServices.find(s => s.name === timerName);
            
            const hasTimer = !!loadedTimer;
            
            let isActive = loadedSvc ? (loadedSvc.activeState === 'active') : false;
            let isFailed = loadedSvc ? (loadedSvc.activeState === 'failed') : false; 
            
            let timerIsActive = false;
            let labelText = favName.replace('.service', '');
            let timerText = null;
            
            if (hasTimer) {
                timerIsActive = (loadedTimer.activeState === 'active');
                if (loadedTimer.activeState === 'failed') isFailed = true;
                
                if (timerIsActive) {
                    const nextRun = await Systemd.getTimerNextRun(loadedTimer.objectPath, loadedTimer.busType);
                    if (nextRun !== 'N/A') {
                        timerText = `${_('Next run:')} ${nextRun}`;
                    } else {
                        timerText = _('Timer is active');
                    }
                } else {
                    timerText = _('Timer stopped');
                }
            }

            if (isFailed) {
                labelText = `${labelText} [${_('FAILED')}]`;
            }

            if (isActive && loadedSvc && loadedSvc.objectPath) {
                const stats = await Systemd.getServiceStats(loadedSvc.objectPath, loadedSvc.busType);
                let statParts = [];
                
                if (loadedSvc.subState) statParts.push(loadedSvc.subState);
                if (stats.uptime !== 'N/A') statParts.push(`UP: ${stats.uptime}`);
                if (stats.ram !== 'N/A') statParts.push(`RAM: ${stats.ram}`);
                
                if (statParts.length > 0) labelText += `   [${statParts.join(' | ')}]`;
            }

            return { favName, timerName, labelText, isActive, isFailed, hasTimer, timerIsActive, timerText };
        };

        const buildServiceMenuItem = (data) => {
            const item = new PopupMenu.PopupBaseMenuItem({ activate: false });

            // 1. БЛОК ТЕКСТУ (Завжди зліва)
            const labelBox = new St.BoxLayout({ vertical: true, x_expand: true });
            labelBox.set_style('margin-left: 8px;');
            
            const mainLabel = new St.Label({ text: data.labelText });
            labelBox.add_child(mainLabel);

            if (data.hasTimer && data.timerText) {
                const subLabel = new St.Label({ 
                    text: data.timerText, 
                    style: `font-size: 85%; ${data.timerIsActive ? 'opacity: 0.7;' : 'color: #ed333b;'}` 
                });
                subLabel.opacity = data.timerIsActive ? 255 : 150;
                labelBox.add_child(subLabel);
            }
            item.add_child(labelBox);

            // 2. БЛОК КНОПОК КЕРУВАННЯ (Справа)
            const btnBox = new St.BoxLayout({
                vertical: false,
                style: 'margin-right: 14px; margin-left: 8px;' 
            });

            if (data.hasTimer) {
                const timerIcon = new St.Icon({
                    icon_name: 'weather-hourly-symbolic',
                    icon_size: 16
                });

                const timerBtn = new St.Button({
                    child: timerIcon,
                    style_class: 'button',
                    style: 'border-radius: 6px; margin-right: 8px;'
                });
                
                timerBtn.opacity = data.timerIsActive ? 255 : 100;
                
                timerBtn.connect('clicked', async () => {
                    this.menu.close();
                    let success = false;
                    if (data.timerIsActive) {
                        Main.notify(_('Systemd Manager Neo'), _('Stopping timer: %s').replace('%s', data.timerName));
                        success = await Systemd.stopService(data.timerName);
                    } else {
                        Main.notify(_('Systemd Manager Neo'), _('Starting timer: %s').replace('%s', data.timerName));
                        success = await Systemd.startService(data.timerName);
                    }
                    if (success) {
                        Main.notify(_('Systemd Manager Neo'), (data.timerIsActive ? _('Timer stopped: %s') : _('Timer started: %s')).replace('%s', data.timerName));
                    } else {
                        Main.notify(_('Systemd Manager Neo'), _('Error: Access denied or cancelled'));
                    }
                });
                btnBox.add_child(timerBtn);
            }

            if (data.isFailed) {
                const errorIcon = new St.Icon({
                    icon_name: 'dialog-error-symbolic', icon_size: 16,
                    style: 'color: #ed333b; margin-right: 8px;' 
                });
                btnBox.add_child(errorIcon);
            }

            const logBtn = new St.Button({
                child: new St.Icon({ icon_name: 'utilities-terminal-symbolic', icon_size: 16 }),
                style_class: 'button',
                style: 'margin-right: 8px; border-radius: 6px;' 
            });
            logBtn.connect('clicked', () => {
                this.menu.close(); 
                const terminals = [
                    { bin: 'gnome-terminal', arg: '--' }, { bin: 'kgx', arg: '-e' },            
                    { bin: 'ptyxis', arg: '--' }, { bin: 'terminator', arg: '-x' },
                    { bin: 'kitty', arg: '--' }, { bin: 'alacritty', arg: '-e' },
                    { bin: 'konsole', arg: '-e' }, { bin: 'xterm', arg: '-e' }           
                ];

                let launched = false;
                for (let t of terminals) {
                    if (GLib.find_program_in_path(t.bin)) {
                        GLib.spawn_command_line_async(`${t.bin} ${t.arg} journalctl -u ${data.favName} -f`);
                        launched = true;
                        break;
                    }
                }
                if (!launched) Main.notify(_('Systemd Manager Neo'), _('Terminal emulator not found!'));
            });
            btnBox.add_child(logBtn);

            const actionIconName = data.hasTimer ? 'media-playback-start-symbolic' : 'view-refresh-symbolic';
            const actionBtn = new St.Button({
                child: new St.Icon({ icon_name: actionIconName, icon_size: 16 }),
                style_class: 'button',
                style: 'border-radius: 6px;' 
            });
            actionBtn.connect('clicked', async () => {
                this.menu.close();
                if (data.hasTimer) {
                    Main.notify(_('Systemd Manager Neo'), _('Starting: %s').replace('%s', data.favName));
                    const success = await Systemd.startService(data.favName);
                    if (success) Main.notify(_('Systemd Manager Neo'), _('Started: %s').replace('%s', data.favName));
                    else Main.notify(_('Systemd Manager Neo'), _('Error starting: %s').replace('%s', data.favName));
                } else {
                    Main.notify(_('Systemd Manager Neo'), _('Restarting: %s').replace('%s', data.favName));
                    const success = await Systemd.restartService(data.favName);
                    if (success) Main.notify(_('Systemd Manager Neo'), _('Restarted: %s').replace('%s', data.favName));
                    else Main.notify(_('Systemd Manager Neo'), _('Error restarting: %s').replace('%s', data.favName));
                }
            });
            btnBox.add_child(actionBtn);

            item.add_child(btnBox);

            if (!data.hasTimer) {
                const stateSwitch = new PopupMenu.Switch(data.isActive);
                item.add_child(stateSwitch);
                item.connect('activate', () => { stateSwitch.toggle(); });
                stateSwitch.connect('notify::state', async () => {
                    const state = stateSwitch.state;
                    let success = false;
                    if (state) success = await Systemd.startService(data.favName);
                    else success = await Systemd.stopService(data.favName);
                    
                    if (success) {
                        Main.notify(_('Systemd Manager Neo'), (state ? _('Started: %s') : _('Stopped: %s')).replace('%s', data.favName));
                    } else {
                        stateSwitch.set_state(!state);
                        Main.notify(_('Systemd Manager Neo'), _('Error: Access denied or cancelled'));
                    }
                });
            }
            
            return item;
        };

        let hasGroupsRendered = false;
        for (const [groupName, groupData] of Object.entries(groups)) {
            const groupType = groupData.type;
            const groupServices = groupData.services;

            if (groupServices.length === 0) continue;
            hasGroupsRendered = true;

            const subMenu = new PopupMenu.PopupSubMenuMenuItem(groupName);

            // ДОДАЄМО СИМВОЛЬНУ ІКОНКУ ТАЙМЕРА (замість емодзі)
            if (groupType === 'timer') {
                const groupTimerIcon = new St.Icon({
                    icon_name: 'weather-hourly-symbolic',
                    icon_size: 16,
                    style: 'margin-left: 6px; opacity: 0.7;'
                });
                subMenu.insert_child_at_index(groupTimerIcon, 2);
            }

            const groupDataPromises = groupServices.map(fetchServiceData);
            const groupItemsData = await Promise.all(groupDataPromises);

            const hasFailedService = groupItemsData.some(data => data.isFailed);
            if (hasFailedService) {
                subMenu.label.set_style('color: #ed333b;');
                const groupErrorIcon = new St.Icon({
                    icon_name: 'dialog-error-symbolic',
                    icon_size: 16,
                    style: 'color: #ed333b; margin-left: 6px;'
                });
                // Вставляємо іконку помилки після іконки таймера (на індекс 3), якщо вона є
                subMenu.insert_child_at_index(groupErrorIcon, groupType === 'timer' ? 3 : 2);
            }

            // МАCОВИЙ ЗАПУСК - Додаємо ТІЛЬКИ якщо це група звичайних сервісів
            if (groupType !== 'timer') {
                const startAllItem = new PopupMenu.PopupImageMenuItem(_('Start All'), 'media-playback-start-symbolic');
                startAllItem.connect('activate', async () => {
                    this.menu.close();
                    Main.notify(_('Systemd Manager Neo'), _('Starting group: %s').replace('%s', groupName));
                    let successCount = 0;
                    for (let s of groupServices) {
                        if (await Systemd.startService(s)) successCount++;
                    }
                    Main.notify(_('Systemd Manager Neo'), _('Group started: %s (%d/%d)').replace('%s', groupName).replace('%d', successCount).replace('%d', groupServices.length));
                });
                subMenu.menu.addMenuItem(startAllItem);

                const stopAllItem = new PopupMenu.PopupImageMenuItem(_('Stop All'), 'media-playback-stop-symbolic');
                stopAllItem.connect('activate', async () => {
                    this.menu.close();
                    Main.notify(_('Systemd Manager Neo'), _('Stopping group: %s').replace('%s', groupName));
                    let successCount = 0;
                    for (let s of groupServices) {
                        if (await Systemd.stopService(s)) successCount++;
                    }
                    Main.notify(_('Systemd Manager Neo'), _('Group stopped: %s (%d/%d)').replace('%s', groupName).replace('%d', successCount).replace('%d', groupServices.length));
                });
                subMenu.menu.addMenuItem(stopAllItem);

                subMenu.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
            }

            groupItemsData.forEach(data => {
                const uiItem = buildServiceMenuItem(data);
                subMenu.menu.addMenuItem(uiItem);
            });

            this._servicesSection.addMenuItem(subMenu);
        }

        if (standaloneFavorites.length > 0) {
            if (hasGroupsRendered) {
                this._servicesSection.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
            }

            const standaloneDataPromises = standaloneFavorites.map(fetchServiceData);
            const standaloneItemsData = await Promise.all(standaloneDataPromises);

            standaloneItemsData.forEach(data => {
                const uiItem = buildServiceMenuItem(data);
                this._servicesSection.addMenuItem(uiItem);
            });
        }
    }

    destroy() {
        if (this._onOpenId) {
            this.menu.disconnect(this._onOpenId);
            this._onOpenId = null;
        }
        super.destroy();
    }
});

export default class SystemdManagerNeoExtension extends Extension {
    enable() {
        this._indicator = new Indicator(this);
        Main.panel.addToStatusArea(this.uuid, this._indicator);
    }

    disable() {
        if (this._indicator) {
            this._indicator.destroy();
            this._indicator = null;
        }
    }
}