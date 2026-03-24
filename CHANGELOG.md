# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2026-03-24

### Added

- Electron app with dictionary popup, Google Translate integration, Wikipedia and search links, clipboard history.
- Windows text selection via Microsoft UI Automation (native addon) with debounced selection handling.
- Global shortcuts, monitor/selection modes, and settings UI (including shortcut trigger behavior).
- Windows installer as **WiX MSI** (`npm run make` / `make:win`); see `PACKAGING.md`.
- `koffi`-based physical key state for shortcut mode; `asarUnpack` so the addon loads in packaged builds.

### Changed

- Replaced Squirrel with WiX MSI for Windows distribution.

### Notes for users

- **Windows x64**, **run elevated** when using UIAutomation across the desktop (see README).
- Install from the `.msi` attached to GitHub Releases; no separate Node.js install required.

[1.0.0]: https://github.com/thd2020/phevere/releases/tag/v1.0.0
