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
import GLib from 'gi://GLib';
import { ExtensionPreferences, gettext as _ } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

export default class SystemdManagerNeoPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        this._settings = this.getSettings();
        this._allServices = [];
        this._favRows = [];
        this._availRows = [];
        this._groupRows = [];

        // --- НОВИЙ КОД: Задаємо розмір вікна налаштувань ---
        // Задаємо бажаний початковий розмір (ширина, висота)
        window.set_default_size(865, 700);
        // Задаємо мінімальний розмір, щоб вікно не можна було стиснути занадто сильно
        window.set_size_request(450, 400);
        // Додатково можна зробити так, щоб вікно відкривалося по центру екрана (опціонально)
        window.set_modal(true);
        // --- КІНЕЦЬ НОВОГО КОДУ ---

        // --- ВКЛАДКА 1: СЕРВІСИ ---
        const pageServices = new Adw.PreferencesPage({
            title: _('Services'),
            icon_name: 'emblem-system-symbolic'
        });
        window.add(pageServices);

        GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
            const scrolled = pageServices.get_ancestor(Gtk.ScrolledWindow);
            if (scrolled) {
                this._adjustment = scrolled.get_vadjustment();
            } else {
                this._adjustment = window.vadjustment || (typeof window.get_vadjustment === 'function' ? window.get_vadjustment() : null);
            }
            return GLib.SOURCE_REMOVE;
        });

        this._favGroup = new Adw.PreferencesGroup({
            title: _('Favorite Services'),
            description: _('Manage and reorder your pinned services.')
        });
        pageServices.add(this._favGroup);

        const searchGroup = new Adw.PreferencesGroup({
            title: _('Available Services'),
            description: _('Search and add services to your favorites.')
        });
        pageServices.add(searchGroup);

        this._searchEntry = new Gtk.SearchEntry({
            placeholder_text: _('Search services...'),
            margin_bottom: 12
        });
        this._searchEntry.connect('search-changed', () => this._updateAvailableList('reset'));
        searchGroup.add(this._searchEntry);

        this._filterBus = 'all';
        this._filterState = 'all';
        this._filterType = 'all'; // НОВИЙ ФІЛЬТР ДЛЯ ТАЙМЕРІВ
        this._currentLimit = 50;

        const filterBox = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL, spacing: 12, margin_bottom: 12, halign: Gtk.Align.CENTER });
        searchGroup.add(filterBox);

        // Фільтр Типу (Усі / Сервіси / Таймери)
        const typeGroup = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL });
        typeGroup.add_css_class('linked');
        const btnTypeAll = new Gtk.ToggleButton({ label: _('All') });
        const btnTypeSvc = new Gtk.ToggleButton({ label: _('Services') });
        const btnTypeTmr = new Gtk.ToggleButton({ label: _('Timers') });
        btnTypeSvc.set_group(btnTypeAll); btnTypeTmr.set_group(btnTypeAll); btnTypeAll.set_active(true);
        typeGroup.append(btnTypeAll); typeGroup.append(btnTypeSvc); typeGroup.append(btnTypeTmr);
        filterBox.append(typeGroup);

        // Фільтр Bus
        const busGroup = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL });
        busGroup.add_css_class('linked');
        const btnBusAll = new Gtk.ToggleButton({ label: _('All') });
        const btnBusSys = new Gtk.ToggleButton({ label: _('System') });
        const btnBusUsr = new Gtk.ToggleButton({ label: _('User') });
        btnBusSys.set_group(btnBusAll); btnBusUsr.set_group(btnBusAll); btnBusAll.set_active(true);
        busGroup.append(btnBusAll); busGroup.append(btnBusSys); busGroup.append(btnBusUsr);
        filterBox.append(busGroup);

        // Фільтр Стану
        const stateGroup = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL });
        stateGroup.add_css_class('linked');
        const btnStateAll = new Gtk.ToggleButton({ label: _('All') });
        const btnStateEn = new Gtk.ToggleButton({ label: _('Enabled') });
        const btnStateDis = new Gtk.ToggleButton({ label: _('Disabled') });
        btnStateEn.set_group(btnStateAll); btnStateDis.set_group(btnStateAll); btnStateAll.set_active(true);
        stateGroup.append(btnStateAll); stateGroup.append(btnStateEn); stateGroup.append(btnStateDis);
        filterBox.append(stateGroup);

        const updateFilters = () => {
            if (btnTypeAll.get_active()) this._filterType = 'all';
            else if (btnTypeSvc.get_active()) this._filterType = 'service';
            else if (btnTypeTmr.get_active()) this._filterType = 'timer';

            if (btnBusAll.get_active()) this._filterBus = 'all';
            else if (btnBusSys.get_active()) this._filterBus = 'system';
            else if (btnBusUsr.get_active()) this._filterBus = 'user';

            if (btnStateAll.get_active()) this._filterState = 'all';
            else if (btnStateEn.get_active()) this._filterState = 'enabled';
            else if (btnStateDis.get_active()) this._filterState = 'disabled';
            
            this._updateAvailableList('reset'); 
        };

        [btnTypeAll, btnTypeSvc, btnTypeTmr, btnBusAll, btnBusSys, btnBusUsr, btnStateAll, btnStateEn, btnStateDis].forEach(btn => btn.connect('toggled', updateFilters));

        this._availGroup = new Adw.PreferencesGroup();
        pageServices.add(this._availGroup);

        // --- ВКЛАДКА 2: ГРУПИ (ПРОФІЛІ) ---
        const pageGroups = new Adw.PreferencesPage({
            title: _('Groups'),
            icon_name: 'org.gnome.Settings-applications-symbolic'
        });
        window.add(pageGroups);

        const createGroupPref = new Adw.PreferencesGroup({
            title: _('Service Groups'),
            description: _('Create groups to manage multiple services at once.')
        });
        pageGroups.add(createGroupPref);

        // Поле для створення нової групи з вибором типу
        const addGroupBox = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL, spacing: 12, margin_bottom: 24 });
        const addGroupEntry = new Gtk.Entry({ placeholder_text: _('New group name...'), hexpand: true });
        
        const addGroupType = Gtk.DropDown.new_from_strings([_('Services'), _('Timers')]);
        addGroupType.valign = Gtk.Align.CENTER;
        
        const addGroupBtn = new Gtk.Button({ label: _('Add Group'), valign: Gtk.Align.CENTER });
        addGroupBtn.add_css_class('suggested-action');
        
        addGroupBox.append(addGroupEntry);
        addGroupBox.append(addGroupType);
        addGroupBox.append(addGroupBtn);
        createGroupPref.add(addGroupBox);

        this._groupsList = new Adw.PreferencesGroup();
        pageGroups.add(this._groupsList);

        addGroupBtn.connect('clicked', () => {
            const name = addGroupEntry.get_text().trim();
            if (name) {
                let groups = this._getGroups();
                if (!groups[name]) {
                    const isTimer = addGroupType.get_selected() === 1;
                    // НОВИЙ ФОРМАТ: зберігаємо тип групи
                    groups[name] = { type: isTimer ? 'timer' : 'service', services: [] };
                    this._saveGroups(groups);
                    addGroupEntry.set_text('');
                    this._refreshGroupsUI();
                }
            }
        });

        // --- ІНІЦІАЛІЗАЦІЯ ---
        this._loadServices();
        this._refreshUI();

        window.connect('close-request', () => {
            this._settings = null;
            this._allServices = null;
            this._favRows = null;
            this._availRows = null;
            this._groupRows = null;
            this._favGroup = null;
            this._availGroup = null;
            this._groupsList = null;
            this._searchEntry = null;
            this._adjustment = null;
        });
    }

    _getGroups() {
        try {
            const jsonStr = this._settings.get_string('service-groups');
            const raw = jsonStr ? JSON.parse(jsonStr) : {};
            const groups = {};
            // МІГРАЦІЯ: переводимо старі масиви у новий формат з типом
            for (const [k, v] of Object.entries(raw)) {
                if (Array.isArray(v)) {
                    groups[k] = { type: 'service', services: v };
                } else {
                    groups[k] = v;
                }
            }
            return groups;
        } catch (e) {
            console.error('[Systemd Manager Neo] Error parsing groups JSON:', e);
            return {};
        }
    }

    _saveGroups(groups) {
        this._settings.set_string('service-groups', JSON.stringify(groups));
    }

    _refreshGroupsUI() {
        if (!this._groupsList) return;

        this._groupRows.forEach(row => this._groupsList.remove(row));
        this._groupRows = [];

        const groups = this._getGroups();
        const favs = this._settings.get_strv('favorite-services') || [];

        for (const [groupName, groupData] of Object.entries(groups)) {
            const groupType = groupData.type;
            const groupServices = groupData.services;
            
            const expander = new Adw.ExpanderRow({ 
                title: groupName, 
                subtitle: _('%d attached').replace('%d', groupServices.length) 
            });

            // Нативний метод libadwaita для іконок у рядках
            if (groupType === 'timer') {
                expander.set_icon_name('weather-hourly-symbolic');
            }

            // Відфільтровуємо лише ті обрані, які підходять під тип групи
            const matchingFavs = favs.filter(fav => {
                if (groupType === 'timer') return fav.endsWith('.timer');
                return fav.endsWith('.service');
            });

            if (matchingFavs.length === 0) {
                const emptyRow = new Adw.ActionRow({ title: _('No compatible favorites available.') });
                expander.add_row(emptyRow);
            } else {
                matchingFavs.forEach(favName => {
                    const row = new Adw.ActionRow({ title: favName });
                    const sw = new Gtk.Switch({ valign: Gtk.Align.CENTER });
                    
                    sw.set_active(groupServices.includes(favName));
                    
                    sw.connect('notify::active', () => {
                        let g = this._getGroups();
                        if (sw.get_active()) {
                            if (!g[groupName].services.includes(favName)) g[groupName].services.push(favName);
                        } else {
                            g[groupName].services = g[groupName].services.filter(s => s !== favName);
                        }
                        this._saveGroups(g);
                        expander.set_subtitle(_('%d attached').replace('%d', g[groupName].services.length));
                    });
                    
                    row.add_suffix(sw);
                    expander.add_row(row);
                });
            }

            const deleteRow = new Adw.ActionRow({ title: _('Remove this group') });
            const btnDelete = new Gtk.Button({ label: _('Delete'), valign: Gtk.Align.CENTER });
            btnDelete.add_css_class('destructive-action');
            btnDelete.connect('clicked', () => {
                let g = this._getGroups();
                delete g[groupName];
                this._saveGroups(g);
                this._refreshGroupsUI();
            });
            deleteRow.add_suffix(btnDelete);
            expander.add_row(deleteRow);

            this._groupsList.add(expander);
            this._groupRows.push(expander);
        }
    }

    _loadServices() {
        this._allServices = []; 
        try {
            const sysConn = Gio.bus_get_sync(Gio.BusType.SYSTEM, null);
            const usrConn = Gio.bus_get_sync(Gio.BusType.SESSION, null);
            const processFiles = (connection, busType) => {
                try {
                    const result = connection.call_sync('org.freedesktop.systemd1', '/org/freedesktop/systemd1', 'org.freedesktop.systemd1.Manager', 'ListUnitFiles', null, null, Gio.DBusCallFlags.NONE, -1, null);
                    const files = result.recursiveUnpack()[0];
                    files.forEach(f => {
                        const name = f[0].split('/').pop();
                        // ТЕПЕР ЗЧИТУЄМО ТАКОЖ І .TIMER ФАЙЛИ
                        if (name.endsWith('.service') || name.endsWith('.timer')) {
                            this._allServices.push({ name, bus: busType, state: f[1] });
                        }
                    });
                } catch (e) {}
            };
            processFiles(sysConn, 'system');
            processFiles(usrConn, 'user');
        } catch (e) {}
    }

    _refreshUI() {
        this._favRows.forEach(row => this._favGroup.remove(row));
        this._favRows = []; 
        const favs = this._settings.get_strv('favorite-services') || [];
        if (favs.length === 0) {
            const emptyRow = new Adw.ActionRow({ title: _('No favorites added yet.') });
            this._favGroup.add(emptyRow);
            this._favRows.push(emptyRow);
        } else {
            favs.forEach((name, index) => {
                const row = new Adw.ActionRow({ title: name });
                const box = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL, spacing: 6, valign: Gtk.Align.CENTER });
                const btnUp = new Gtk.Button({ icon_name: 'go-up-symbolic' });
                btnUp.set_sensitive(index > 0);
                btnUp.connect('clicked', () => this._moveFav(index, -1));
                const btnDown = new Gtk.Button({ icon_name: 'go-down-symbolic' });
                btnDown.set_sensitive(index < favs.length - 1);
                btnDown.connect('clicked', () => this._moveFav(index, 1));
                const btnRemove = new Gtk.Button({ icon_name: 'user-trash-symbolic' });
                btnRemove.add_css_class('destructive-action');
                btnRemove.connect('clicked', () => this._toggleFav(name, false));
                box.append(btnUp); box.append(btnDown); box.append(btnRemove);
                row.add_suffix(box);
                this._favGroup.add(row);
                this._favRows.push(row); 
            });
        }
        this._updateAvailableList('refresh');
        this._refreshGroupsUI(); 
    }

    _updateAvailableList(mode = 'reset') {
        const currentScrollPos = this._adjustment ? this._adjustment.get_value() : 0;

        if (mode === 'reset') this._currentLimit = 50;

        const favs = this._settings.get_strv('favorite-services') || [];
        const searchText = this._searchEntry.get_text().toLowerCase();

        let filtered = this._allServices.filter(item => {
            if (favs.includes(item.name)) return false;
            if (!item.name.toLowerCase().includes(searchText)) return false;
            
            // ЛОГІКА НОВОГО ФІЛЬТРА ТИПІВ
            if (this._filterType === 'service' && !item.name.endsWith('.service')) return false;
            if (this._filterType === 'timer' && !item.name.endsWith('.timer')) return false;
            
            if (this._filterBus !== 'all' && item.bus !== this._filterBus) return false;
            if (this._filterState !== 'all' && item.state !== this._filterState) return false;
            return true;
        }).sort((a, b) => a.name.localeCompare(b.name));

        if (mode === 'all') {
            this._currentLimit = filtered.length;
        }

        if (mode === 'reset' || mode === 'refresh' || mode === 'all') {
            this._availRows.forEach(row => this._availGroup.remove(row));
            this._availRows = [];
        } else if (mode === 'append' && this._availRows.length > 0) {
            const moreRowToCleanup = this._availRows.pop();
            this._availGroup.remove(moreRowToCleanup);
        }

        let startIndex = (mode === 'append') ? this._currentLimit - 50 : 0;
        const shown = filtered.slice(startIndex, this._currentLimit);

        shown.forEach(item => {
            const row = new Adw.ActionRow({ 
                title: item.name,
                subtitle: `${item.bus === 'system' ? _('System') : _('User')} • ${item.state}`
            });
            const btnAdd = new Gtk.Button({ icon_name: 'list-add-symbolic', valign: Gtk.Align.CENTER });
            btnAdd.connect('clicked', () => this._toggleFav(item.name, true));
            row.add_suffix(btnAdd);
            this._availGroup.add(row);
            this._availRows.push(row);
        });

        if (filtered.length > this._currentLimit) {
            const remaining = filtered.length - this._currentLimit;
            const toLoad = Math.min(50, remaining);
            
            const moreRow = new Adw.ActionRow({ 
                title: _('...and %d more').replace('%d', remaining),
                subtitle: _('You can load more or show the full list at once.')
            });
            
            const btnBox = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL, spacing: 6, valign: Gtk.Align.CENTER });

            const btnLoadMore = new Gtk.Button({ label: _('Load More') });
            btnLoadMore.connect('clicked', () => {
                this._currentLimit += 50;
                this._updateAvailableList('append'); 
            });

            const btnLoadAll = new Gtk.Button({ label: _('Load All') });
            btnLoadAll.add_css_class('suggested-action'); 
            btnLoadAll.connect('clicked', () => {
                this._updateAvailableList('all'); 
            });

            btnBox.append(btnLoadMore);
            btnBox.append(btnLoadAll);
            
            moreRow.add_suffix(btnBox);
            this._availGroup.add(moreRow);
            this._availRows.push(moreRow);
        }

        if (mode !== 'reset' && mode !== 'all' && this._adjustment) {
            GLib.idle_add(GLib.PRIORITY_LOW, () => {
                if (this._adjustment) this._adjustment.set_value(currentScrollPos);
                return GLib.SOURCE_REMOVE;
            });
        }
    }

    _moveFav(index, direction) {
        let favs = this._settings.get_strv('favorite-services') || [];
        const newIndex = index + direction;
        if (newIndex >= 0 && newIndex < favs.length) {
            [favs[index], favs[newIndex]] = [favs[newIndex], favs[index]];
            this._settings.set_strv('favorite-services', favs);
            this._refreshUI();
        }
    }

    _toggleFav(name, isAdding) {
        let favs = this._settings.get_strv('favorite-services') || [];
        if (isAdding) { if (!favs.includes(name)) favs.push(name); }
        else { favs = favs.filter(s => s !== name); }
        this._settings.set_strv('favorite-services', favs);
        this._refreshUI();
    }
}