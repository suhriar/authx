(function attachAuthxContent() {
  if (globalThis.__AUTHX_CONTENT_READY__) {
    return;
  }
  globalThis.__AUTHX_CONTENT_READY__ = true;

  const REQUIRED_COOKIES = ["auth_token", "ct0"];
  const TYPE_DELAY_MIN_MS = 35;
  const TYPE_DELAY_MAX_MS = 90;
  const FIELD_SETTLE_MS = 500;
  const STEP_DELAY_MS = 800;
  const OTP_FIELD_READY_MS = 500;
  const OTP_BOX_WAIT_MS = 5000;
  const OTP_VERIFY_RETRIES = 3;
  const LOGIN_TIMEOUT_MS = 90000;

  const usernameSelectors = [
    'main input[name="username_or_email"]',
    'main input[autocomplete*="username"]',
    'main input[type="text"]',
    'input[name="username_or_email"]',
    'input[autocomplete="username"]',
    'input[autocomplete*="username"]',
    'input[name="text"]',
    'input[type="text"]',
  ];

  const passwordSelectors = ['input[name="password"]', 'input[type="password"]'];

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const randomDelay = (min, max) => Math.floor(min + Math.random() * (max - min + 1));

  async function throwIfCancelled() {
    const { authxCancel = false } = await chrome.storage.local.get("authxCancel");
    if (authxCancel) {
      throw new Error("Workflow stopped.");
    }
  }

  function isVisible(element) {
    if (!element) return false;
    const style = window.getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return (
      style.opacity !== "0" &&
      style.visibility !== "hidden" &&
      style.display !== "none" &&
      style.pointerEvents !== "none" &&
      rect.width > 0 &&
      rect.height > 0
    );
  }

  function visibleElements(selector) {
    return [...document.querySelectorAll(selector)].filter(isVisible);
  }

  function setNativeValue(element, value) {
    const prototype = Object.getPrototypeOf(element);
    const descriptor = Object.getOwnPropertyDescriptor(prototype, "value");
    descriptor?.set?.call(element, value);
    element.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function dispatchKeyEvents(element, value) {
    for (const key of value) {
      element.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
      element.dispatchEvent(new KeyboardEvent("keypress", { key, bubbles: true }));
      element.dispatchEvent(new KeyboardEvent("keyup", { key, bubbles: true }));
    }
  }

  function dispatchPasteEvent(element, value) {
    try {
      const data = new DataTransfer();
      data.setData("text/plain", value);
      element.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: data }));
      return true;
    } catch (_error) {
      return false;
    }
  }

  async function typeValue(element, value) {
    element.focus();
    element.click();
    setNativeValue(element, "");

    for (const char of value) {
      setNativeValue(element, element.value + char);
      await sleep(randomDelay(TYPE_DELAY_MIN_MS, TYPE_DELAY_MAX_MS));
    }
    await sleep(FIELD_SETTLE_MS);
    return element.value === value;
  }

  async function fillFirst(selectors, value) {
    const deadline = Date.now() + 8000;

    while (Date.now() < deadline) {
      await throwIfCancelled();
      for (const selector of selectors) {
        for (const candidate of visibleElements(selector)) {
          if (candidate.disabled || candidate.readOnly) continue;
          if (await typeValue(candidate, value)) {
            return true;
          }
        }
      }
      await sleep(250);
    }

    return false;
  }

  function firstEditable(elements) {
    return elements.find((element) => !element.disabled && !element.readOnly);
  }

  function formRootFor(input) {
    return input?.closest('form, [role="dialog"], [data-testid="sheetDialog"]') || document;
  }

  function visibleElementsIn(root, selector) {
    return [...root.querySelectorAll(selector)].filter(isVisible);
  }

  function inputLabelText(input) {
    const ariaLabel = input.getAttribute("aria-label") || "";
    const placeholder = input.getAttribute("placeholder") || "";
    const labeledBy = input.getAttribute("aria-labelledby") || "";
    const labeledByText = labeledBy
      .split(/\s+/)
      .map((id) => document.getElementById(id)?.innerText || document.getElementById(id)?.textContent || "")
      .join(" ");
    const parentText = input.closest("label, div")?.innerText || "";
    return [ariaLabel, placeholder, labeledByText, parentText].filter(Boolean).join(" ").toLowerCase();
  }

  function looksLikeUsernameInput(input) {
    if (!input || input.type === "password" || input.type === "hidden") return false;
    const attrs = [
      input.name,
      input.id,
      input.autocomplete,
      input.inputMode,
      input.type,
      inputLabelText(input),
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return /username|email|phone|text/.test(attrs) || input.required;
  }

  async function fillUsernameInputs(root, username) {
    const candidates = visibleElementsIn(root, "input")
      .filter((input) => !input.disabled && !input.readOnly && looksLikeUsernameInput(input))
      .sort((a, b) => Number(b.required) - Number(a.required));

    if (!candidates.length) {
      return true;
    }

    for (const input of candidates) {
      if (input.value.trim() === username) {
        continue;
      }
      if (!input.value.trim() || input.required || /username|email|phone/.test(inputLabelText(input))) {
        const filled = await typeValue(input, username);
        if (!filled) return false;
      }
    }

    return candidates.every((input) => !input.required || input.value.trim());
  }

  async function ensureUsernameInPasswordForm(passwordInput, username) {
    const root = formRootFor(passwordInput);
    const usernameInputs = visibleElementsIn(root, usernameSelectors.join(",")).filter((input) => input !== passwordInput);

    if (usernameInputs.length) {
      for (const usernameInput of usernameInputs) {
        if (usernameInput.value.trim() === username) {
          continue;
        }

        if (usernameInput.disabled || usernameInput.readOnly) {
          if (!usernameInput.value.trim()) return false;
          continue;
        }

        const filled = await typeValue(usernameInput, username);
        if (!filled) return false;
      }

      return usernameInputs.every((input) => !input.required || input.value.trim());
    }

    return fillUsernameInputs(root, username);
  }

  async function fillPasswordForm(username, password) {
    const deadline = Date.now() + 8000;

    while (Date.now() < deadline) {
      await throwIfCancelled();
      const passwordInput = firstEditable(visibleElements(passwordSelectors.join(",")));

      if (passwordInput) {
        const usernameReady = await ensureUsernameInPasswordForm(passwordInput, username);
        const passwordReady = passwordInput.value === password || (await typeValue(passwordInput, password));
        if (usernameReady && passwordReady) {
          return true;
        }
      }

      await sleep(250);
    }

    return false;
  }

  function elementText(element) {
    return (element.innerText || element.textContent || "").trim();
  }

  function clickFirst(labels, root = document) {
    const candidates = [...root.querySelectorAll('button, [role="button"], div[dir="ltr"], span')];
    const normalized = labels.map((label) => label.toLowerCase());

    for (const candidate of candidates.reverse()) {
      if (!isVisible(candidate)) continue;
      if (normalized.includes(elementText(candidate).toLowerCase())) {
        candidate.click();
        return true;
      }
    }

    return false;
  }

  function clickFormButton(labels) {
    const normalized = labels.map((label) => label.toLowerCase());
    const focusedInput =
      document.activeElement?.matches?.("input") && isVisible(document.activeElement) ? document.activeElement : null;
    const activeInput = focusedInput || visibleElements("input").at(-1);
    const root = formRootFor(activeInput);
    const buttons = [...root.querySelectorAll('button, [role="button"]')].filter((element) => {
      const rect = element.getBoundingClientRect();
      return isVisible(element) && rect.width > 40 && normalized.includes(elementText(element).toLowerCase());
    });

    const target = buttons.at(-1);
    if (target) {
      target.click();
      return true;
    }

    if (clickFirst(labels, root)) return true;
    document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    return false;
  }

  async function clickFormButtonAfterSettle(labels) {
    await sleep(FIELD_SETTLE_MS);
    return clickFormButton(labels);
  }

  function otpInputs() {
    const inputs = visibleElements("input").filter((input) => input.type !== "password");
    const scored = inputs
      .map((input) => {
        const box = input.getBoundingClientRect();
        const attrs = [
          input.name,
          input.id,
          input.autocomplete,
          input.inputMode,
          input.ariaLabel,
          input.placeholder,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        const looksLikeDigitBox = box.width >= 24 && box.width <= 100 && box.height >= 24 && box.height <= 90;
        const looksOtpRelated = /one-time|otp|code|verification|numeric|tel/.test(attrs);
        const score = Number(looksLikeDigitBox) + Number(looksOtpRelated) + Number(input.maxLength === 1);
        return { input, score, top: box.top, left: box.left };
      })
      .filter((item) => item.score > 0)
      .sort((a, b) => a.top - b.top || a.left - b.left);

    return scored.map((item) => item.input);
  }

  function firstSingleOtpInput() {
    return visibleElements("input")
      .filter((input) => input.type !== "password")
      .find((input) => input.maxLength >= 6 || input.name === "text" || input.inputMode === "numeric");
  }

  async function fillOtpBox(input, digit) {
    input.focus();
    input.click();
    setNativeValue(input, "");
    await sleep(randomDelay(40, 90));
    dispatchKeyEvents(input, digit);
    setNativeValue(input, digit);
    await sleep(randomDelay(80, 150));
    return input.value === digit;
  }

  function otpBoxesMatch(boxes, code) {
    return boxes.slice(0, code.length).every((box, index) => box.value === code[index]);
  }

  async function fillTotpCode(code) {
    const deadline = Date.now() + 10000;
    const boxDeadline = Date.now() + OTP_BOX_WAIT_MS;
    await sleep(OTP_FIELD_READY_MS);

    while (Date.now() < deadline) {
      await throwIfCancelled();
      let boxes = otpInputs();

      if (boxes.length >= code.length) {
        for (let attempt = 0; attempt < OTP_VERIFY_RETRIES; attempt += 1) {
          await throwIfCancelled();

          boxes = otpInputs();
          boxes[0].focus();
          boxes[0].click();
          dispatchPasteEvent(boxes[0], code);
          await sleep(250);
          boxes = otpInputs();
          if (otpBoxesMatch(boxes, code)) {
            return true;
          }

          for (let index = 0; index < code.length; index += 1) {
            boxes = otpInputs();
            if (!boxes[index]) break;
            if (boxes[index].value !== code[index]) {
              await fillOtpBox(boxes[index], code[index]);
            }
          }
          await sleep(250);
          boxes = otpInputs();
          if (otpBoxesMatch(boxes, code)) {
            return true;
          }
        }
        return false;
      }

      if (boxes.length > 1 && Date.now() < boxDeadline) {
        await sleep(250);
        continue;
      }

      const singleInput = firstSingleOtpInput();
      if (singleInput) {
        for (let attempt = 0; attempt < OTP_VERIFY_RETRIES; attempt += 1) {
          singleInput.focus();
          singleInput.click();
          dispatchPasteEvent(singleInput, code);
          setNativeValue(singleInput, code);
          await sleep(250);
          if (singleInput.value === code) {
            return true;
          }

          const filled = await typeValue(singleInput, code);
          await sleep(250);
          if (filled && singleInput.value === code) {
            return true;
          }
        }
        return false;
      }

      await sleep(250);
    }

    return false;
  }

  function detectState() {
    const path = window.location.pathname;
    const pageText = document.body?.innerText || "";

    if (path === "/home" || document.querySelector('[data-testid="SideNav_AccountSwitcher_Button"]')) {
      return "already_logged_in";
    }
    if (visibleElements(passwordSelectors.join(",")).length) {
      return "password";
    }
    if (/verification code|authentication code|two-factor|enter your code/i.test(pageText) || otpInputs().length > 0) {
      return "verification";
    }
    if (visibleElements(usernameSelectors.join(",")).length) {
      return "username";
    }
    if (/log in|sign in/i.test(pageText)) {
      return "logged_out";
    }

    return "unknown";
  }

  function loginErrorMessage() {
    const pageText = document.body?.innerText || "";
    const patterns = [
      { pattern: /incorrect\.?\s+please try again/i, message: "Incorrect verification code." },
      {
        pattern: /wrong password|incorrect password|password you entered (?:is|was) incorrect/i,
        message: "Incorrect password.",
      },
      {
        pattern: /couldn.t find (?:your|an active x) account|account doesn.t exist|active x account with that username/i,
        message: "Account not found.",
      },
      { pattern: /too many attempts|try again in a few minutes/i, message: "Too many attempts." },
      { pattern: /suspicious login|unusual login|temporarily locked|account locked/i, message: "Login blocked by X." },
      { pattern: /try again later|something went wrong/i, message: "X login returned an error." },
    ];
    return patterns.find(({ pattern }) => pattern.test(pageText))?.message || "";
  }

  async function waitForState(states, timeout = 12000) {
    const expected = Array.isArray(states) ? states : [states];
    const deadline = Date.now() + timeout;

    while (Date.now() < deadline) {
      await throwIfCancelled();
      const state = detectState();
      if (expected.includes(state)) return state;
      await sleep(500);
    }

    return detectState();
  }

  async function runLogin({ username, password, totpSecret, email = "" }, update) {
    const started = Date.now();
    let lastSubmittedStep = "";

    while (Date.now() - started < LOGIN_TIMEOUT_MS) {
      await throwIfCancelled();
      const loginError = loginErrorMessage();
      if (loginError) {
        throw new Error(loginError);
      }

      const state = detectState();

      if (state === "already_logged_in") {
        update("Already logged in");
        return { ok: true, state };
      }

      if (state === "logged_out") {
        update("Opening login");
        clickFirst(["Log in", "Sign in"]);
        await sleep(STEP_DELAY_MS);
        await throwIfCancelled();
        continue;
      }

      if (state === "unknown" && lastSubmittedStep) {
        if (lastSubmittedStep === "password") {
          update("Generating TOTP");
          const code = await globalThis.AuthXTotp.generate(totpSecret);
          const filled = await fillTotpCode(code);
          if (filled) {
            await clickFormButtonAfterSettle(["Continue", "Next", "Lanjutkan"]);
            lastSubmittedStep = "verification";
            await sleep(STEP_DELAY_MS);
            await throwIfCancelled();
          } else {
            await sleep(500);
          }
          continue;
        }

        await sleep(500);
        continue;
      }

      if (state === "username" && lastSubmittedStep === "username" && !email) {
        await sleep(500);
        continue;
      }

      if (state === "username" || state === "unknown") {
        update("Entering Username");
        const filled = await fillFirst(usernameSelectors, username);
        if (!filled) throw new Error("Username field not found.");
        await clickFormButtonAfterSettle(["Continue", "Next", "Lanjutkan"]);
        lastSubmittedStep = "username";
        await sleep(STEP_DELAY_MS);
        await throwIfCancelled();

        const nextState = await waitForState(["password", "verification", "already_logged_in", "username"], 8000);
        if (nextState === "username" && email) {
          update("Entering Email");
          await fillFirst(['input[name="text"]'], email);
          await clickFormButtonAfterSettle(["Continue", "Next", "Lanjutkan"]);
          lastSubmittedStep = "email";
          await sleep(STEP_DELAY_MS);
          await throwIfCancelled();
        }
        continue;
      }

      if (state === "password") {
        update("Entering Password");
        const filled = await fillPasswordForm(username, password);

        if (!filled) throw new Error("Password form not ready.");
        await clickFormButtonAfterSettle(["Continue", "Lanjutkan", "Log in", "Log In"]);
        lastSubmittedStep = "password";
        update("Waiting for TOTP form");
        await waitForState(["verification", "already_logged_in"], 12000);
        await throwIfCancelled();
        continue;
      }

      if (state === "verification") {
        update("Generating TOTP");
        const code = await globalThis.AuthXTotp.generate(totpSecret);
        const filled = await fillTotpCode(code);
        if (!filled) throw new Error("Verification field not found.");
        await clickFormButtonAfterSettle(["Continue", "Next", "Lanjutkan"]);
        lastSubmittedStep = "verification";
        await sleep(STEP_DELAY_MS);
        await throwIfCancelled();
        continue;
      }

      await sleep(500);
    }

    throw new Error("Login process timed out.");
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== "AUTHX_RUN_LOGIN") {
      return false;
    }

    const update = (status) => {
      try {
        const result = chrome.runtime.sendMessage({ type: "AUTHX_STATUS", status });
        if (result?.catch) result.catch(() => {});
      } catch (_error) {
        // Status updates are best-effort; the login workflow should continue.
      }
    };
    runLogin(message.account, update)
      .then((result) => sendResponse(result))
      .catch((error) => sendResponse({ ok: false, error: error?.message || "Authentication failed." }));

    return true;
  });
})();
