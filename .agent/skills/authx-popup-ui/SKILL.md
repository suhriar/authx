---
name: authx-popup-ui
description: Maintain the AuthX Chrome extension popup UI, including popup.html, popup.css, popup.js, account input behavior, password visibility toggle, status display, active-tab gating, save/delete actions, destination controls, and busy/stop workflow state. Use when changing popup layout, styling, field validation, or popup-facing workflow controls.
---

# AuthX Popup UI

Use this skill before changing the popup surface.

## Files

- `popup.html`
- `popup.css`
- `popup.js`

## Contract

- Enable `Login & Export` only when the active tab is X/Twitter, required fields are present, and no workflow is running.
- Required fields: username, password, TOTP secret.
- Preserve password exactly. Do not trim password values.
- Keep optional email under `Additional challenge fields`.
- Keep the password eye toggle local: only switch the popup input type between `password` and `text`.
- Disable save, delete, destination change, and password toggle while workflow is active.
- Show `Stop` only while workflow is active.

## Update Rules

- If adding an active workflow status, add it to `PROCESSING_STATUSES` in `popup.js`.
- Keep controls as accessible native buttons/inputs.
- Avoid adding UI libraries for this small extension.
- Keep the compact popup layout and existing color system unless the user asks for a redesign.

## Verify

Run:

```text
node --check popup.js
```

Check manually:

- password eye shows/hides without changing the value
- required fields enable/disable login correctly
- busy state disables controls and shows Stop
- finish/error state restores controls correctly
