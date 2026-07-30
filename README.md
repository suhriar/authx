# AuthX

**Authenticate. Export. Automate.**

AuthX is a Manifest V3 Chrome Extension for automating X (Twitter) login and exporting authenticated session cookies into a local JSON file.

The workflow can start from `x.com` or from an avatar detail page at any domain using the `/avatars/<id>` path. On `x.com`, open AuthX, enter the account credentials and TOTP secret, then click **Login & Export**. On an avatar page, AuthX reads the username, password, and 2FA secret from the page, opens `x.com` in incognito, logs in, exports cookies, and closes the incognito window after the export succeeds. By default it downloads to Downloads, and the destination can be changed from the popup.

## References

- Cookie-exporter UX and browser-local workflow: [suhriar/x-cookie-exporter](https://github.com/suhriar/x-cookie-exporter)
- X login automation reference: local Playwright script from the provided attachment

The Playwright reference was adapted into browser-native extension logic. AuthX ports the useful parts of that flow: robust username/password selectors, form button fallback clicks, password-dialog validation, TOTP-form waiting, split-box OTP handling, `auth_token` and `ct0` validation, and cookie transformation into a plain key-value JSON object.

## Features

- Store username, password, TOTP secret, and optional email locally.
- Show or hide the saved password field in the popup to verify typed credentials.
- Detect avatar detail pages with the `/avatars/<id>` path on any domain.
- Import username, password, and 2FA secret from an avatar detail page.
- Open `x.com` in incognito for avatar-driven login/export.
- Close the incognito window automatically after a successful export.
- Download cookie JSON to the browser's default Downloads folder.
- Change the export destination to a custom local folder when needed.
- Detect active `x.com` or `twitter.com` tabs before running.
- Export cookies from the active tab's cookie store, including incognito when the extension is enabled there.
- Automate username, password, and verification-code screens.
- Confirm the password dialog's username field is present or prefilled before submitting password.
- Wait for the verification-code form after password submit before generating and entering TOTP.
- Fill TOTP with paste-first handling and digit-by-digit fallback for split OTP boxes.
- Continue the export workflow from the background while X redirects to `/home`.
- Stop an in-progress workflow without clearing the entered account data.
- Generate RFC 6238-compatible 6-digit TOTP codes locally with Web Crypto.
- Export all available cookies from `x.com` and `twitter.com`.
- Transform Chrome cookie records into `{ "cookie_name": "cookie_value" }`.
- Download exports as `<username>.json`.
- Run without telemetry, analytics, cloud sync, or external API calls.

## Project Structure

```text
authx/
├── manifest.json
├── popup.html
├── popup.css
├── popup.js
├── background.js
├── content.js
├── totp.js
├── PLAN.md
└── README.md
```

## Installation

1. Open Chrome.
2. Go to `chrome://extensions`.
3. Enable **Developer mode**.
4. Click **Load unpacked**.
5. Select this project folder:

```text
/Users/macbook/Developer/project/authx
```

## Usage

1. Open `https://x.com`.
2. Open the AuthX extension popup.
3. Fill in:
   - Username
   - Password. Use the eye icon to show or hide the value before saving or running.
   - TOTP Secret
   - Optional email for extra X challenges
4. Click **Save**.
5. Optional: click **Change** in the Export section to choose a custom folder.
6. Click **Login & Export**.

During login, AuthX reports progress in the popup. After submitting the password, it waits for the TOTP form before generating and entering the code. If X shows a password dialog with both username and password fields, AuthX first checks that the username field is already filled, or fills it again when needed, then enters the password and continues.

## Avatar Page Usage

1. Open an avatar detail page whose path matches:

```text
/avatars/<avatar-id>
```

Example:

```text
https://tech-86.com/avatars/f620f12-18c9-48a0-92fe-eafeae1781ea
```

2. Open AuthX.
3. Confirm the tab badge shows `Avatar`.
4. Click **Import & Export**.

AuthX extracts the avatar username, password, and 2FA secret from the current page, opens `x.com` in incognito, clears X/Twitter cookies from that incognito cookie store, logs in, exports cookies from that same store, then closes the incognito window after saving `<username>.json`.

On success, AuthX saves:

```text
<username>.json
```

Example:

```text
Username.json
```

Example output:

```json
{
  "guest_id": "...",
  "guest_id_ads": "...",
  "guest_id_marketing": "...",
  "personalization_id": "...",
  "att": "...",
  "_twitter_sess": "...",
  "kdt": "...",
  "twid": "u=492162314",
  "ct0": "...",
  "auth_token": "..."
}
```

## Architecture

```text
AuthX
 ├── Popup UI
 ├── Credential Manager
 ├── TOTP Generator
 ├── Login Automation Engine
 ├── Session Validator
 ├── Cookie Export Engine
 └── Download Manager
```

## File Responsibilities

- `manifest.json`: Chrome Extension manifest, permissions, host access, service worker, and content scripts.
- `popup.html`: Extension dashboard for credentials, export destination, status, and workflow control.
- `popup.css`: Popup styling, including the password visibility toggle.
- `popup.js`: Storage, active-tab/avatar-page validation, avatar credential extraction, password visibility toggle, destination controls, and workflow start.
- `background.js`: Background workflow orchestration, incognito X window creation, active-tab cookie-store selection, cookie collection from `x.com` and `twitter.com`, incognito window close, account cleanup, and Downloads export.
- `content.js`: X page state detection, login form filling, password-dialog checks, button clicking, TOTP-form waiting, OTP handling, and session checks.
- `totp.js`: Local RFC 6238 TOTP generation using Web Crypto.

## Permissions

AuthX uses:

```json
{
  "permissions": ["storage", "cookies", "tabs", "activeTab", "scripting", "downloads"],
  "host_permissions": [
    "https://x.com/*",
    "https://*.x.com/*",
    "https://twitter.com/*",
    "https://*.twitter.com/*"
  ]
}
```

## Security Notes

- Credentials are stored in `chrome.storage.local`.
- Custom export folder handles are stored locally in IndexedDB only after the user clicks **Change**.
- TOTP generation happens locally.
- Cookie export happens locally.
- Cookie JSON files use Chrome's Downloads behavior by default.
- Exported cookies can grant account access. Keep generated JSON files private.
- Use dedicated testing accounts whenever possible.
- The password visibility toggle only changes the popup input display between hidden and visible. It does not send the password anywhere.
- Avatar page extraction uses `activeTab` and only reads the current page after the user opens the extension popup.

## Current Limitations

- X frequently changes its login UI, so selectors may need updates over time.
- Additional X security challenges can require email input.
- The popup can close while X redirects; the background service worker continues waiting for session cookies.
- Without a custom folder, files are saved using Chrome's default download location and filename conflict behavior.
- After changing extension files, reload the unpacked extension and any open `x.com` tab so Chrome uses the latest content script.
- Avatar-driven export requires the extension to be allowed in incognito so AuthX can automate the incognito `x.com` tab.

## Status

Implemented as a loadable vanilla JavaScript Chrome Extension. No build step is required.
