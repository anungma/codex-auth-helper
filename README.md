# 🔐 Codex Auth Exporter

[![Version](https://img.shields.io/badge/version-1.1.0-blue.svg)](./extension/manifest.json)
[![Manifest V3](https://img.shields.io/badge/Chrome_Extension-Manifest_V3-orange.svg)](https://developer.chrome.com/docs/extensions/mv3/intro/)
[![Local Only](https://img.shields.io/badge/Security-100%25_Local-green.svg)](#-security--privacy-pledge)
[![License](https://img.shields.io/badge/License-MIT-purple.svg)](LICENSE)

**Codex Auth Exporter** is a secure, lightweight, and beautifully designed Chrome extension built for Codex developers to manage credentials and back up local configurations.

Through a highly secure local sandbox mechanism, this extension helps you export your ChatGPT login session credentials quickly and safely with one click, automatically converting them into a Codex-compliant `auth.json` configuration file.

---

## 🌟 Core Features

- 📡 **Smart Local Status Detection**: Instantly detects and aligns with your browser's current ChatGPT authorization status, showing avatar, email, and subscription plan (Free / Plus / Pro).
- ⏱️ **Real-Time Expiry Countdown**: Precisely reads the token expiry time and provides a live second-by-second countdown in the popup UI.
- ⚙️ **Automated Format Synthesis**: Implements JWT simulation to automatically generate a **Synthetic id_token** required by the Codex specification, enabling seamless authentication.
- 🔒 **100% Pure Local Offline Processing**:
  - Core logic runs in a closed-loop browser sandbox. Generated configs trigger downloads via `data:` URLs, leaving no temporary Blob memory leaks.
  - **Never passes through any third-party server** (zero upload endpoints, data stays off the cloud), completely eliminating privacy concerns.
- 🎨 **Stunning Aesthetic Design**: Carefully crafted Glassmorphism UI with smooth hover transitions, animated Toast feedback, and a fast-loading landing page with multiple theme color schemes.

---

## 🚀 Quick Start

### 1. Developer Mode Installation (Local Load)
1. Download or clone this repository to your local machine.
2. Open Chrome and navigate to `chrome://extensions/`.
3. Enable **Developer mode** using the toggle in the top-right corner.
4. Click **Load unpacked** in the top-left corner.
5. Select the `extension` folder from this repository (the directory containing `manifest.json`).
6. After installation, find **Codex Auth Exporter** in the puzzle icon on the browser toolbar and pin it.

### 2. Export `auth.json`
1. Make sure you are logged in to [ChatGPT](https://chatgpt.com/) in your current browser.
2. Click the extension icon in the top-right corner to open the **Codex Auth Exporter** popup.
3. The extension automatically reads the logged-in session. If not logged in, click **Go to ChatGPT Login**.
4. Once the status is detected, click **Export Auth Info** to download the assembled configuration file.

## 🔒 Security & Privacy Pledge

> [!IMPORTANT]
> Your identity credentials and session are extremely sensitive private data — **they must never be leaked or uploaded to any server**!

- **Zero Sensitive Data Collection**: This extension never collects, uploads, or forwards any personal privacy data or credentials.
- **Minimal Permission Declarations**: Only declares `downloads` (to save files) and `https://chatgpt.com/` (to securely read local sessions), eliminating any unnecessary risky behavior.
- **Fully Closed-Loop Code**: You can inspect `background.js` and `popup.js` at any time via browser DevTools (F12). No external or uncontrollable third-party CDN libraries are used — all static resources are bundled locally.

---

## 📜 License

This project is open-sourced under the [MIT License](LICENSE), allowing anyone to freely modify and redistribute it, provided that the original author attribution and license notice are preserved.
