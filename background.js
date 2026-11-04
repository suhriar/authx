const AUTHX_COOKIE_URLS = ["https://x.com", "https://twitter.com"];
const REQUIRED_COOKIES = ["auth_token", "ct0"];
const COOKIE_WAIT_TIMEOUT_MS = 90000;
const TAB_READY_TIMEOUT_MS = 30000;
const X_APP_SETTLE_MS = 4000;
const AVATAR_PAGE_SETTLE_MS = 1200;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function cookieArrayToObject(cookies) {
  return cookies.reduce((result, cookie) => {
    result[cookie.name] = cookie.value;
    return result;
  }, {});
}

async function getCookieStoreIdForTab(tabId) {
  if (!Number.isInteger(tabId)) return "";
  const stores = await chrome.cookies.getAllCookieStores();
  const store = stores.find((candidate) => candidate.tabIds.includes(tabId));
  return store?.id || "";
}

async function getAllXCookies(storeId = "") {
  const cookieSets = await Promise.all(
    AUTHX_COOKIE_URLS.map((url) => chrome.cookies.getAll(storeId ? { url, storeId } : { url })),
  );
  const byName = new Map();

  for (const cookie of cookieSets.flat()) {
    byName.set(cookie.name, cookie);
  }

  return cookieArrayToObject([...byName.values()]);
}

function cookieUrl(cookie) {
  const domain = cookie.domain.replace(/^\./, "");
  return `${cookie.secure ? "https" : "http"}://${domain}${cookie.path || "/"}`;
}

async function clearXCookies(storeId = "") {
  const cookieSets = await Promise.all(
    AUTHX_COOKIE_URLS.map((url) => chrome.cookies.getAll(storeId ? { url, storeId } : { url })),
  );

  await Promise.all(
    cookieSets.flat().map((cookie) =>
      chrome.cookies.remove({
        url: cookieUrl(cookie),
        name: cookie.name,
        storeId: cookie.storeId,
      }),
    ),
  );
}

function missingRequiredCookies(cookies) {
  return REQUIRED_COOKIES.filter((name) => !cookies[name]);
}

async function setJobStatus(status, tone = "") {
  await chrome.storage.local.set({ authxJob: { status, tone, updatedAt: Date.now() } });
  try {
    await chrome.runtime.sendMessage({ type: "AUTHX_STATUS", status, tone });
  } catch (_error) {
    // The popup may be closed while the background workflow keeps running.
  }
}

async function setBatchReport(report) {
  const nextReport = { ...report, updatedAt: Date.now() };
  await chrome.storage.local.set({ authxBatchReport: nextReport });
  try {
    await chrome.runtime.sendMessage({ type: "AUTHX_BATCH_REPORT", report: nextReport });
  } catch (_error) {
    // The popup may be closed while the background workflow keeps running.
  }
  return nextReport;
}

async function throwIfCancelled() {
  const { authxCancel = false } = await chrome.storage.local.get("authxCancel");
  if (authxCancel) {
    const error = new Error("Workflow stopped.");
    error.authxStopped = true;
    throw error;
  }
}

async function sendTabMessage(tabId, message) {
  let lastError = null;

  for (let attempt = 0; attempt < 10; attempt += 1) {
    await throwIfCancelled();
    try {
      return await chrome.tabs.sendMessage(tabId, message);
    } catch (error) {
      lastError = error;
      try {
        await chrome.scripting.executeScript({
          target: { tabId },
          files: ["totp.js", "content.js"],
        });
      } catch (injectionError) {
        lastError = injectionError;
      }
      await sleep(500);
    }
  }

  const error = new Error(lastError?.message || "X content script did not become ready.");
  error.authxFatal = true;
  throw error;
}

async function waitForTabReady(tabId) {
  const deadline = Date.now() + TAB_READY_TIMEOUT_MS;

  while (Date.now() < deadline) {
    await throwIfCancelled();
    const tab = await chrome.tabs.get(tabId);
    if (tab.status === "complete" && /^https:\/\/([^/]+\.)?(x|twitter)\.com\//i.test(tab.url || "")) {
      return tab;
    }
    await sleep(250);
  }

  throw new Error("X tab did not finish loading.");
}

