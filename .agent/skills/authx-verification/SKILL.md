---
name: authx-verification
description: Verify AuthX changes before handoff, including JavaScript syntax checks, Chrome extension reload requirements, manual login/export smoke tests, regression matrix selection, documentation alignment, and final release checks. Use before finishing changes or when asked to test, validate, QA, or prepare a handoff for AuthX.
---

# AuthX Verification

Use this skill before handing off AuthX changes.

## Static Checks

Run checks relevant to touched files:

```text
node --check popup.js
node --check content.js
node --check background.js
node --check totp.js
```

There is no build step and no package manager requirement.

## Manual Browser Checks

1. Open `chrome://extensions`.
2. Reload the unpacked AuthX extension.
3. Reload any open `x.com` or `twitter.com` tab.
4. Open `https://x.com`.
5. Open the AuthX popup.
6. Confirm tab badge is active.
7. Enter username, password, and TOTP secret.
8. Toggle password visibility and confirm the value is unchanged.
9. Save account.
10. Click `Login & Export`.
11. Watch expected statuses:
    - `Entering Username`
    - `Entering Password`
    - `Waiting for TOTP form`
    - `Generating TOTP`
    - `Waiting for session cookies`
    - `Exporting Cookies`
    - `Finish: ...`
12. Confirm exported JSON has `auth_token` and `ct0`.

## Regression Matrix

Prioritize these when touching `content.js`:

- already logged-in account
- logged-out account from `x.com`
- password dialog with username already prefilled
- password dialog with username missing but editable
- optional email challenge
- split OTP boxes
- single OTP input
- wrong password
- invalid TOTP secret
- popup closed while workflow continues
- Stop button during workflow

## Documentation Checks

If behavior changes, update:

- `README.md` for user-facing behavior
- `PLAN.md` for project scope and maintenance plan
- `AGENT.md` for high-level agent rules
- `.agent/skills/*/SKILL.md` for focused maintenance instructions
