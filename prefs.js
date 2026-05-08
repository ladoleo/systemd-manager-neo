/*
 * Systemd Manager Neo
 * Copyright (C) 2026 Lado Leo
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
        this._groupRows = []; // Для збереження віджетів груп

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
        this._currentLimit = 50;

        const filterBox = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL, spacing: 12, margin_bottom: 12, halign: Gtk.Align.CENTER });
        searchGroup.add(filterBox);

        const busGroup = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL });
        busGroup.add_css_class('linked');
        const btnBusAll = new Gtk.ToggleButton({ label: _('All') });
        const btnBusSys = new Gtk.ToggleButton({ label: _('System') });
        const btnBusUsr = new Gtk.ToggleButton({ label: _('User') });
        btnBusSys.set_group(btnBusAll); btnBusUsr.set_group(btnBusAll); btnBusAll.set_active(true);
        busGroup.append(btnBusAll); busGroup.append(btnBusSys); busGroup.append(btnBusUsr);
        filterBox.append(busGroup);

        const stateGroup = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL });
        stateGroup.add_css_class('linked');
        const btnStateAll = new Gtk.ToggleButton({ label: _('All') });
        const btnStateEn = new Gtk.ToggleButton({ label: _('Enabled') });
        const btnStateDis = new Gtk.ToggleButton({ label: _('Disabled') });
        btnStateEn.set_group(btnStateAll); btnStateDis.set_group(btnStateAll); btnStateAll.set_active(true);
        stateGroup.append(btnStateAll); stateGroup.append(btnStateEn); stateGroup.append(btnStateDis);
        filterBox.append(stateGroup);

        const updateFilters = () => {
            if (btnBusAll.get_active()) this._filterBus = 'all';
            else if (btnBusSys.get_active()) this._filterBus = 'system';
            else if (btnBusUsr.get_active()) this._filterBus = 'user';
            if (btnStateAll.get_active()) this._filterState = 'all';
            else if (btnStateEn.get_active()) this._filterState = 'enabled';
            else if (btnStateDis.get_active()) this._filterState = 'disabled';
            this._updateAvailableList('reset'); 
        };

        [btnBusAll, btnBusSys, btnBusUsr, btnStateAll, btnStateEn, btnStateDis].forEach(btn => btn.connect('toggled', updateFilters));

        this._availGroup = new Adw.PreferencesGroup();
        pageServices.add(this._availGroup);

        // --- ВКЛАДКА 2: ГРУПИ (ПРОФІЛІ) ---
        const pageGroups = new Adw.PreferencesPage({
            title: _('Groups'),
            icon_name: 'folder-system-symbolic'
        });
        window.add(pageGroups);

        const createGroupPref = new Adw.PreferencesGroup({
            title: _('Service Groups'),
            description: _('Create groups to manage multiple services at once.')
        });
        pageGroups.add(createGroupPref);

        // Поле для створення нової групи
        const addGroupBox = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL, spacing: 12, margin_bottom: 24 });
        const addGroupEntry = new Gtk.Entry({ placeholder_text: _('New group name...'), hexpand: true });
        const addGroupBtn = new Gtk.Button({ label: _('Add Group'), valign: Gtk.Align.CENTER });
        addGroupBtn.add_css_class('suggested-action');
        addGroupBox.append(addGroupEntry);
        addGroupBox.append(addGroupBtn);
        createGroupPref.add(addGroupBox);

        this._groupsList = new Adw.PreferencesGroup();
        pageGroups.add(this._groupsList);

        addGroupBtn.connect('clicked', () => {
            const name = addGroupEntry.get_text().trim();
            if (name) {
                let groups = this._getGroups();
                if (!groups[name]) {
                    groups[name] = []; // Створюємо пусту групу
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

    // --- ЛОГІКА РОБОТИ З JSON ---
    _getGroups() {
        try {
            const jsonStr = this._settings.get_string('service-groups');
            return jsonStr ? JSON.parse(jsonStr) : {};
        } catch (e) {
            console.error('[Systemd Manager Neo] Error parsing groups JSON:', e);
            return {};
        }
    }

    _saveGroups(groups) {
        this._settings.set_string('service-groups', JSON.stringify(groups));
    }

    // --- РЕНДЕР ГРУП ---
    _refreshGroupsUI() {
        if (!this._groupsList) return;

        this._groupRows.forEach(row => this._groupsList.remove(row));
        this._groupRows = [];

        const groups = this._getGroups();
        const favs = this._settings.get_strv('favorite-services') || [];

        for (const [groupName, groupServices] of Object.entries(groups)) {
            const expander = new Adw.ExpanderRow({ 
                title: groupName, 
                subtitle: _('%d services attached').replace('%d', groupServices.length) 
            });

            // Додаємо всі "Обрані" сервіси як перемикачі (Switch) всередину групи
            if (favs.length === 0) {
                const emptyRow = new Adw.ActionRow({ title: _('No favorite services to add. Go to Services tab first.') });
                expander.add_row(emptyRow);
            } else {
                favs.forEach(favName => {
                    const row = new Adw.ActionRow({ title: favName });
                    const sw = new Gtk.Switch({ valign: Gtk.Align.CENTER });
                    
                    sw.set_active(groupServices.includes(favName));
                    
                    sw.connect('notify::active', () => {
                        let g = this._getGroups();
                        if (sw.get_active()) {
                            if (!g[groupName].includes(favName)) g[groupName].push(favName);
                        } else {
                            g[groupName] = g[groupName].filter(s => s !== favName);
                        }
                        this._saveGroups(g);
                        expander.set_subtitle(_('%d services attached').replace('%d', g[groupName].length));
                    });
                    
                    row.add_suffix(sw);
                    expander.add_row(row);
                });
            }

            // Кнопка видалення групи (у самому низу списку)
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
                        if (name.endsWith('.service')) {
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
        
        // Оновлюємо також і вкладку груп, бо список обраних міг змінитись
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