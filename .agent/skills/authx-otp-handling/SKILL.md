---
name: authx-otp-handling
description: Maintain AuthX TOTP generation and OTP input handling, including totp.js RFC 6238 Web Crypto generation, content.js verification-form waiting, paste-first OTP fill, split digit-box fallback, single-field OTP input, and timing around code entry. Use when fixing TOTP generation, OTP fields stuck on early digits, or verification-code entry reliability.
---

# AuthX OTP Handling

Use this skill before changing TOTP generation or verification-code input.

## Files

- `totp.js`
- `content.js`

## Key Functions

- `AuthXTotp.generate`
- `fillTotpCode`
- `otpInputs`
- `firstSingleOtpInput`
- `fillOtpBox`
- `dispatchPasteEvent`

## Contract

- Generate TOTP locally with RFC 6238 HMAC-SHA1 through Web Crypto.
- Normalize TOTP secrets as Base32.
- Generate and enter TOTP only after the verification form appears or the workflow is explicitly waiting for it.
- Try paste-first OTP entry.
- If paste does not populate all boxes, fallback to split digit boxes.
- Re-query OTP inputs during fallback because focus and DOM can change after each digit.

## Guardrails

- Do not call external APIs for TOTP.
- Do not log TOTP secrets or generated codes.
- Prefer state checks and short waits over long fixed sleeps.
- Keep split-box handling tolerant of DOM re-rendering.

## Verify

Run:

```text
node --check content.js
node --check totp.js
```

Manual checks:

- valid TOTP secret generates a 6-digit code
- split OTP boxes receive all digits
- single OTP field receives full code
- invalid or missing TOTP secret produces a useful workflow error
