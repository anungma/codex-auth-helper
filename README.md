# Codex Auth Exporter

[![Version](https://img.shields.io/badge/version-1.2.3-blue.svg)](./extension/manifest.json)
[![Manifest V3](https://img.shields.io/badge/Chrome_Extension-Manifest_V3-orange.svg)](https://developer.chrome.com/docs/extensions/mv3/intro/)
[![Local Only](https://img.shields.io/badge/Security-100%25_Local-green.svg)](#security--privacy-pledge)
[![License](https://img.shields.io/badge/License-MIT-purple.svg)](LICENSE)

**Codex Auth Exporter** is a secure, lightweight browser extension for exporting local ChatGPT session configuration into Codex-compatible auth JSON backup files.

It can export the current account and, when ChatGPT exposes account switcher data, one backup per active personal/workspace account.

---

## Core Features

- **Smart Local Status Detection**: Detects the browser's current ChatGPT authorization status and shows avatar, email, and subscription plan.
- **Real-Time Expiry Countdown**: Reads token expiry time and displays a live countdown in the popup UI.
- **Automated Format Synthesis**: Generates the synthetic `id_token` structure expected by Codex auth config.
- **Local Offline Processing**: Runs in the browser extension runtime and does not upload exported config data to third-party servers.
- **Multi-Account Export**: Exports active personal and workspace accounts as separate auth JSON backup files.

---

## Quick Start

### 1. Developer Mode Installation

1. Download or clone this repository.
2. Open Chrome or Brave and navigate to `chrome://extensions/` or `brave://extensions/`.
3. Enable **Developer mode**.
4. Click **Load unpacked**.
5. Select the `extension` folder from this repository.
6. Pin **Codex Auth Exporter** from the browser toolbar puzzle icon.

### 2. Export Auth JSON

1. Log in to [ChatGPT](https://chatgpt.com/) in the same browser profile.
2. Open the **Codex Auth Exporter** popup.
3. Click **Export Current Account** for the current ChatGPT account.
4. Click **Export All Accounts** to export every active personal/workspace account detected from ChatGPT.
5. Rename or copy the downloaded file you want to use to `auth.json` before placing it in your Codex config directory.

## Browser Builds

Chrome can load the `extension` folder directly. Brave and Firefox builds can be generated from the shared source:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/build-extensions.ps1
```

- **Brave**: load `dist/brave` from `brave://extensions/` with Developer mode enabled.
- **Firefox**: load `dist/firefox/manifest.json` from `about:debugging#/runtime/this-firefox` using **Load Temporary Add-on**.
- **Packages**: zipped builds are written to `dist/packages/`.

### Incognito / Private Windows

Incognito and private windows use a separate browser session from normal windows. Enable the extension for private windows first:

- **Brave**: open `brave://extensions/`, select **Codex Auth Exporter**, then enable **Allow in Private**.
- **Firefox**: open `about:addons`, select **Codex Auth Exporter**, then allow it to run in Private Windows.

## Developer Notes

### Versioning

- Current version: `1.2.3`.
- Keep `extension/manifest.json`, `manifests/brave.manifest.json`, and `manifests/firefox.manifest.json` in sync.
- The build script reads the package version from `extension/manifest.json` and uses it in generated zip filenames.

### Release Checklist

1. Update all extension manifests to the new version.
2. Update the README version badge and changelog.
3. Run `node --check extension/background.js` and `node --check extension/popup/popup.js`.
4. Run `powershell -ExecutionPolicy Bypass -File scripts/build-extensions.ps1`.
5. Reload the unpacked browser extension from `extension`, `dist/brave`, or `dist/firefox`.

### Changelog

#### `1.2.3`

- Rebranded extension surfaces to Codex Auth Exporter.
- Included active personal accounts in Export All Accounts instead of only workspace accounts.

#### `1.2.2`

- Fixed current workspace export filenames to use the same email-local-part and workspace-name rule as all-workspace exports.

#### `1.2.1`

- Added email local-part prefixes to exported auth filenames and removed email domains from filename identity.

#### `1.2.0`

- Added first-paint active workspace discovery with loading spinner.
- Added `Export Current Account` and guarded `Export All Accounts` actions.
- Added one-file-per-account export using account/workspace-based filenames.
- Added Brave and Firefox build packaging.
- Added incognito/private-window support notes and manifest handling.

#### `1.1.1`

- Exported auth backups with account-specific filenames.
- Clarified that exported files must be renamed or copied to `auth.json` before Codex use.

## Security & Privacy Pledge

> [!IMPORTANT]
> Your identity credentials and session are extremely sensitive private data — they must never be leaked or uploaded to any server.

- **Zero Sensitive Data Collection**: This extension never collects, uploads, or forwards personal data or credentials.
- **Minimal Permission Declarations**: Only declares `downloads`, `scripting`, `tabs`, and `https://chatgpt.com/*` for account detection and local export.
- **Fully Closed-Loop Code**: You can inspect `background.js` and `popup.js` at any time via browser DevTools. Static resources are bundled locally.

---

## License

This project is open-sourced under the [MIT License](LICENSE).
