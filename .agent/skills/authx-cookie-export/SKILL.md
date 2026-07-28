---
name: authx-cookie-export
description: Maintain AuthX background cookie export behavior, including background.js workflow orchestration, x.com/twitter.com cookie collection, required auth_token and ct0 validation, Downloads fallback, custom folder export, status broadcasts, cancellation, and popup-closed continuity. Use when changing cookie export, session validation, destination handling, or background workflow completion.
---

# AuthX Cookie Export

Use this skill before changing cookie export or background workflow completion.

## Files

- `background.js`
- `popup.js`

## Key Functions

- `runWorkflow`
- `sendTabMessage`
- `waitForSessionCookies`
- `getAllXCookies`
- `missingRequiredCookies`
- `downloadJsonFile`
- `saveJsonFile` in `popup.js`

## Contract

- Collect cookies from `https://x.com` and `https://twitter.com`.
- Require `auth_token` and `ct0` before declaring success.
- Export all available cookies, not only required cookies.
- Transform cookie records into simple name/value JSON.
- Use Chrome Downloads as the default export path.
- Keep custom folder export optional through File System Access API and IndexedDB handles.
- Continue background cookie wait/export even if the popup closes.

## Guardrails

- Do not remove Downloads fallback.
- Do not require a custom folder before export.
- Keep status broadcasts best-effort.
- Keep cancellation checks inside long-running loops.
- Do not log cookie values.

## Verify

Run:

```text
node --check background.js
node --check popup.js
```

Manual checks:

- already logged-in account exports without login automation
- fresh login waits until `auth_token` and `ct0` exist
- exported JSON includes required cookies
- missing required cookies reports which cookies are missing
- Stop cancels cookie waiting