async function waitForAnyTabReady(tabId, matcher, timeoutMessage = "Tab did not finish loading.") {
  const deadline = Date.now() + TAB_READY_TIMEOUT_MS;

  while (Date.now() < deadline) {
    await throwIfCancelled();
    const tab = await chrome.tabs.get(tabId);
    if (tab.status === "complete" && matcher(tab)) {
      return tab;
    }
    await sleep(250);
  }

  throw new Error(timeoutMessage);
}

async function waitForXAppSettle(tabId) {
  await waitForTabReady(tabId);
  await sleep(X_APP_SETTLE_MS);
  await throwIfCancelled();
}

async function waitForSessionCookies(storeId = "") {
  const deadline = Date.now() + COOKIE_WAIT_TIMEOUT_MS;
  let cookies = {};

  while (Date.now() < deadline) {
    await throwIfCancelled();
    cookies = await getAllXCookies(storeId);
    if (missingRequiredCookies(cookies).length === 0) {
      return cookies;
    }
    await sleep(1000);
  }

  const missing = missingRequiredCookies(cookies);
  throw new Error(`Authentication failed. Missing cookies: ${missing.join(", ")}`);
}

async function downloadJsonFile(fileName, data) {
  const payload = JSON.stringify(data, null, 2);
  const url = `data:application/json;charset=utf-8,${encodeURIComponent(payload)}`;
  await chrome.downloads.download({
    url,
    filename: fileName,
    saveAs: false,
    conflictAction: "overwrite",
  });
}

