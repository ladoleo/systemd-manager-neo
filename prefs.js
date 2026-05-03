/*
 * Systemd Manager Neo
 * Copyright (C) 2026 Lado Leo
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */

import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';
import Gio from 'gi://Gio';
import { ExtensionPreferences, gettext as _ } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

export default class SystemdManagerNeoPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        const page = new Adw.PreferencesPage();
        window.add(page);

        const group = new Adw.PreferencesGroup({
            title: _('Available Services'),
            description: _('Search and toggle services to show in the top panel.')
        });
        page.add(group);

        const searchEntry = new Gtk.SearchEntry({
            placeholder_text: _('Search services...'),
            margin_bottom: 12
        });
        group.add(searchEntry);

        const listGroup = new Adw.PreferencesGroup();
        page.add(listGroup);

        const serviceRows = [];

        try {
            const sysConn = Gio.bus_get_sync(Gio.BusType.SYSTEM, null);
            const usrConn = Gio.bus_get_sync(Gio.BusType.SESSION, null);
            const favorites = settings.get_strv('favorite-services') || [];
            const uniqueServices = new Set();
            
            const processFiles = (connection, isSystem) => {
                try {
                    const result = connection.call_sync('org.freedesktop.systemd1', '/org/freedesktop/systemd1', 'org.freedesktop.systemd1.Manager', 'ListUnitFiles', null, null, Gio.DBusCallFlags.NONE, -1, null);
                    const filesArray = result.recursiveUnpack()[0];
                    
                    filesArray.forEach(unit => {
                        // Витягуємо чисту назву файлу зі шляху
                        const name = unit[0].substring(unit[0].lastIndexOf('/') + 1);
                        if (!name.endsWith('.service')) return;
                        
                        // Уникаємо дублікатів
                        if (uniqueServices.has(name)) return;
                        uniqueServices.add(name);

                        const row = new Adw.ActionRow({ title: name });
                        const typeLabel = isSystem ? _('System') : _('User');
                        row.subtitle = `${typeLabel} | ${_('State')}: ${unit[1]}`;

                        const toggle = new Gtk.Switch({
                            active: favorites.includes(name),
                            valign: Gtk.Align.CENTER
                        });

                        toggle.connect('state-set', (sw, switchState) => {
                            let current = settings.get_strv('favorite-services') || [];
                            if (switchState) {
                                if (!current.includes(name)) current.push(name);
                            } else {
                                current = current.filter(s => s !== name);
                            }
                            settings.set_strv('favorite-services', current);
                            return false;
                        });

                        row.add_suffix(toggle);
                        listGroup.add(row);
                        serviceRows.push({ row, name: name.toLowerCase() });
                    });
                } catch (e) {}
            };

            // Запускаємо парсинг обох шин
            processFiles(sysConn, true);
            processFiles(usrConn, false);

        } catch (e) {
            console.error('[Systemd Manager Neo] Error loading service files:', e);
        }

        searchEntry.connect('search-changed', () => {
            const text = searchEntry.get_text().toLowerCase();
            serviceRows.forEach(item => {
                item.row.set_visible(item.name.includes(text));
            });
        });
    }
}