# AuthX Project Plan

## Objective

AuthX is a loadable Manifest V3 Chrome Extension that automates X/Twitter login and exports authenticated session cookies into a local JSON file.

The completed project should let a user:

1. Open `https://x.com`.
2. Open the AuthX popup.
3. Enter username, password, TOTP secret, and optional email challenge data.
4. Save the account locally.
5. Click **Login & Export**.
6. Let AuthX complete the login flow.
7. Export all available `x.com` and `twitter.com` cookies as `<username>.json`.

All credential handling, TOTP generation, cookie collection, and file export happen locally in the browser. No external APIs, telemetry, analytics, or cloud sync are used.

## Completed Scope

- Chrome Extension manifest, popup UI, background service worker, content script, and TOTP engine.
- Local account storage through `chrome.storage.local`.
- Password visibility toggle in the popup so the user can verify typed credentials.
- Active tab validation for `x.com` and `twitter.com`.
- Automated login state detection.
- Username, optional email challenge, password, and TOTP automation.
- Password dialog handling that verifies the username field before submitting password.
- TOTP-form waiting after password submit before generating and entering the code.
- Paste-first OTP entry with digit-by-digit fallback for split OTP inputs.
- Background cookie wait and export after successful authentication.
- Required cookie validation for `auth_token` and `ct0`.
- Download export fallback to the browser's Downloads folder.
- Optional custom export folder through the File System Access API.
- Stop button for cancelling an in-progress workflow.

## User Workflow

```text
Open x.com
  -> Open AuthX popup
  -> Enter account data
  -> Optional: use eye icon to verify password
  -> Save
  -> Optional: choose export destination
  -> Login & Export
  -> AuthX runs login automation
  -> AuthX waits for session cookies
  -> AuthX saves <username>.json
```

## Runtime Login Workflow

```text
Start workflow
  -> Validate active tab is X/Twitter
  -> Inject or message content scripts
  -> Detect current page state
  -> If logged out: open login
  -> If username form: enter username and continue
  -> If challenge username/email form appears: enter optional email when available
  -> If password dialog appears:
       - locate password form/dialog
       - verify username field is filled or refill it
       - enter password
       - verify password value
       - continue
  -> Wait for TOTP form
  -> Generate local RFC 6238 TOTP
  -> Fill verification code
       - paste full code first
       - fallback to digit boxes
  -> Continue
  -> Detect logged-in state or wait for cookies
  -> Export cookies
```

## Popup UI Plan

The popup is the user-facing control surface.

Implemented sections:

- Header with current X tab status.
- Account card:
  - username input
  - password input
  - password show/hide eye button
  - TOTP secret input
  - optional email challenge field inside details
  - save and delete buttons
- Export card:
  - destination name
  - output filename preview
  - change destination button
- Status and workflow controls:
  - status message
  - `Login & Export`
  - `Stop`

Key UX requirements:

- Login is enabled only when the active tab is X/Twitter and required fields are present.
- During workflow execution, account and destination controls are disabled.
- The stop button appears only while work is active.
- The password eye button only changes local input visibility.

## File Responsibilities

```text
authx/
├── manifest.json
├── popup.html
├── popup.css
├── popup.js
├── background.js
├── content.js
├── totp.js
├── public/assets/
├── README.md
└── PLAN.md
```

- `manifest.json`: MV3 extension metadata, permissions, host permissions, background worker, popup, icons, and content script registration.
- `popup.html`: Popup markup for account, export, status, and workflow controls.
- `popup.css`: Popup visual styling, including password visibility button styling.
- `popup.js`: Popup state, account storage, active-tab validation, password visibility toggle, destination selection, and workflow start/stop messages.
- `background.js`: Long-running workflow orchestration, cookie collection, required-cookie validation, Downloads export, and status broadcasts.
- `content.js`: X page automation, state detection, form filling, password-dialog validation, TOTP-form waiting, OTP input handling, and cancellation checks.
- `totp.js`: RFC 6238-compatible local TOTP generation using Web Crypto.
- `README.md`: User-facing installation, usage, security, and limitation notes.
- `PLAN.md`: Project-level implementation plan and maintenance map.

## Data Model

