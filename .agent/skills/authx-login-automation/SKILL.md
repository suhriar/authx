---
name: authx-login-automation
description: Maintain AuthX X/Twitter login automation in content.js, including state detection, selectors, username entry, optional email challenge handling, password dialog validation, post-password TOTP-form waiting, transition timing, form button clicks, and prevention of username-step regressions after password submit. Use when fixing or extending the automated login workflow.
---

# AuthX Login Automation

Use this skill before changing X/Twitter login flow behavior.

## Main File

- `content.js`

## Key Functions

- `detectState`
- `waitForState`
- `fillFirst`
- `fillPasswordForm`
- `ensureUsernameInPasswordForm`
- `clickFormButton`
- `runLogin`

## Flow Contract

```text
logged_out -> click login
username -> fill username -> continue
username again with optional email -> fill email -> continue
password -> validate username field -> fill password -> continue
password submitted -> wait for TOTP form
verification -> generate and fill TOTP
already_logged_in -> finish login phase
```

## Guardrails

- After password submit, do not treat `unknown` as username. X transition screens can briefly look unknown.
- After username submit, do not retry username while the password dialog is still loading.
- Wait for the verification/TOTP form after password submit before generating or entering TOTP.
- In password dialogs, inspect the same form/dialog as the password input for a username field.
- Refill username only when the field is editable and missing or different.
- Accept read-only username fields only when they already contain a value.
- Preserve password exactly. Never trim, normalize, or lowercase it.

## Selector Rules

- Prefer visible inputs.
- Scope to closest `form`, `[role="dialog"]`, or `[data-testid="sheetDialog"]` when possible.
- Order selectors from specific to fallback.
- Keep button clicks label-based and visibility-checked.

## Verify

Run:

```text
node --check content.js
```

Manual checks:

- fresh login from logged-out X
- username step submits correctly
- optional email challenge works when shown
- password dialog with prefilled username submits correctly
- password dialog with missing editable username refills before password submit
- workflow reaches `Waiting for TOTP form` after password submit
