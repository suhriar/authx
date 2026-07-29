# AuthX Agent Maintenance Guide

This file is for future agents or maintainers working on AuthX. Use it as the quick project map before editing code.

## Project Summary

AuthX is a vanilla Manifest V3 Chrome Extension for automating X/Twitter login and exporting authenticated cookies as `<username>.json`.

There is no build step. The extension is loaded directly from this folder through `chrome://extensions` using **Load unpacked**.

Core rules:

- Keep all credential, TOTP, cookie, and export behavior local to the browser.
- Do not add telemetry, analytics, cloud sync, or external credential APIs.
- Preserve password values exactly. Do not trim password input.
- After changing content scripts, reload the unpacked extension and reload any open `x.com` or `twitter.com` tabs before testing.

## Files To Know

- `manifest.json`: Extension metadata, permissions, host permissions, popup, background service worker, and content scripts.
- `popup.html`: Popup structure for account, export destination, status, and workflow controls.
- `popup.css`: Popup styling, including the password eye toggle.
- `popup.js`: Popup state, account storage, active-tab validation, password visibility toggle, destination selection, and workflow start/stop.
- `background.js`: Workflow orchestration, active-tab cookie-store selection, content-script messaging, cookie waiting, cookie export, status broadcast, and cancellation handling.
- `content.js`: X/Twitter page automation, state detection, form filling, password-dialog validation, TOTP-form waiting, OTP entry, and cancellation checks.
- `totp.js`: Local RFC 6238 TOTP generation with Web Crypto.
- `README.md`: User-facing setup, usage, and security notes.
- `PLAN.md`: Full project scope, workflow, verification plan, and maintenance map.
- `.agent/skills/`: Project-local skill folders for common change types. Read the matching `SKILL.md` before editing a specific subsystem.

## Local Skills

Before making targeted changes, read the relevant local skill:

- `.agent/skills/authx-popup-ui/SKILL.md`: popup layout, controls, status handling, password eye toggle.
- `.agent/skills/authx-login-automation/SKILL.md`: X/Twitter selectors, state detection, username/email/password flow.
- `.agent/skills/authx-otp-handling/SKILL.md`: TOTP generation and verification-code input behavior.
- `.agent/skills/authx-cookie-export/SKILL.md`: background workflow, required cookies, download/custom destination behavior.
- `.agent/skills/authx-verification/SKILL.md`: syntax checks, manual browser checks, and regression matrix.

## Current Login Flow

```text
Popup starts workflow
  -> background.js stores account and sends AUTHX_RUN_LOGIN to the active tab
  -> content.js detects current X state
  -> logged out: click Log in / Sign in
  -> username: enter username and continue
  -> optional challenge: enter email when available
  -> password:
       - find password input
       - inspect the same form/dialog for username input
       - accept prefilled username or refill if editable
       - enter password
       - verify username/password readiness
       - continue
  -> wait for verification/TOTP form
  -> generate TOTP locally
  -> fill OTP:
       - paste full code first
       - fallback to split digit boxes
  -> continue
  -> wait for auth_token and ct0 cookies
  -> export cookies
```

## Sensitive Areas

### X Selectors

Most breakage will come from X changing login UI markup. Selector maintenance belongs mostly in `content.js`.

Before changing broad selectors:

- Prefer visible inputs only.
- Keep selectors scoped to the active form/dialog when possible.
- Avoid assuming a single page layout.
- Do not treat every visible text input as username after password has been submitted.

Important functions:

- `detectState`
- `usernameSelectors`
- `passwordSelectors`
- `fillPasswordForm`
- `ensureUsernameInPasswordForm`
- `waitForState`

### Password Step

The password screen can appear as a dialog with two fields: username and password. The username is often prefilled from the previous step.

Maintenance expectations:

- Verify username is present or already prefilled before password submit.
- Refill username only if the field is editable and missing/different.
- Never trim the password.
- Submit only after both username readiness and password readiness are confirmed.

### TOTP Step

TOTP should be generated only after the verification form appears or after the workflow is clearly waiting for it.

Maintenance expectations:

- Keep the post-password wait before generating TOTP.
- Prefer paste-first OTP entry because split boxes often handle paste better than synthetic typing.
- Keep digit-by-digit fallback for split OTP boxes.
- Re-query OTP inputs between digit fills because focus and DOM state may change after each digit.

Important functions:

- `fillTotpCode`
- `otpInputs`
- `firstSingleOtpInput`
- `fillOtpBox`

### Background Workflow

`background.js` allows the workflow to continue even if the popup closes.

Maintenance expectations:

- Keep status updates best-effort.
- Keep cancellation checks in long-running loops.
- Continue waiting for cookies after the content script finishes or redirects.
- Resolve cookies from the active tab's cookie store. Incognito exports must use the incognito `storeId`, not the default browser profile.
- Required cookies are `auth_token` and `ct0`.

## Popup Behavior

Required popup behavior:

- Disable login unless the active tab is X/Twitter and username/password/TOTP secret are present.
- Disable editing controls while workflow is running.
- Show `Stop` only during active workflow.
- Keep the password eye toggle local to the popup input.
- Do not clear account data on errors. Clearing should happen only on explicit delete or successful finish.

If adding new processing statuses, update `PROCESSING_STATUSES` in `popup.js` so the popup stays in busy mode correctly.

## Verification Checklist

Run syntax checks after JS changes:

```text
node --check popup.js
node --check content.js
node --check background.js
node --check totp.js
```

Manual test flow:

1. Reload AuthX in `chrome://extensions`.
2. Reload the target `x.com` tab.
3. Open AuthX popup.
4. Confirm the tab badge says `x.com`.
5. Enter username, password, and TOTP secret.
6. Toggle the password eye and confirm it shows/hides the same value.
7. Click `Save`.
8. Click `Login & Export`.
9. Confirm the status sequence reaches:
   - `Entering Username`
   - `Entering Password`
   - `Waiting for TOTP form`
   - `Generating TOTP`
   - `Waiting for session cookies`
   - `Exporting Cookies`
   - `Finish: ...`
10. Confirm exported JSON includes `auth_token` and `ct0`.

Regression cases to test when touching `content.js`:

- Already logged-in account.
- Password dialog with username already prefilled.
- Password dialog where username is missing and editable.
- TOTP split boxes.
- Single-field TOTP input.
- Wrong password.
- Missing/invalid TOTP secret.
- Popup closed while workflow continues.
- Stop button during workflow.

## Security Notes

- Exported cookies grant account access. Treat generated JSON as sensitive.
- Credentials and TOTP secrets are stored in `chrome.storage.local`.
- Custom export folder handles are stored in IndexedDB.
- Do not log credential values, TOTP secrets, TOTP codes, or cookie values.
- Do not add remote dependencies for login, TOTP, or cookie export.

## Maintenance Style

- Keep changes small and targeted.
- Prefer browser-native APIs already used in the project.
- Keep README user-facing and concise.
- Keep PLAN aligned with the implemented workflow.
- Update this file when future agents need a new project-specific rule.
