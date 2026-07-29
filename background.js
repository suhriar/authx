const AUTHX_COOKIE_URLS = ["https://x.com", "https://twitter.com"];
const REQUIRED_COOKIES = ["auth_token", "ct0"];
const COOKIE_WAIT_TIMEOUT_MS = 90000;

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

async function throwIfCancelled() {
  const { authxCancel = false } = await chrome.storage.local.get("authxCancel");
  if (authxCancel) {
    const error = new Error("Workflow stopped.");
    error.authxStopped = true;
    throw error;
  }
}

async function sendTabMessage(tabId, message) {
  try {
    return await chrome.tabs.sendMessage(tabId, message);
  } catch (_error) {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["totp.js", "content.js"],
    });
    return chrome.tabs.sendMessage(tabId, message);
  }
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

async function runWorkflow({ tabId, account }) {
  await chrome.storage.local.set({ account, authxCancel: false });
  await setJobStatus("Processing...", "");

  try {
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
      if (error?.authxFatal) {
        throw error;
      }
      await setJobStatus("Waiting for session cookies");
    }

    await setJobStatus("Exporting Cookies");
    await throwIfCancelled();
    const cookies = await waitForSessionCookies(cookieStoreId);
    const fileName = `${account.username}.json`;
    await downloadJsonFile(fileName, cookies);
    await chrome.storage.local.remove("account");
    await chrome.storage.local.remove("authxCancel");
    await setJobStatus(`Finish: saved to Downloads as ${fileName}`, "success");
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
