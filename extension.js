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

        if (favorites.length === 0) {
            const item = new PopupMenu.PopupMenuItem(_('List is empty. Open Settings.'));
            item.sensitive = false;
            this._servicesSection.addMenuItem(item);
            return;
        }

        // Паралельно завантажуємо статистику для всіх сервісів
        const itemPromises = favorites.map(async (favName) => {
            const loadedSvc = loadedServices.find(s => s.name === favName);
            const isActive = loadedSvc ? (loadedSvc.activeState === 'active') : false;
            const isFailed = loadedSvc ? (loadedSvc.activeState === 'failed') : false; 
            
            let labelText = favName.replace('.service', '');

            if (isFailed) {
                labelText = `${labelText} [${_('FAILED')}]`;
            }

            // Якщо сервіс працює, витягуємо його статистику
            if (isActive && loadedSvc && loadedSvc.objectPath) {
                const stats = await Systemd.getServiceStats(loadedSvc.objectPath, loadedSvc.busType);
                let statParts = [];
                
                if (loadedSvc.subState) statParts.push(loadedSvc.subState);
                if (stats.uptime !== 'N/A') statParts.push(`UP: ${stats.uptime}`);
                if (stats.ram !== 'N/A') statParts.push(`RAM: ${stats.ram}`);
                
                if (statParts.length > 0) {
                    labelText += `   [${statParts.join(' | ')}]`;
                }
            }
            return { favName, labelText, isActive, isFailed }; 
        });

        // Чекаємо, поки всі дані зберуться
        const itemsData = await Promise.all(itemPromises);

        // Будуємо елементи меню
        itemsData.forEach(data => {
            const item = new PopupMenu.PopupSwitchMenuItem(data.labelText, data.isActive);
            
            // Контейнер для кнопок
            const btnBox = new St.BoxLayout({
                vertical: false,
                style: 'margin-right: 14px; margin-left: 8px;' 
            });

            // 1. Кнопка логів
            const logBtn = new St.Button({
                child: new St.Icon({ icon_name: 'utilities-terminal-symbolic', icon_size: 16 }),
                style_class: 'button',
                style: 'margin-right: 8px; border-radius: 6px;' 
            });
            logBtn.connect('clicked', () => {
                this.menu.close(); 
                
                const terminals = [
                    { bin: 'gnome-terminal', arg: '--' }, 
                    { bin: 'kgx', arg: '-e' },            
                    { bin: 'ptyxis', arg: '--' },         
                    { bin: 'terminator', arg: '-x' },
                    { bin: 'kitty', arg: '--' },
                    { bin: 'alacritty', arg: '-e' },
                    { bin: 'konsole', arg: '-e' },
                    { bin: 'xterm', arg: '-e' }           
                ];

                let launched = false;
                for (let t of terminals) {
                    if (GLib.find_program_in_path(t.bin)) {
                        GLib.spawn_command_line_async(`${t.bin} ${t.arg} journalctl -u ${data.favName} -f`);
                        launched = true;
                        break;
                    }
                }

                if (!launched) {
                    Main.notify(_('Systemd Manager Neo'), _('Terminal emulator not found!'));
                }
            });

            // 2. Кнопка рестарту
            const restartBtn = new St.Button({
                child: new St.Icon({ icon_name: 'view-refresh-symbolic', icon_size: 16 }),
                style_class: 'button',
                style: 'border-radius: 6px;' 
            });
            
            restartBtn.connect('clicked', async () => {
                this.menu.close();
                Main.notify(_('Systemd Manager Neo'), _('Restarting: %s').replace('%s', data.favName));
                
                const success = await Systemd.restartService(data.favName);
                if (success) {
                    Main.notify(_('Systemd Manager Neo'), _('Restarted: %s').replace('%s', data.favName));
                } else {
                    Main.notify(_('Systemd Manager Neo'), _('Error restarting: %s').replace('%s', data.favName));
                }
            });

            // Додаємо кнопки в контейнер
            btnBox.add_child(logBtn);
            btnBox.add_child(restartBtn);

            // 3. Іконка падіння (якщо сервіс впав)
            if (data.isFailed) {
                const errorIcon = new St.Icon({
                    icon_name: 'dialog-error-symbolic', 
                    icon_size: 16,
                    style: 'color: #ed333b; margin-left: 8px; margin-right: 4px;' 
                });
                btnBox.add_child(errorIcon);
            }

            // МАГІЯ ЛЕЙАУТУ: Вставляємо блок кнопок на самий початок рядка (індекс 0)
            item.insert_child_at_index(btnBox, 0);

            // Дія при кліку на тумблер
            item.connect('toggled', async (i, state) => {
                let success = false;
                if (state) {
                    success = await Systemd.startService(data.favName);
                } else {
                    success = await Systemd.stopService(data.favName);
                }
                
                if (success) {
                    Main.notify(_('Systemd Manager Neo'), (state ? _('Started: %s') : _('Stopped: %s')).replace('%s', data.favName));
                } else {
                    item.setToggleState(!state);
                    Main.notify(_('Systemd Manager Neo'), _('Error: Access denied or cancelled'));
                }
            });
            
            this._servicesSection.addMenuItem(item);
        });
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