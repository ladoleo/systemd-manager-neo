/*
 * Systemd Manager Neo
 * Copyright (C) 2026 Lado Leo
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
            groups = jsonStr ? JSON.parse(jsonStr) : {};
        } catch (e) {
            console.error('[Systemd Manager Neo] Error parsing groups:', e);
        }

        const groupedServices = new Set();
        Object.values(groups).forEach(groupArr => groupArr.forEach(s => groupedServices.add(s)));

        const standaloneFavorites = favorites.filter(s => !groupedServices.has(s));

        if (favorites.length === 0 && Object.keys(groups).length === 0) {
            const item = new PopupMenu.PopupMenuItem(_('List is empty. Open Settings.'));
            item.sensitive = false;
            this._servicesSection.addMenuItem(item);
            return;
        }

        const fetchServiceData = async (favName) => {
            const loadedSvc = loadedServices.find(s => s.name === favName);
            const isActive = loadedSvc ? (loadedSvc.activeState === 'active') : false;
            const isFailed = loadedSvc ? (loadedSvc.activeState === 'failed') : false; 
            
            let labelText = favName.replace('.service', '');

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
            return { favName, labelText, isActive, isFailed };
        };

        const buildServiceMenuItem = (data) => {
            const item = new PopupMenu.PopupSwitchMenuItem(data.labelText, data.isActive);
            
            const btnBox = new St.BoxLayout({
                vertical: false,
                style: 'margin-right: 14px; margin-left: 8px;' 
            });

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

            const restartBtn = new St.Button({
                child: new St.Icon({ icon_name: 'view-refresh-symbolic', icon_size: 16 }),
                style_class: 'button',
                style: 'border-radius: 6px;' 
            });
            restartBtn.connect('clicked', async () => {
                this.menu.close();
                Main.notify(_('Systemd Manager Neo'), _('Restarting: %s').replace('%s', data.favName));
                const success = await Systemd.restartService(data.favName);
                if (success) Main.notify(_('Systemd Manager Neo'), _('Restarted: %s').replace('%s', data.favName));
                else Main.notify(_('Systemd Manager Neo'), _('Error restarting: %s').replace('%s', data.favName));
            });

            btnBox.add_child(logBtn);
            btnBox.add_child(restartBtn);

            if (data.isFailed) {
                const errorIcon = new St.Icon({
                    icon_name: 'dialog-error-symbolic', icon_size: 16,
                    style: 'color: #ed333b; margin-left: 8px; margin-right: 4px;' 
                });
                btnBox.add_child(errorIcon);
            }

            item.insert_child_at_index(btnBox, 0);

            item.connect('toggled', async (i, state) => {
                let success = false;
                if (state) success = await Systemd.startService(data.favName);
                else success = await Systemd.stopService(data.favName);
                
                if (success) Main.notify(_('Systemd Manager Neo'), (state ? _('Started: %s') : _('Stopped: %s')).replace('%s', data.favName));
                else {
                    item.setToggleState(!state);
                    Main.notify(_('Systemd Manager Neo'), _('Error: Access denied or cancelled'));
                }
            });
            return item;
        };

        let hasGroupsRendered = false;
        for (const [groupName, groupServices] of Object.entries(groups)) {
            if (groupServices.length === 0) continue;
            hasGroupsRendered = true;

            const subMenu = new PopupMenu.PopupSubMenuMenuItem(groupName);

            // Завантажуємо статистику для сервісів цієї групи
            const groupDataPromises = groupServices.map(fetchServiceData);
            const groupItemsData = await Promise.all(groupDataPromises);

            // --- МІКРО-МОНІТОРИНГ ГРУПИ ---
            // Якщо хоча б один сервіс у групі має статус failed (впав)
            const hasFailedService = groupItemsData.some(data => data.isFailed);
            if (hasFailedService) {
                // Робимо текст групи червоним
                subMenu.label.set_style('color: #ed333b;');
                
                // Додаємо іконку помилки біля назви групи (індекс 2 - після тексту)
                const groupErrorIcon = new St.Icon({
                    icon_name: 'dialog-error-symbolic',
                    icon_size: 16,
                    style: 'color: #ed333b; margin-left: 6px;'
                });
                subMenu.insert_child_at_index(groupErrorIcon, 2);
            }
            // ------------------------------

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