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
        this._settings = this.getSettings();
        this._allServices = new Set();
        
        // Масиви для зберігання створених рядків
        this._favRows = [];
        this._availRows = [];

        const page = new Adw.PreferencesPage();
        window.add(page);

        // Група 1: Обрані сервіси (можна сортувати)
        this._favGroup = new Adw.PreferencesGroup({
            title: _('Favorite Services'),
            description: _('Manage and reorder your pinned services.')
        });
        page.add(this._favGroup);

        // Група 2: Блок для пошуку (виступає як заголовок)
        const searchGroup = new Adw.PreferencesGroup({
            title: _('Available Services'),
            description: _('Search and add services to your favorites.')
        });
        page.add(searchGroup);

        this._searchEntry = new Gtk.SearchEntry({
            placeholder_text: _('Search services...'),
            margin_bottom: 12
        });
        this._searchEntry.connect('search-changed', () => this._updateAvailableList());
        searchGroup.add(this._searchEntry);

        // Група 3: Сам список доступних сервісів (без заголовка)
        this._availGroup = new Adw.PreferencesGroup();
        page.add(this._availGroup);

        // Завантажуємо всі сервіси з системи
        this._loadServices();

        // Перший рендер інтерфейсу
        this._refreshUI();
    }

    _loadServices() {
        try {
            const sysConn = Gio.bus_get_sync(Gio.BusType.SYSTEM, null);
            const usrConn = Gio.bus_get_sync(Gio.BusType.SESSION, null);

            const processFiles = (connection) => {
                try {
                    const result = connection.call_sync('org.freedesktop.systemd1', '/org/freedesktop/systemd1', 'org.freedesktop.systemd1.Manager', 'ListUnitFiles', null, null, Gio.DBusCallFlags.NONE, -1, null);
                    const files = result.recursiveUnpack()[0];
                    files.forEach(f => {
                        const path = f[0];
                        const name = path.split('/').pop();
                        if (name.endsWith('.service')) {
                            this._allServices.add(name);
                        }
                    });
                } catch (e) {}
            };

            processFiles(sysConn);
            processFiles(usrConn);
        } catch (e) {
            console.error('[Systemd Manager Neo] Error loading service files:', e);
        }
    }

    _refreshUI() {
        // Правильно очищаємо групу обраних (видаляємо лише наші збережені рядки)
        this._favRows.forEach(row => this._favGroup.remove(row));
        this._favRows = []; // обнуляємо масив

        const favs = this._settings.get_strv('favorite-services') || [];

        if (favs.length === 0) {
            const emptyRow = new Adw.ActionRow({ title: _('No favorites added yet.') });
            this._favGroup.add(emptyRow);
            this._favRows.push(emptyRow);
        } else {
            favs.forEach((name, index) => {
                const row = new Adw.ActionRow({ title: name });
                const box = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL, spacing: 6, valign: Gtk.Align.CENTER });

                // Кнопка Вгору
                const btnUp = new Gtk.Button({ icon_name: 'go-up-symbolic' });
                btnUp.set_sensitive(index > 0);
                btnUp.connect('clicked', () => this._moveFav(index, -1));
                box.append(btnUp);

                // Кнопка Вниз
                const btnDown = new Gtk.Button({ icon_name: 'go-down-symbolic' });
                btnDown.set_sensitive(index < favs.length - 1);
                btnDown.connect('clicked', () => this._moveFav(index, 1));
                box.append(btnDown);

                // Кнопка Видалити
                const btnRemove = new Gtk.Button({ icon_name: 'user-trash-symbolic' });
                btnRemove.add_css_class('destructive-action');
                btnRemove.connect('clicked', () => this._toggleFav(name, false));
                box.append(btnRemove);

                row.add_suffix(box);
                this._favGroup.add(row);
                this._favRows.push(row); // Зберігаємо посилання для майбутнього очищення
            });
        }

        // Оновлюємо нижній список
        this._updateAvailableList();
    }

    _updateAvailableList() {
        // Правильно очищаємо доступні сервіси
        this._availRows.forEach(row => this._availGroup.remove(row));
        this._availRows = [];

        const favs = this._settings.get_strv('favorite-services') || [];
        const searchText = this._searchEntry.get_text().toLowerCase();

        let available = Array.from(this._allServices)
            .filter(s => !favs.includes(s))
            .filter(s => s.toLowerCase().includes(searchText))
            .sort();

        const MAX_RESULTS = 50;
        const shown = available.slice(0, MAX_RESULTS);

        shown.forEach(name => {
            const row = new Adw.ActionRow({ title: name });
            const btnAdd = new Gtk.Button({ icon_name: 'list-add-symbolic', valign: Gtk.Align.CENTER });
            
            btnAdd.connect('clicked', () => {
                this._toggleFav(name, true);
            });

            row.add_suffix(btnAdd);
            this._availGroup.add(row);
            this._availRows.push(row); // Зберігаємо посилання
        });

        if (available.length > MAX_RESULTS) {
            const moreRow = new Adw.ActionRow({ 
                title: _('...and %d more').replace('%d', available.length - MAX_RESULTS),
                subtitle: _('Use search to find specific services.')
            });
            this._availGroup.add(moreRow);
            this._availRows.push(moreRow); // Зберігаємо посилання
        }
    }

    _moveFav(index, direction) {
        let favs = this._settings.get_strv('favorite-services') || [];
        const newIndex = index + direction;
        
        if (newIndex >= 0 && newIndex < favs.length) {
            const temp = favs[index];
            favs[index] = favs[newIndex];
            favs[newIndex] = temp;
            this._settings.set_strv('favorite-services', favs);
            this._refreshUI();
        }
    }

    _toggleFav(name, isAdding) {
        let favs = this._settings.get_strv('favorite-services') || [];
        if (isAdding) {
            if (!favs.includes(name)) favs.push(name);
        } else {
            favs = favs.filter(s => s !== name);
        }
        this._settings.set_strv('favorite-services', favs);
        this._refreshUI();
    }
}