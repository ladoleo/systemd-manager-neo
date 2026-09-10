
---


# 😈 Systemd Manager Neo

**Systemd Manager Neo** is a sophisticated GNOME Shell extension designed for power users, developers, and sysadmins who need instant control over their system services, timers, and sockets. It brings the power of `systemctl` to your top panel and provides a full-fledged native libadwaita dashboard for deep system management.

## ✨ Key Features

* **🎛️ Full Unit Details Dashboard [NEW]**: Clicking any favorite or available unit in the Preferences now opens a dedicated, sliding dashboard! Monitor live Active/Sub states, real-time Uptime, and RAM usage. 
* **⚡ Complete Runtime & Boot Controls [NEW]**: Not just Start/Stop! You can now Restart services, and completely configure Startup behavior (**Enable/Disable** at boot) right from the UI.
* **🛡️ Sandbox-Proof Authentication [NEW]**: Running the GNOME Extensions app via Flatpak? No problem. We built an intelligent fallback mechanism utilizing `pkexec` to guarantee you can securely authenticate and manage system-level units, bypassing strict sandbox restrictions.
* **🔌 Timers & Sockets Support [NEW]**: Full support for `.timer` and `.socket` units. View next run times, toggle schedules, or manage socket-activated services natively.
* **📜 One-Click Logs & Paths [NEW]**: Instantly launch `journalctl -f` for a specific unit in your preferred terminal emulator, or securely copy the absolute unit file path to your clipboard with one click.
* **📁 Typed Service Groups**: Create custom, isolated groups explicitly for Services, Timers, Sockets, or Mixed units. Group titles automatically change color to alert you if a child unit enters a `FAILED` state (Zero background CPU drain!).
* **🔍 Advanced Filtering**: Effortlessly search through hundreds of system units. Filter by **Type** (Services/Timers/Sockets), **Bus** (System/User), and **State** (Enabled/Disabled). Use "Load More" or "Load All" for buttery-smooth pagination.

## 💡 How to Use the Dashboard & Groups

Systemd Manager Neo is designed to keep your workflow blazing fast:

1. **Find & Pin**: Open Settings, navigate to the **Services** tab, and use the filters to find your desired units. Click the `+` button to pin them to your *Favorite Services*.
2. **Deep Management**: Click on any unit row in the lists to slide into the **Unit Details Dashboard** where you can copy its path, read logs, or change boot behavior.
3. **Organize into Groups**: Switch to the **Groups** tab, name your group, select its type, and assign your pinned favorites to it. 
> *Pro Tip: Grouped units are automatically nested in the top panel menu to keep your GNOME bar perfectly tidy!*

## 🌍 Supported Languages

The extension speaks 6 languages natively right out of the box:
🇬🇧 **English** | 🇺🇦 **Ukrainian** | 🇵🇱 **Polish** | 🇪🇸 **Spanish** | 🇸🇰 **Slovak** | 🇩🇪 **German**

## 🚀 Installation

### 1. From GNOME Extensions
The recommended way is to install it via the [Official GNOME Extensions Website](https://extensions.gnome.org).

### 2. Manual Installation
For those who prefer building from source:

1. **Clone the repository**:
```bash
git clone [https://github.com/ladoleo/systemd-manager-neo.git](https://github.com/ladoleo/systemd-manager-neo.git)
cd systemd-manager-neo

```

2. **Compile schemas & Locales**:

```bash
glib-compile-schemas schemas/
# Compile translations
for lang in de es pl sk uk; do msgfmt po/${lang}.po -o locale/${lang}/LC_MESSAGES/systemd-manager-neo.mo; done

```

3. **Deploy**:

```bash
mkdir -p ~/.local/share/gnome-shell/extensions/
cp -r . ~/.local/share/gnome-shell/extensions/systemd-manager-neo@ladoleo.local

```

4. **Restart Shell**: Press `Alt+F2`, type `r` and hit `Enter` (X11) or Log out and Log in (Wayland).

## 🛠 Specifications

* **Shell Support**: Optimized for GNOME Shell versions 47, 48, 49, and 50.
* **Licensing**: Distributed under the **GNU GPLv3** license.

## 🤝 Contributing

Feel free to:

* Report bugs via [Issues](https://github.com/ladoleo/systemd-manager-neo/issues).
* Propose new features or improvements.
* Submit Pull Requests with localizations or code optimizations.

---

*Developed with ☕️ and passion for GNOME.*