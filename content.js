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
  const LOGIN_TIMEOUT_MS = 180000;

  const usernameSelectors = [
    'main input[name="username_or_email"]',
    'main input[autocomplete*="username"]',
    'main input[type="email"]',
    'main input[role="textbox"]',
    'main input[type="text"]',
    'input[name="username_or_email"]',
    'input[autocomplete="username"]',
    'input[autocomplete*="username"]',
    'input[type="email"]',
    'input[role="textbox"]',
    'input[data-testid*="username" i]',
    'input[data-testid*="email" i]',
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
      input.getAttribute("data-testid"),
      input.getAttribute("role"),
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

    // X may carry the identity from the previous step without rendering it
    // beside the password field. In that case the password can still be filled.
    const allInputs = visibleElementsIn(root, "input").filter((input) => input !== passwordInput);
    if (!allInputs.length) return true;
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

  function clickLikeUser(element) {
    const target = element?.closest?.('button, [role="button"], a, div[tabindex]') || element;
    if (!target) return false;
    const rect = target.getBoundingClientRect();
    const options = {
      bubbles: true,
      cancelable: true,
      composed: true,
      clientX: rect.left + rect.width / 2,
      clientY: rect.top + rect.height / 2,
      button: 0,
      buttons: 1,
    };

    target.dispatchEvent(new PointerEvent("pointerdown", options));
    target.dispatchEvent(new MouseEvent("mousedown", options));
    target.dispatchEvent(new PointerEvent("pointerup", { ...options, buttons: 0 }));
    target.dispatchEvent(new MouseEvent("mouseup", { ...options, buttons: 0 }));
    target.dispatchEvent(new MouseEvent("click", { ...options, buttons: 0 }));
    target.click?.();
    return true;
  }

  function hoverLikeUser(element) {
    const target = element?.closest?.('button, [role="button"], a, div[tabindex]') || element;
    if (!target) return false;
    const rect = target.getBoundingClientRect();
    const options = {
      bubbles: true,
      cancelable: true,
      composed: true,
      clientX: rect.left + rect.width / 2,
      clientY: rect.top + rect.height / 2,
    };

    target.dispatchEvent(new PointerEvent("pointerover", options));
    target.dispatchEvent(new MouseEvent("mouseover", options));
    target.dispatchEvent(new PointerEvent("pointerenter", options));
    target.dispatchEvent(new MouseEvent("mouseenter", options));
    target.dispatchEvent(new PointerEvent("pointermove", options));
    target.dispatchEvent(new MouseEvent("mousemove", options));
    return true;
  }

  async function hoverInstagramSidebar() {
    const x = 42;
    const points = [window.innerHeight * 0.35, window.innerHeight * 0.55, window.innerHeight - 170];

    for (const y of points) {
      const element = document.elementFromPoint(x, y);
      if (element) {
        hoverLikeUser(element);
        await sleep(250);
      }
    }
  }

  function clickFirst(labels, root = document) {
    const candidates = [...root.querySelectorAll('button, [role="button"], a, div[tabindex], div[dir="ltr"], span')];
    const normalized = labels.map((label) => label.toLowerCase());

    for (const candidate of candidates.reverse()) {
      if (!isVisible(candidate)) continue;
      if (normalized.includes(elementText(candidate).toLowerCase())) {
        return clickLikeUser(candidate);
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

  const instagramUsernameSelectors = [
    'input[name="username"]',
    'input[autocomplete="username"]',
    'input[aria-label*="username" i]',
    'input[aria-label*="email" i]',
    'input[type="text"]',
  ];
  const instagramPasswordSelectors = [
    'input[name="password"]',
    'input[autocomplete="current-password"]',
    'input[type="password"]',
  ];
  const instagramCodeSelectors = [
    'input[name="verificationCode"]',
    'input[autocomplete="one-time-code"]',
    'input[aria-label*="code" i]',
    'input[placeholder*="code" i]',
    'input[placeholder*="security" i]',
    'input[inputmode="numeric"]',
  ];

  function hasInstagramTwoFactorUrl() {
    return /\/accounts\/login\/(?:two_step_verification|two_factor)/i.test(window.location.href) || /two_step_verification|two_factor/i.test(window.location.href);
  }

  function hasInstagramTwoFactorText() {
    const pageText = document.body?.innerText || "";
    return /authentication app|6-digit (?:login )?code|security code|two-factor|two factor/i.test(pageText);
  }

  function hasInstagramAutomationWarning() {
    const pageText = document.body?.innerText || "";
    return /\/accounts\/scraping_warning/i.test(window.location.pathname) || /suspect automated behavior|automated behavior on your account/i.test(pageText);
  }

  function instagramErrorMessage() {
    const pageText = document.body?.innerText || "";
    if (/\/accounts\/suspended/i.test(window.location.pathname)) {
      return "Instagram human verification checkpoint.";
    }

    const patterns = [
      { pattern: /password (?:you entered )?(?:is|was) incorrect|incorrect password/i, message: "Incorrect password." },
      { pattern: /username you entered doesn.t belong|couldn.t find an account|user not found/i, message: "Instagram account not found." },
      { pattern: /please check the code|security code is incorrect|code you entered is incorrect/i, message: "Incorrect Instagram 2FA code." },
      { pattern: /try again later|wait a few minutes|temporarily blocked/i, message: "Instagram temporarily blocked login." },
      { pattern: /confirm you.re human|confirm that you.re human|takes about 30 seconds/i, message: "Instagram human verification checkpoint." },
      { pattern: /suspicious login attempt|confirm it.s you|checkpoint/i, message: "Instagram login checkpoint." },
    ];
    return patterns.find(({ pattern }) => pattern.test(pageText))?.message || "";
  }

  function isInstagramLoggedIn() {
    const path = window.location.pathname;
    const pageText = document.body?.innerText || "";
    if (/\/accounts\/login/i.test(path)) return false;
    if (/log in|sign up/i.test(pageText) && visibleElements(instagramPasswordSelectors.join(",")).length) return false;
    return (
      path === "/" ||
      /\/accounts\/onetap/i.test(path) ||
      Boolean(document.querySelector('a[href="/"], a[href="/direct/inbox/"], svg[aria-label="Home"], svg[aria-label="Instagram"]'))
    );
  }

  function instagramState() {
    const hasTwoFactorPageText = hasInstagramTwoFactorText();
    const hasPasswordInput = visibleElements(instagramPasswordSelectors.join(",")).length > 0;
    if (hasInstagramTwoFactorUrl() && hasTwoFactorPageText && !hasPasswordInput) {
      return "two_factor";
    }
    if (hasTwoFactorPageText && !hasPasswordInput) {
      return "two_factor";
    }
    if (isInstagramLoggedIn()) {
      return "logged_in";
    }
    if (visibleElements(instagramPasswordSelectors.join(",")).length) {
      return "login";
    }
    return "unknown";
  }

  async function waitForInstagramState(states, timeout = 15000) {
    const expected = Array.isArray(states) ? states : [states];
    const deadline = Date.now() + timeout;

    while (Date.now() < deadline) {
      await throwIfCancelled();
      const error = instagramErrorMessage();
      if (error) throw new Error(error);

      const state = instagramState();
      if (expected.includes(state)) {
        return state;
      }
      await sleep(500);
    }

    return instagramState();
  }

  async function clickInstagramButton(labels) {
    await sleep(FIELD_SETTLE_MS);
    return clickFirst(labels);
  }

  function instagramTwoFactorInput() {
    const candidates = visibleElements("input")
      .filter((input) => !input.disabled && !input.readOnly && input.type !== "password" && input.type !== "checkbox")
      .map((input) => {
        const attrs = [
          input.name,
          input.id,
          input.autocomplete,
          input.inputMode,
          input.type,
          input.placeholder,
          input.getAttribute("aria-label"),
          inputLabelText(input),
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        const isLoginIdentity = /username|email|phone|password/.test(attrs);
        const isCodeLike = /verification|one-time|security|code|numeric|tel/.test(attrs);
        return { input, isLoginIdentity, isCodeLike };
      })
      .filter((item) => item.isCodeLike && !item.isLoginIdentity);

    return candidates[0]?.input || null;
  }

  async function waitForInstagramTwoFactorReady(timeout = 20000) {
    const deadline = Date.now() + timeout;
    let sawTwoFactorUrlAt = 0;

    while (Date.now() < deadline) {
      await throwIfCancelled();
      const error = instagramErrorMessage();
      if (error) throw new Error(error);

      const hasTwoFactorUrl = hasInstagramTwoFactorUrl();
      const hasTwoFactorPageText = hasInstagramTwoFactorText();
      const hasPasswordInput = visibleElements(instagramPasswordSelectors.join(",")).length > 0;

      if (hasTwoFactorUrl && hasTwoFactorPageText && !hasPasswordInput) {
        sawTwoFactorUrlAt ||= Date.now();
      }

      const codeInput = instagramTwoFactorInput();
      const pageReady = sawTwoFactorUrlAt && codeInput && Date.now() - sawTwoFactorUrlAt >= 2500;
      if (pageReady) {
        await sleep(1000);
        return true;
      }

      await sleep(500);
    }

    return false;
  }

  async function dismissInstagramPrompts({ waitForPrompt = false } = {}) {
    const labels = ["Not now", "Not Now", "Lain kali", "Nanti", "Cancel"];
    for (let attempt = 0; attempt < 8; attempt += 1) {
      await throwIfCancelled();
      const dialog = [...document.querySelectorAll('[role="dialog"], div[aria-modal="true"]')].filter(isVisible).at(-1);
      const clicked = dialog ? clickFirst(labels, dialog) : clickFirst(labels);
      if (clicked) {
        await sleep(1000);
        continue;
      }
      if (!waitForPrompt) break;
      await sleep(750);
    }
  }

  async function closeInstagramTransientPanels() {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      document.dispatchEvent(new KeyboardEvent("keyup", { key: "Escape", bubbles: true }));
      await sleep(350);
    }
  }

  async function fillInstagramLoginForm(username, password, update) {
    update("Entering Instagram Username");
    const usernameFilled = await fillFirst(instagramUsernameSelectors, username);
    if (!usernameFilled) throw new Error("Instagram username field not found.");

    update("Entering Instagram Password");
    const passwordFilled = await fillFirst(instagramPasswordSelectors, password);
    if (!passwordFilled) throw new Error("Instagram password field not found.");

    await clickInstagramButton(["Log in", "Log In"]);
  }

  async function fillInstagramTwoFactor(totpSecret, update) {
    update("Waiting for Instagram 2FA page");
    const ready = await waitForInstagramTwoFactorReady();
    if (!ready) throw new Error("Instagram 2FA page did not finish loading.");

    update("Generating Instagram TOTP");
    const code = await globalThis.AuthXTotp.generate(totpSecret);
    const codeInput = instagramTwoFactorInput();
    const filled = codeInput ? await typeValue(codeInput, code) : false;
    if (!filled) throw new Error("Instagram 2FA field not found.");
    await clickInstagramButton(["Continue", "Confirm"]);
  }

  async function waitForManualInstagramDismiss(update, timeout = 120000) {
    update("Manual Instagram dismiss required");
    const deadline = Date.now() + timeout;

    while (Date.now() < deadline) {
      await throwIfCancelled();
      if (!hasInstagramAutomationWarning()) {
        await sleep(1500);
        return true;
      }
      await sleep(1000);
    }

    throw new Error("Instagram automated behavior warning was not dismissed.");
  }

  async function waitForInstagramSession({ username, password, totpSecret }, update) {
    const deadline = Date.now() + LOGIN_TIMEOUT_MS;
    let submittedLogin = false;
    let submittedTwoFactor = false;

    while (Date.now() < deadline) {
      await throwIfCancelled();
      if (hasInstagramAutomationWarning()) {
        await waitForManualInstagramDismiss(update);
        continue;
      }

      const error = instagramErrorMessage();
      if (error) throw new Error(error);

      if (isInstagramLoggedIn()) {
        update("Instagram ready for manual activity");
        return;
      }

      const hasPassword = visibleElements(instagramPasswordSelectors.join(",")).length > 0;
      const needsTwoFactor = hasInstagramTwoFactorText() || hasInstagramTwoFactorUrl();

      if (needsTwoFactor && !submittedTwoFactor) {
        update("Waiting for Instagram 2FA");
        await fillInstagramTwoFactor(totpSecret, update);
        submittedTwoFactor = true;
        await sleep(STEP_DELAY_MS);
        continue;
      }

      if (hasPassword && !submittedLogin) {
        await fillInstagramLoginForm(username, password, update);
        submittedLogin = true;
        const nextState = await waitForInstagramState(["two_factor", "logged_in"], 20000);
        if (nextState === "two_factor") {
          update("Waiting for Instagram 2FA");
          await fillInstagramTwoFactor(totpSecret, update);
          submittedTwoFactor = true;
        }
        await sleep(STEP_DELAY_MS);
        continue;
      }

      await dismissInstagramPrompts();
      await sleep(750);
    }

    throw new Error("Instagram login process timed out.");
  }

  async function scrollInstagramHome(update) {
    update("Scrolling Instagram home");
    await dismissInstagramPrompts();
    let unchangedLoads = 0;
    let previousHeight = document.documentElement.scrollHeight;

    for (let index = 0; index < 18 && unchangedLoads < 4; index += 1) {
      await throwIfCancelled();
      const distance = Math.floor(window.innerHeight * (1.25 + Math.random() * 0.55));
      window.scrollBy({ top: distance, behavior: "smooth" });
      await sleep(randomDelay(900, 1600));
      await dismissInstagramPrompts();

      const nearBottom = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 500;
      if (nearBottom) {
        window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "smooth" });
        await sleep(randomDelay(1800, 2800));
      }

      const currentHeight = document.documentElement.scrollHeight;
      if (currentHeight > previousHeight + 250) {
        previousHeight = currentHeight;
        unchangedLoads = 0;
      } else if (nearBottom) {
        unchangedLoads += 1;
      }
    }
  }

  function findInstagramMoreButton() {
    const candidates = visibleElements('button, [role="button"], a, div[tabindex]')
      .map((element) => {
        const rect = element.getBoundingClientRect();
        const label = [
          elementText(element),
          element.getAttribute("aria-label"),
          element.getAttribute("title"),
          ...[...element.querySelectorAll("svg")].map((svg) => svg.getAttribute("aria-label")),
        ]
          .filter(Boolean)
          .join(" ")
          .trim();

        return { element, label, rect };
      })
      .filter(({ label, rect }) => {
        const isMore = /(^|\s)(more|menu)(\s|$)/i.test(label);
        const isSidebarArea = rect.left < Math.min(260, window.innerWidth * 0.22) && rect.top > window.innerHeight * 0.45;
        const isCompactMoreArea =
          isSidebarArea &&
          rect.top > window.innerHeight * 0.65 &&
          rect.top < window.innerHeight - 110 &&
          rect.width >= 24 &&
          rect.height >= 24;
        return (isMore && isSidebarArea) || isCompactMoreArea;
      })
      .sort((a, b) => {
        const aIsLabeled = /(^|\s)(more|menu)(\s|$)/i.test(a.label);
        const bIsLabeled = /(^|\s)(more|menu)(\s|$)/i.test(b.label);
        if (aIsLabeled !== bIsLabeled) return Number(bIsLabeled) - Number(aIsLabeled);
        const targetTop = window.innerHeight - 170;
        return Math.abs(a.rect.top - targetTop) - Math.abs(b.rect.top - targetTop);
      });

    return candidates[0]?.element || null;
  }

  async function openInstagramMoreMenu() {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await throwIfCancelled();
      await hoverInstagramSidebar();
      const moreButton = findInstagramMoreButton();
      if (!moreButton) {
        await sleep(500);
        continue;
      }

      hoverLikeUser(moreButton);
      await sleep(900);

      const labeledMoreButton = findInstagramMoreButton();
      if (labeledMoreButton && clickLikeUser(labeledMoreButton)) {
        await sleep(1200);
        return true;
      }

      if (clickLikeUser(moreButton)) {
        await sleep(1200);
        return true;
      }
    }

    return false;
  }

  function findInstagramLogoutButton(root = document) {
    const candidates = [...root.querySelectorAll('button, [role="button"], a, div[tabindex], span, div[dir="ltr"]')]
      .filter(isVisible)
      .map((element) => {
        const rect = element.getBoundingClientRect();
        const text = elementText(element);
        const href = element.getAttribute("href") || "";
        return { element, rect, text, href };
      })
      .filter(({ text, href }) => /^(log out|logout)$/i.test(text) || /logout/i.test(href))
      .sort((a, b) => a.rect.top - b.rect.top || a.rect.left - b.rect.left);

    return candidates[0]?.element || null;
  }

  async function clickInstagramLogoutButton(timeout = 8000) {
    const deadline = Date.now() + timeout;

    while (Date.now() < deadline) {
      await throwIfCancelled();
      const dialog = [...document.querySelectorAll('[role="dialog"], div[aria-modal="true"]')].filter(isVisible).at(-1);
      const target = findInstagramLogoutButton(dialog || document);
      if (target && clickLikeUser(target)) {
        return true;
      }
      await sleep(500);
    }

    return false;
  }

  function isInstagramLoggedOut() {
    const path = window.location.pathname;
    const pageText = document.body?.innerText || "";
    const hasLoginForm =
      visibleElements(instagramUsernameSelectors.join(",")).length > 0 &&
      visibleElements(instagramPasswordSelectors.join(",")).length > 0;

    return /\/accounts\/login/i.test(path) || (hasLoginForm && /log in|log into instagram|sign up/i.test(pageText));
  }

  async function waitForInstagramLoggedOut(timeout = 5000) {
    const deadline = Date.now() + timeout;

    while (Date.now() < deadline) {
      await throwIfCancelled();
      if (isInstagramLoggedOut()) {
        await sleep(300);
        return true;
      }
      await sleep(300);
    }

    return isInstagramLoggedOut();
  }

  async function logoutInstagram(update) {
    update("Logging out Instagram");
    await dismissInstagramPrompts();
    await closeInstagramTransientPanels();

    const openedMenu = await openInstagramMoreMenu();
    if (!openedMenu) throw new Error("Instagram More button not found.");

    const clickedLogout = await clickInstagramLogoutButton();
    if (!clickedLogout) throw new Error("Instagram logout button not found.");

    await sleep(300);
  }

  async function runInstagramSession(account, update) {
    await waitForInstagramSession(account, update);
    update("Instagram ready for manual activity");
    return { ok: true };
  }

  async function finishInstagramSession(update) {
    update("Dismissing Instagram prompts");
    await dismissInstagramPrompts({ waitForPrompt: true });
    if (/\/accounts\/onetap/i.test(window.location.pathname)) {
      window.location.href = "/";
      await sleep(2500);
    }
    await scrollInstagramHome(update);
    await logoutInstagram(update);
    return { ok: true };
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    const update = (status) => {
      try {
        const result = chrome.runtime.sendMessage({ type: "AUTHX_STATUS", status });
        if (result?.catch) result.catch(() => {});
      } catch (_error) {
        // Status updates are best-effort; the login workflow should continue.
      }
    };

    if (message?.type === "AUTHX_RUN_LOGIN") {
      runLogin(message.account, update)
        .then((result) => sendResponse(result))
        .catch((error) => sendResponse({ ok: false, error: error?.message || "Authentication failed." }));
      return true;
    }

    if (message?.type === "AUTHX_RUN_INSTAGRAM_SESSION") {
      runInstagramSession(message.account, update)
        .then((result) => sendResponse(result))
        .catch((error) => sendResponse({ ok: false, error: error?.message || "Instagram workflow failed." }));
      return true;
    }

    if (message?.type === "AUTHX_FINISH_INSTAGRAM_SESSION") {
      finishInstagramSession(update)
        .then((result) => sendResponse(result))
        .catch((error) => sendResponse({ ok: false, error: error?.message || "Instagram finish workflow failed." }));
      return true;
    }

    return false;
  });
})();