async function uploadCredentialFile(uploadTarget, fileName, data) {
  const { avatarId, apiBaseUrl, authToken } = uploadTarget || {};
  if (!avatarId) throw new Error("Avatar ID not found.");
  if (!apiBaseUrl) throw new Error("Avatar API URL not found.");
  if (!authToken) throw new Error("Authorization token not found.");

  const endpoint = `${apiBaseUrl.replace(/\/$/, "")}/api/v1/backoffice/avatars/credential-file`;
  const formData = new FormData();
  const payload = JSON.stringify(data, null, 2);
  formData.append("avatar_id", avatarId);
  formData.append("credential_file", new Blob([payload], { type: "application/json" }), fileName);

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      accept: "application/json",
      Authorization: `Bearer ${authToken}`,
    },
    body: formData,
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Credential upload failed (${response.status}). ${text}`.trim());
  }
}

async function closeIncognitoTarget({ tabId, windowId }) {
  try {
    if (Number.isInteger(windowId)) {
      await chrome.windows.remove(windowId);
      return;
    }
    await chrome.tabs.remove(tabId);
  } catch (_error) {
    // The window or tab may already be closed by the user.
  }
}

async function openIncognitoXTab() {
  const createdWindow = await chrome.windows.create({
    url: "https://x.com",
    incognito: true,
    focused: true,
  });
  if (!createdWindow?.id) {
    throw new Error("Failed to create incognito X window.");
  }
  const populatedWindow = createdWindow.tabs?.length
    ? createdWindow
    : await chrome.windows.get(createdWindow.id, { populate: true }).catch(() => null);
  const [tab] = populatedWindow?.tabs?.length
    ? populatedWindow.tabs
    : await chrome.tabs.query({ windowId: createdWindow.id });
  if (!tab?.id) {
    throw new Error("Failed to open incognito X tab.");
  }
  const readyTab = await waitForTabReady(tab.id);
  return { ...readyTab, windowId: createdWindow.id };
}

function extractAvatarAccountFromPage() {
  const normalize = (value) => String(value || "").replace(/\s+/g, " ").trim();
  const handlePattern = /[A-Za-z0-9._]{3,32}/;
  const jwtPattern = /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/;
  const pageText = document.body?.innerText || document.body?.textContent || "";
  const lines = pageText
    .split(/\r?\n/)
    .map(normalize)
    .filter(Boolean);

  function valueByLabel(labels) {
    const escaped = labels.map((label) => label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
    const inline = new RegExp(`^(?:${escaped})\\s*:?[\\s\\u00a0]*(.+)$`, "i");
    const joined = lines.join("\n");
    const joinedMatch = joined.match(new RegExp(`(?:^|\\n)(?:${escaped})\\s*:?[\\s\\u00a0]*([^\\n]+)`, "i"));
    if (joinedMatch?.[1]) return normalize(joinedMatch[1]);

    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      const match = line.match(inline);
      if (match?.[1]) return normalize(match[1]);
      if (labels.some((label) => line.toLowerCase() === label.toLowerCase())) {
        const next = lines[index + 1] || "";
        if (next === ":") return normalize(lines[index + 2] || "");
        if (next) return normalize(next.replace(/^:\s*/, ""));
      }
    }

    return "";
  }

  function storageEntries(storage) {
    const entries = [];
    try {
      for (let index = 0; index < storage.length; index += 1) {
        const key = storage.key(index);
        entries.push([key, storage.getItem(key)]);
      }
    } catch (_error) {
      // Some pages can block storage reads; keep extraction best-effort.
    }
    return entries;
  }

  function authTokenFromPage() {
    const entries = [...storageEntries(localStorage), ...storageEntries(sessionStorage)];
    const preferred = entries.find(([key, value]) => /auth|access|token|jwt/i.test(key || "") && jwtPattern.test(value || ""));
    const fallback = preferred || entries.find(([, value]) => jwtPattern.test(value || ""));
    const token = fallback?.[1]?.match(jwtPattern)?.[0] || "";
    return token.replace(/^Bearer\s+/i, "");
  }

  function apiBaseFromPage() {
    const candidates = [];
    const addCandidate = (value) => {
      const text = String(value || "");
      const matches = text.match(/https?:\/\/[^\s"'<>\\]+/g) || [];
      for (const match of matches) {
        try {
          const url = new URL(match);
          if (/\/api(?:\/v\d+)?\//i.test(url.pathname)) {
            candidates.push(url.origin);
          }
        } catch (_error) {
          // Ignore malformed embedded URLs.
        }
      }
    };

    try {
      for (const entry of performance.getEntriesByType("resource")) {
        addCandidate(entry.name);
      }
    } catch (_error) {
      // Performance entries are best-effort only.
    }

    for (const [, value] of [...storageEntries(localStorage), ...storageEntries(sessionStorage)]) {
      addCandidate(value);
    }

    return candidates[0] || location.origin;
  }

  function avatarIdFromUrl() {
    const match = location.pathname.match(/^\/avatars\/([^/]+)\/?$/i);
    return match?.[1] || "";
  }

  function usernameFromPage() {
    const activeMatch = pageText.match(new RegExp(`(${handlePattern.source})\\s+Aktif\\b`, "i"));
    if (activeMatch?.[1]) return activeMatch[1];

    const heading = [...document.querySelectorAll("h1, h2, h3, strong")]
      .map((element) => normalize(element.innerText || element.textContent))
      .find((text) => new RegExp(`^${handlePattern.source}$`).test(text));
    if (heading) return heading;

    return (
      lines.find(
        (line) =>
          new RegExp(`^${handlePattern.source}$`).test(line) &&
          !/^(avatar|detail|aktif|kembali|twitter|password|2fa|agent|new)$/i.test(line),
      ) || ""
    );
  }

  return {
    username: usernameFromPage(),
    password: valueByLabel(["Password", "Kata Sandi"]),
    totpSecret: valueByLabel(["2FA", "TOTP", "TOTP Secret", "Two Factor"]),
    email: valueByLabel(["Email", "Alamat Email"]),
    uploadTarget: {
      avatarId: avatarIdFromUrl(),
      apiBaseUrl: apiBaseFromPage(),
      authToken: authTokenFromPage(),
    },
  };
}

function extractAvatarListContextFromPage() {
  function isVisible(element) {
    if (!element) return false;
    const style = window.getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0" && rect.width > 0 && rect.height > 0;
  }

  const rows = [...document.querySelectorAll("tbody tr.cursor-pointer")]
    .filter(isVisible)
    .map((row) => {
      const rect = row.getBoundingClientRect();
      const text = (row.innerText || row.textContent || "").replace(/\s+/g, " ").trim();
      const username = text.match(/@([A-Za-z0-9._]{1,32})/)?.[1] || "";
      return username
        ? {
            rowKey: username,
            username,
            text,
            top: rect.top,
            left: rect.left,
          }
        : null;
    })
    .filter(Boolean)
    .sort((a, b) => a.top - b.top || a.left - b.left)
    .map((row, index) => ({ ...row, rowIndex: index }));

  return {
    count: rows.length,
    rows,
    listUrl: location.href,
  };
}

function avatarSearchUrl(baseUrl, username) {
  const url = new URL(baseUrl);
  url.pathname = "/avatars";
  url.search = "";
  url.searchParams.set("page", "1");
  url.searchParams.set("search", username);
  return url.toString();
}

async function getAvatarAccountFromTab(tabId) {
  const [result] = await chrome.scripting.executeScript({
    target: { tabId },
    func: extractAvatarAccountFromPage,
  });
  return result?.result || {};
}

async function getAvatarListContextFromTab(tabId) {
  const [result] = await chrome.scripting.executeScript({
    target: { tabId },
    func: extractAvatarListContextFromPage,
  });
  return result?.result || { count: 0, rows: [], listUrl: "" };
}

async function clickAvatarRow(tabId, targetRow) {
  const [result] = await chrome.scripting.executeScript({
    target: { tabId },
    args: [targetRow],
    func: (target) => {
      function isVisible(element) {
        if (!element) return false;
        const style = window.getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0" && rect.width > 0 && rect.height > 0;
      }

      function clickLikeUser(element) {
        const rect = element.getBoundingClientRect();
        const options = {
          bubbles: true,
          cancelable: true,
          composed: true,
          clientX: rect.left + rect.width / 2,
          clientY: rect.top + rect.height / 2,
          button: 0,
          buttons: 1,
        };

        element.dispatchEvent(new PointerEvent("pointerdown", options));
        element.dispatchEvent(new MouseEvent("mousedown", options));
        element.dispatchEvent(new PointerEvent("pointerup", { ...options, buttons: 0 }));
        element.dispatchEvent(new MouseEvent("mouseup", { ...options, buttons: 0 }));
        element.dispatchEvent(new MouseEvent("click", { ...options, buttons: 0 }));
      }

      const rows = [...document.querySelectorAll("tbody tr.cursor-pointer")]
        .filter(isVisible)
        .map((row) => {
          const rect = row.getBoundingClientRect();
          const text = (row.innerText || row.textContent || "").replace(/\s+/g, " ").trim();
          const username = text.match(/@([A-Za-z0-9._]{1,32})/)?.[1] || "";
          return username ? { row, username, top: rect.top, left: rect.left } : null;
        })
        .filter(Boolean)
        .sort((a, b) => a.top - b.top || a.left - b.left);

      const match = rows.find((item) => item.username === target.username) || rows[target.rowIndex];
      if (!match?.row) {
        return { ok: false, error: "Avatar row not found." };
      }

      match.row.scrollIntoView({ block: "center" });
      const cells = [...match.row.querySelectorAll("td")].filter(isVisible);
      const clickTarget = cells.at(-1) || match.row;
      clickLikeUser(clickTarget);

      return { ok: true, clickedUsername: match.username };
    },
  });

  if (!result?.result?.ok) {
    throw new Error(result?.result?.error || "Failed to open avatar detail.");
  }
}

function assertAvatarAccountReady(account, uploadTarget) {
  if (!account?.username) throw new Error("Username is required.");
  if (!account?.password) throw new Error("Password is required.");
  if (!account?.totpSecret) throw new Error("TOTP Secret is required.");
  if (!uploadTarget?.avatarId) throw new Error("Avatar ID not found.");
  if (!uploadTarget?.apiBaseUrl) throw new Error("Avatar API URL not found.");
  if (!uploadTarget?.authToken) throw new Error("Authorization token not found.");
}

function isWorkflowInfrastructureError(error) {
  const message = error?.message || "";
  return /incognito (?:X )?window|incognito X tab|content script did not become ready|X tab did not finish loading|message channel closed|receiving end does not exist|extension context invalidated/i.test(message);
}

async function executeLoginExport({
  tabId,
  account,
  closeWindowOnFinish = false,
  windowId = null,
  strictAutomation = false,
  uploadTarget = null,
}) {
  await throwIfCancelled();
  const cookieStoreId = await getCookieStoreIdForTab(tabId);
  await setJobStatus("Starting login workflow");
  try {
    const loginResult = await sendTabMessage(tabId, { type: "AUTHX_RUN_LOGIN", account });
    await throwIfCancelled();
    if (loginResult && !loginResult.ok) {
      const error = new Error(loginResult.error || "Authentication failed.");
      error.authxFatal = true;
      throw error;
    }
  } catch (error) {
    if (error?.authxFatal || strictAutomation) {
      throw error;
    }
    await setJobStatus("Waiting for session cookies");
  }

  await setJobStatus("Exporting Cookies");
  await throwIfCancelled();
  const cookies = await waitForSessionCookies(cookieStoreId);
  const fileName = `${account.username}.json`;
  if (uploadTarget) {
    await setJobStatus("Uploading Cookies");
    await uploadCredentialFile(uploadTarget, fileName, cookies);
  } else {
    await downloadJsonFile(fileName, cookies);
  }
  if (closeWindowOnFinish) {
    await setJobStatus("Closing incognito window");
    await closeIncognitoTarget({ tabId, windowId });
  }

  return { fileName };
}

async function runWorkflow({
  tabId,
  account,
  closeWindowOnFinish = false,
  windowId = null,
  strictAutomation = false,
  uploadTarget = null,
}) {
  await chrome.storage.local.set({ account, authxCancel: false });
  await setJobStatus("Processing...", "");

  try {
    const { fileName } = await executeLoginExport({
      tabId,
      account,
      closeWindowOnFinish,
      windowId,
      strictAutomation,
      uploadTarget,
    });
    await chrome.storage.local.remove("account");
    await chrome.storage.local.remove("authxCancel");
    await setJobStatus(
      uploadTarget ? `Finish: uploaded ${fileName}` : `Finish: saved to Downloads as ${fileName}`,
      "success",
    );
  } catch (error) {
    if (error?.authxStopped || error?.message === "Workflow stopped.") {
      await setJobStatus("Workflow stopped.", "error");
      await chrome.storage.local.remove("authxCancel");
      return;
    }
    await chrome.storage.local.remove("authxCancel");
    await setJobStatus(error?.message || "Cookie export failed.", "error");
  }
}

async function runAvatarWorkflow({ account, uploadTarget }) {
  try {
    const { fileName } = await executeAvatarItemWorkflow({ account, uploadTarget });
    await chrome.storage.local.remove("account");
    await chrome.storage.local.remove("authxCancel");
    await setJobStatus(`Finish: uploaded ${fileName}`, "success");
  } catch (error) {
    await chrome.storage.local.remove("authxCancel");
    if (error?.authxStopped || error?.message === "Workflow stopped.") {
      await setJobStatus("Workflow stopped.", "error");
      return;
    }
    await setJobStatus(error?.message || "Cookie export failed.", "error");
  }
}

async function executeAvatarItemWorkflow({ account, uploadTarget }) {
  await chrome.storage.local.set({ account, authxCancel: false });
  await setJobStatus("Opening incognito X");
  let tab = null;
  try {
    tab = await openIncognitoXTab();
    const cookieStoreId = await getCookieStoreIdForTab(tab.id);
    await clearXCookies(cookieStoreId);
    await chrome.tabs.update(tab.id, { url: "https://x.com" });
    await waitForXAppSettle(tab.id);
    return await executeLoginExport({
      tabId: tab.id,
      windowId: tab.windowId,
      account,
      closeWindowOnFinish: true,
      strictAutomation: true,
      uploadTarget,
    });
  } catch (error) {
    if (tab?.id) {
      await closeIncognitoTarget({ tabId: tab.id, windowId: tab.windowId });
    }
    throw error;
  }
}

async function runAvatarBatchWorkflow({ tabId, batchUsernames = [] }) {
  const usernames = [...new Set(
    batchUsernames
      .map((username) => String(username || "").trim().replace(/^@/, ""))
      .filter(Boolean),
  )];

  if (!Number.isInteger(tabId) || usernames.length === 0) {
    throw new Error("Username list is empty.");
  }

  const sourceTab = await chrome.tabs.get(tabId);
  const baseUrl = sourceTab.url || "";
  await chrome.storage.local.set({ authxCancel: false, account: {} });
  let report = await setBatchReport({
    total: usernames.length,
    success: [],
    failed: [],
    startedAt: Date.now(),
  });

  try {
    for (const username of usernames) {
      await throwIfCancelled();
      try {
        await setJobStatus("Searching avatar");
        await chrome.tabs.update(tabId, { url: avatarSearchUrl(baseUrl, username), active: true });
        await waitForAnyTabReady(
          tabId,
          (tab) => {
            try {
              return /^\/avatars\/?$/i.test(new URL(tab.url || "").pathname);
            } catch (_error) {
              return false;
            }
          },
          "Avatar list did not finish loading.",
        );
        await sleep(AVATAR_PAGE_SETTLE_MS);

        const snapshot = await getAvatarListContextFromTab(tabId);
        const nextRow = (snapshot.rows || []).find((row) => row.username.toLowerCase() === username.toLowerCase());
        if (!nextRow) {
          throw new Error(`Avatar not found for username: ${username}`);
        }

        await setJobStatus("Opening avatar detail");
        await clickAvatarRow(tabId, nextRow);
        await waitForAnyTabReady(
          tabId,
          (tab) => {
            try {
              return /^\/avatars\/[^/]+\/?$/i.test(new URL(tab.url || "").pathname);
            } catch (_error) {
              return false;
            }
          },
          "Avatar detail did not finish loading.",
        );
        await sleep(AVATAR_PAGE_SETTLE_MS);

        await setJobStatus("Reading avatar detail");
        const { uploadTarget, ...account } = await getAvatarAccountFromTab(tabId);
        if (account.email) {
          account.email = account.email.trim();
        }
        assertAvatarAccountReady(account, uploadTarget);

        const { fileName } = await executeAvatarItemWorkflow({ account, uploadTarget });
        report = await setBatchReport({
          ...report,
          success: [...report.success, { username, fileName }],
        });
      } catch (error) {
        if (error?.authxStopped || error?.message === "Workflow stopped.") {
          throw error;
        }
        if (isWorkflowInfrastructureError(error)) {
          throw error;
        }
        const reason = error?.message || "Login failed.";
        report = await setBatchReport({
          ...report,
          failed: [...report.failed, { username, reason }],
        });
        await setJobStatus(`Skipped ${username}: ${reason}`);
        await sleep(1000);
      } finally {
        await chrome.storage.local.set({ account: {} });
      }
    }

    report = await setBatchReport({ ...report, completedAt: Date.now() });
    await chrome.storage.local.remove(["account", "authxCancel"]);
    await setJobStatus(`Finish: processed ${report.success.length} avatar(s), skipped ${report.failed.length}`, "success");
  } catch (error) {
    await chrome.storage.local.remove("authxCancel");
    if (error?.authxStopped || error?.message === "Workflow stopped.") {
      await setJobStatus("Workflow stopped.", "error");
      return;
    }
    await setJobStatus(error?.message || "Cookie export failed.", "error");
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "AUTHX_EXPORT_COOKIES") {
    getCookieStoreIdForTab(message.tabId)
      .then((storeId) => getAllXCookies(storeId))
      .then((cookies) => {
        sendResponse({ ok: true, cookies, missing: missingRequiredCookies(cookies) });
      })
      .catch((error) => {
        sendResponse({ ok: false, error: error?.message || "Failed to export cookies." });
      });

    return true;
  }

  if (message?.type === "AUTHX_START_WORKFLOW") {
    runWorkflow(message).catch((error) => setJobStatus(error?.message || "Cookie export failed.", "error"));
    sendResponse({ ok: true });
    return false;
  }

  if (message?.type === "AUTHX_START_AVATAR_WORKFLOW") {
    runAvatarWorkflow(message).catch((error) => setJobStatus(error?.message || "Cookie export failed.", "error"));
    sendResponse({ ok: true });
    return false;
  }

  if (message?.type === "AUTHX_START_AVATAR_BATCH_WORKFLOW") {
    runAvatarBatchWorkflow(message).catch((error) => setJobStatus(error?.message || "Cookie export failed.", "error"));
    sendResponse({ ok: true });
    return false;
  }

  if (message?.type === "AUTHX_STOP_WORKFLOW") {
    chrome.storage.local
      .set({ authxCancel: true })
      .then(() => setJobStatus("Stopping..."))
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: error?.message || "Failed to stop workflow." }));
    return true;
  }

  return false;
});