Account data stored in `chrome.storage.local`:

```json
{
  "username": "exampleuser",
  "password": "examplepassword",
  "totpSecret": "FBTSCVXXXXXXXXXXXX",
  "email": "optional@example.com"
}
```

Workflow status stored in `chrome.storage.local`:

```json
{
  "authxJob": {
    "status": "Waiting for TOTP form",
    "tone": "",
    "updatedAt": 1780000000000
  }
}
```

Custom export folder handle:

- Stored in IndexedDB under the `authx` database.
- Reuses File System Access API permissions when available.
- Falls back to Chrome Downloads when unavailable or not granted.

## Cookie Export Plan

Cookie sources:

```text
https://x.com
https://twitter.com
```

Required cookies:

```text
auth_token
ct0
```

Transformation:

```json
[
  { "name": "auth_token", "value": "abc123" },
  { "name": "ct0", "value": "def456" }
]
```

becomes:

```json
{
  "auth_token": "abc123",
  "ct0": "def456"
}
```

Output filename:

```text
<username>.json
```

## Status Messages

Expected workflow statuses:

- `Processing...`
- `Starting login workflow`
- `Opening login`
- `Entering Username`
- `Entering Email`
- `Entering Password`
- `Waiting for TOTP form`
- `Generating TOTP`
- `Already logged in`
- `Waiting for session cookies`
- `Exporting Cookies`
- `Stopping...`
- `Workflow stopped.`
- `Finish: saved to Downloads as <username>.json`

Error examples:

- `Username field not found.`
- `Password form not ready.`
- `Verification field not found.`
- `Login process timed out.`
- `Authentication failed. Missing cookies: auth_token, ct0`

## Security Plan

- Keep credentials in local browser storage only.
- Generate TOTP locally with Web Crypto.
- Collect cookies locally through Chrome extension APIs.
- Export cookies locally only.
- Avoid telemetry, analytics, cloud sync, and external API calls.
- Treat exported cookie JSON files as sensitive account access material.
- Preserve password characters exactly, including leading or trailing spaces.
- Password visibility toggle must never transmit or copy the password; it only switches the popup input type.

## Verification Plan

Static checks:

```text
node --check popup.js
node --check content.js
node --check background.js
node --check totp.js
```

Manual Chrome extension checks:

1. Open `chrome://extensions`.
2. Reload the unpacked AuthX extension.
3. Reload any existing `x.com` or `twitter.com` tabs so the latest content script is used.
4. Open `https://x.com`.
5. Open AuthX.
6. Confirm `x.com` tab badge is active.
7. Enter username, password, and TOTP secret.
8. Use the eye icon to verify password visibility toggles correctly.
9. Save account data.
10. Click `Login & Export`.
11. Confirm the workflow progresses through username, password, TOTP waiting, TOTP generation, cookie wait, and export.
12. Confirm `<username>.json` is saved and includes `auth_token` and `ct0`.

Edge cases to verify:

- Already logged-in account exports without login steps.
- Password dialog with both username and password fields.
- Password dialog where username is already prefilled.
- Password dialog where username needs to be refilled.
- TOTP split boxes fill all six digits.
- Single-field TOTP input accepts the full code.
- Popup closed during workflow still allows background cookie wait/export.
- Stop button cancels the workflow.
- Wrong credentials produce an error without clearing saved account data.

## Maintenance Notes

- X frequently changes login markup, labels, and input attributes. Keep selectors in `content.js` conservative and visible-element based.
- If OTP starts sticking again, inspect whether X changed split-box behavior and adjust `otpInputs`, paste handling, or per-digit fallback.
- If password submit regresses, inspect the form/dialog root around the password input before changing global username selectors.
- After changing content scripts, always reload the unpacked extension and target X tabs before testing.
- Keep `README.md` aligned with user-facing behavior and `PLAN.md` aligned with implementation scope.

## Future Enhancements

- Multi-account profiles in the popup.
- Sequential bulk export for multiple accounts.
- Per-account proxy or browser profile support.
- Export validation against an authenticated API endpoint.
- Scheduled cookie refresh.
- Import/export account configuration with encryption.
- More detailed debug logging behind a local-only developer toggle.
