---
name: authx-cookie-export
description: Maintain AuthX background cookie export behavior, including background.js workflow orchestration, incognito X window creation for avatar workflows, active-tab cookie-store selection for normal/incognito sessions, x.com/twitter.com cookie collection, required auth_token and ct0 validation, Downloads fallback, custom folder export, status broadcasts, cancellation, incognito window close after export, and popup-closed continuity. Use when changing cookie export, session validation, destination handling, avatar export completion, or background workflow completion.
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
- Resolve the cookie store from the active login tab's `tabId`; incognito workflows must use the incognito `storeId`.
- Avatar-driven workflows open an incognito `x.com` window, clear X/Twitter cookies in that incognito store, wait for X to settle, run the standard login/export flow, and close that window only after export succeeds.
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
- Do not call `chrome.cookies.getAll({ url })` for workflow exports when a tab-specific `storeId` is available.

## Verify

Run:

```text
node --check background.js
node --check popup.js
```

Manual checks:

- already logged-in account exports without login automation
- incognito account exports incognito cookies, not normal-profile cookies
- fresh login waits until `auth_token` and `ct0` exist
- exported JSON includes required cookies
- missing required cookies reports which cookies are missing
- Stop cancels cookie waiting
