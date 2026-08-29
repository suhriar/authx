const accountFields = ["username", "password", "totpSecret"];
const REQUIRED_COOKIES = ["auth_token", "ct0"];

const elements = {
  tabBadge: document.querySelector("#tabBadge"),
  status: document.querySelector("#status"),
  loginExport: document.querySelector("#loginExport"),
  stopWorkflow: document.querySelector("#stopWorkflow"),
  togglePassword: document.querySelector("#togglePassword"),
  batchSection: document.querySelector("#batchSection"),
  batchUsernames: document.querySelector("#batchUsernames"),
  batchCount: document.querySelector("#batchCount"),
  batchReportSection: document.querySelector("#batchReportSection"),
  batchReportSummary: document.querySelector("#batchReportSummary"),
  batchSuccessList: document.querySelector("#batchSuccessList"),
  batchFailedList: document.querySelector("#batchFailedList"),
  clearBatchReport: document.querySelector("#clearBatchReport"),
};

const LOGIN_BUTTON_LABEL = "Login";
const PROCESSING_STATUSES = new Set([
  "Processing...",
  "Searching avatar",
  "Opening avatar detail",
  "Reading avatar detail",
  "Starting login workflow",
  "Opening login",
  "Entering Username",
  "Entering Email",
  "Entering Password",
  "Waiting for TOTP form",
  "Generating TOTP",
  "Already logged in",
  "Extracting avatar data",
  "Opening incognito X",
  "Waiting for X to load",
  "Waiting for session cookies",
  "Exporting Cookies",
  "Uploading Cookies",
  "Closing incognito window",
  "Stopping...",
]);
let activeTabIsX = false;
let activeTabIsAvatar = false;
let activeTabIsAvatarList = false;
let avatarUploadTarget = null;
let challengeEmail = "";
let isWorking = false;

function field(id) {
  return document.querySelector(`#${id}`);
}

function setStatus(message, tone = "") {
  elements.status.textContent = message;
  elements.status.className = `status ${tone}`.trim();
}

function idleLoginButtonLabel() {
  return activeTabIsAvatarList ? "Batch Login" : LOGIN_BUTTON_LABEL;
}

function setBusy(isBusy) {
  isWorking = isBusy;
  elements.loginExport.textContent = isBusy ? "Processing..." : idleLoginButtonLabel();
  elements.stopWorkflow.hidden = !isBusy;
  elements.stopWorkflow.style.display = isBusy ? "block" : "none";
  elements.stopWorkflow.disabled = false;
  updateLoginAvailability();
  elements.togglePassword.disabled = isBusy;
}

function setPasswordVisible(isVisible) {
  const password = field("password");
  password.type = isVisible ? "text" : "password";
  elements.togglePassword.classList.toggle("is-visible", isVisible);
  elements.togglePassword.setAttribute("aria-label", isVisible ? "Hide password" : "Show password");
  elements.togglePassword.title = isVisible ? "Hide password" : "Show password";
}

function getAccountFromForm() {
  return accountFields.reduce((account, key) => {
    account[key] = key === "password" ? field(key).value : field(key).value.trim();
    return account;
  }, {});
}

function validateAccount(account) {
  if (!account.username) return "Username is required.";
  if (!account.password) return "Password is required.";
  if (!account.totpSecret) return "TOTP Secret is required.";
  return "";
}

function getMissingRequiredFields() {
  const account = getAccountFromForm();
  return ["username", "password", "totpSecret"].filter((key) => !account[key]);
}

function getBatchUsernames() {
  return (elements.batchUsernames?.value || "")
    .split(/[\s,]+/)
    .map((username) => username.trim().replace(/^@/, ""))
    .filter(Boolean);
}

function updateBatchCount() {
  const count = getBatchUsernames().length;
  if (elements.batchCount) {
    elements.batchCount.textContent = `${count} ${count === 1 ? "name" : "names"}`;
  }
  return count;
}

function renderReportList(list, items, emptyLabel, itemClass) {
  list.textContent = "";
  if (!items.length) {
    const emptyItem = document.createElement("li");
    emptyItem.textContent = emptyLabel;
    list.append(emptyItem);
    return;
  }

  for (const item of items) {
    const row = document.createElement("li");
    row.className = itemClass;
    row.textContent = item.reason ? `${item.username}: ${item.reason}` : item.username;
    list.append(row);
  }
}

function renderBatchReport(report = null) {
  const success = Array.isArray(report?.success) ? report.success : [];
  const failed = Array.isArray(report?.failed) ? report.failed : [];
  const hasReport = Boolean(report) && (success.length > 0 || failed.length > 0 || Number.isInteger(report.total));

  elements.batchReportSection.hidden = !hasReport;
  if (!hasReport) {
    elements.batchReportSummary.textContent = "0 success, 0 failed";
    elements.batchSuccessList.textContent = "";
    elements.batchFailedList.textContent = "";
    return;
  }

  elements.batchReportSummary.textContent = `${success.length} success, ${failed.length} failed`;
  renderReportList(elements.batchSuccessList, success, "Belum ada", "success");
  renderReportList(elements.batchFailedList, failed, "Belum ada", "failed");
}

async function clearBatchReport() {
  await chrome.storage.local.remove("authxBatchReport");
  renderBatchReport(null);
}

function updateLoginAvailability({ updateStatus = true } = {}) {
  const missingFields = getMissingRequiredFields();
  const avatarUploadReady =
    !activeTabIsAvatar || Boolean(avatarUploadTarget?.avatarId && avatarUploadTarget?.apiBaseUrl && avatarUploadTarget?.authToken);
  const batchCount = updateBatchCount();
  const avatarListReady = !activeTabIsAvatarList || batchCount > 0;
  const canLogin = activeTabIsAvatarList
    ? avatarListReady && !isWorking
    : (activeTabIsX || activeTabIsAvatar) && missingFields.length === 0 && avatarUploadReady && !isWorking;
  elements.loginExport.disabled = !canLogin;

  if (!updateStatus || isWorking) {
    return;
  }

  if (activeTabIsAvatar) {
    setStatus(missingFields.length || !avatarUploadReady ? "Reading avatar account data..." : "Ready to login.");
    return;
  }

  if (activeTabIsAvatarList) {
    setStatus(avatarListReady ? `Ready to search ${batchCount} username(s).` : "Paste username list to continue.", avatarListReady ? "" : "error");
    return;
  }

  if (!activeTabIsX) {
    setStatus("Open an avatar detail page to continue.", "error");
    return;
  }

  if (missingFields.length) {
    setStatus("Fill username, password, and TOTP secret to continue.", "error");
    return;
  }

  if (
    elements.status.classList.contains("error") ||
    elements.status.textContent === "Fill username, password, and TOTP secret to continue."
  ) {
    setStatus("Ready");
  }
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

function isXTab(tab) {
  return /^https:\/\/([^/]+\.)?(x|twitter)\.com\//i.test(tab?.url || "");
}

function isAvatarTab(tab) {
  try {
    const url = new URL(tab?.url || "");
    return /^\/avatars\/[^/]+\/?$/i.test(url.pathname);
  } catch (_error) {
    return false;
  }
}

function isAvatarListTab(tab) {
  try {
    const url = new URL(tab?.url || "");
    return /^\/avatars\/?$/i.test(url.pathname);
  } catch (_error) {
    return false;
  }
}

function isBatchBaseTab(tab) {
  try {
    const url = new URL(tab?.url || "");
    return /^https?:$/i.test(url.protocol) && !isXTab(tab) && !isAvatarTab(tab);
  } catch (_error) {
    return false;
  }
}

function setTabState(tab) {
  const isX = isXTab(tab);
  const isAvatar = isAvatarTab(tab);
  const isAvatarList = isAvatarListTab(tab) || isBatchBaseTab(tab);
  activeTabIsX = isX;
  activeTabIsAvatar = isAvatar;
  activeTabIsAvatarList = isAvatarList;
  if (!isAvatar) {
    avatarUploadTarget = null;
  }
  if (!isAvatarList) {
    elements.batchSection.hidden = true;
  } else {
    elements.batchSection.hidden = false;
  }

  if (isX) {
    elements.tabBadge.textContent = "x.com";
    elements.tabBadge.className = "badge ok";
    elements.loginExport.textContent = isWorking ? "Processing..." : idleLoginButtonLabel();
    updateLoginAvailability();
    return;
  }

  if (isAvatar) {
    elements.tabBadge.textContent = "Avatar";
    elements.tabBadge.className = "badge ok";
    elements.loginExport.textContent = isWorking ? "Processing..." : idleLoginButtonLabel();
    updateLoginAvailability();
    return;
  }

  if (isAvatarList) {
    elements.tabBadge.textContent = isAvatarListTab(tab) ? "Avatar List" : "Batch Base";
    elements.tabBadge.className = "badge ok";
    elements.loginExport.textContent = isWorking ? "Processing..." : idleLoginButtonLabel();
    updateLoginAvailability();
    return;
  }

  elements.tabBadge.textContent = "Unsupported";
  elements.tabBadge.className = "badge error";
  elements.loginExport.textContent = isWorking ? "Processing..." : idleLoginButtonLabel();
  updateLoginAvailability();
}

async function refreshTabState() {
  const tab = await getActiveTab();
  setTabState(tab);
  if (activeTabIsAvatar && !isWorking) {
    await loadAvatarAccountFromTab(tab);
  }
  if (activeTabIsAvatarList && !isWorking) {
    updateLoginAvailability();
  }
  return tab;
}

async function clearAccountData() {
  await chrome.storage.local.remove("account");
  challengeEmail = "";
  for (const key of accountFields) {
    field(key).value = "";
  }
  updateLoginAvailability({ updateStatus: false });
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

async function exportCookies() {
  const tab = await getActiveTab();
  const response = await chrome.runtime.sendMessage({ type: "AUTHX_EXPORT_COOKIES", tabId: tab?.id });
  if (!response?.ok) {
    throw new Error(response?.error || "Failed to export cookies.");
  }
  return response;
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

async function getAvatarAccountFromTab(tabId) {
  const [result] = await chrome.scripting.executeScript({
    target: { tabId },
    func: extractAvatarAccountFromPage,
  });
  return result?.result || {};
}

function applyAccountToForm(account) {
  for (const key of accountFields) {
    field(key).value = account[key] || "";
  }
}

async function loadAvatarAccountFromTab(tab) {
  try {
    setStatus("Reading avatar account data...");
    const { uploadTarget, ...account } = await getAvatarAccountFromTab(tab.id);
    avatarUploadTarget = uploadTarget || null;
    challengeEmail = account.email || "";
    applyAccountToForm(account);
    const accountError = validateAccount(account);
    if (accountError) {
      setStatus(accountError, "error");
      updateLoginAvailability({ updateStatus: false });
      return;
    }
    if (!avatarUploadTarget?.avatarId) {
      setStatus("Avatar ID not found.", "error");
      updateLoginAvailability({ updateStatus: false });
      return;
    }
    if (!avatarUploadTarget?.apiBaseUrl) {
      setStatus("Avatar API URL not found.", "error");
      updateLoginAvailability({ updateStatus: false });
      return;
    }
    if (!avatarUploadTarget?.authToken) {
      setStatus("Authorization token not found.", "error");
      updateLoginAvailability({ updateStatus: false });
      return;
    }
    updateLoginAvailability({ updateStatus: false });
    setStatus("Ready to login.");
  } catch (error) {
    setStatus(error?.message || "Failed to read avatar data.", "error");
    updateLoginAvailability({ updateStatus: false });
  }
}

async function loginAndExport() {
  const tab = await refreshTabState();
  if (!activeTabIsX && !activeTabIsAvatar && !activeTabIsAvatarList) {
    return;
  }

  let account = getAccountFromForm();
  if (challengeEmail) {
    account = { ...account, email: challengeEmail };
  }
  const messageType = activeTabIsAvatarList
    ? "AUTHX_START_AVATAR_BATCH_WORKFLOW"
    : activeTabIsAvatar
      ? "AUTHX_START_AVATAR_WORKFLOW"
      : "AUTHX_START_WORKFLOW";

  const accountError = activeTabIsAvatarList ? "" : validateAccount(account);
  if (accountError) {
    setStatus(accountError, "error");
    if (activeTabIsAvatar) {
      isWorking = false;
      elements.loginExport.textContent = idleLoginButtonLabel();
      elements.stopWorkflow.hidden = true;
      elements.stopWorkflow.style.display = "none";
      elements.stopWorkflow.disabled = false;
      elements.togglePassword.disabled = false;
    }
    return;
  }

  const batchUsernames = activeTabIsAvatarList ? getBatchUsernames() : [];
  if (activeTabIsAvatarList && batchUsernames.length === 0) {
    setStatus("Paste username list to continue.", "error");
    return;
  }

  if (
    activeTabIsAvatar &&
    !(avatarUploadTarget?.avatarId && avatarUploadTarget?.apiBaseUrl && avatarUploadTarget?.authToken)
  ) {
    setStatus("Avatar upload target not ready.", "error");
    return;
  }

  if (!isWorking) setBusy(true);
  try {
    setStatus("Processing...");
    if (activeTabIsAvatarList) {
      renderBatchReport(null);
      await chrome.storage.local.remove("authxBatchReport");
    }
    await chrome.storage.local.set({ account: activeTabIsAvatarList ? {} : account });
    const response = await chrome.runtime.sendMessage({
      type: messageType,
      tabId: tab.id,
      account: activeTabIsAvatarList ? null : account,
      uploadTarget: activeTabIsAvatar ? avatarUploadTarget : null,
      batchUsernames: activeTabIsAvatarList ? batchUsernames : [],
    });
    if (!response?.ok) {
      throw new Error(response?.error || "Failed to start AuthX workflow.");
    }
  } catch (error) {
    elements.loginExport.textContent = idleLoginButtonLabel();
    elements.stopWorkflow.hidden = true;
    elements.stopWorkflow.style.display = "none";
    elements.stopWorkflow.disabled = false;
    isWorking = false;
    elements.togglePassword.disabled = false;
    updateLoginAvailability({ updateStatus: false });
    setStatus(error?.message || "Cookie export failed.", "error");
  }
}

async function stopWorkflow() {
  elements.stopWorkflow.disabled = true;
  setStatus("Stopping...");
  try {
    await chrome.runtime.sendMessage({ type: "AUTHX_STOP_WORKFLOW" });
  } catch (error) {
    setStatus(error?.message || "Failed to stop workflow.", "error");
    elements.stopWorkflow.disabled = false;
  }
}

async function loadSavedState() {
  const { account = {}, authxJob = null, authxBatchReport = null } = await chrome.storage.local.get([
    "account",
    "authxJob",
    "authxBatchReport",
  ]);
  renderBatchReport(authxBatchReport);
  challengeEmail = account.email || "";
  for (const key of accountFields) {
    field(key).value = account[key] || "";
  }

  await refreshTabState();
  if (authxJob?.status) {
    if (authxJob.status.startsWith("Finish:") && !account.username) {
      await chrome.storage.local.remove("authxJob");
      elements.loginExport.textContent = idleLoginButtonLabel();
      updateLoginAvailability();
      return;
    }
    handleJobStatus(authxJob.status, authxJob.tone);
  }
}

async function handleJobStatus(status, tone = "") {
  setStatus(status, tone);

  if (PROCESSING_STATUSES.has(status) || status.startsWith("Skipped ")) {
    isWorking = true;
    elements.loginExport.textContent = "Processing...";
    elements.stopWorkflow.hidden = false;
    elements.stopWorkflow.style.display = "block";
    elements.stopWorkflow.disabled = false;
    elements.togglePassword.disabled = true;
    updateLoginAvailability({ updateStatus: false });
    return;
  }

  if (status.startsWith("Finish:")) {
    await clearAccountData();
    await chrome.storage.local.remove("authxJob");
    isWorking = false;
    elements.loginExport.textContent = "Finish";
    elements.stopWorkflow.hidden = true;
    elements.stopWorkflow.style.display = "none";
    elements.stopWorkflow.disabled = false;
    elements.togglePassword.disabled = false;
    updateLoginAvailability({ updateStatus: false });
    return;
  }

  if (tone === "error") {
    isWorking = false;
    elements.loginExport.textContent = idleLoginButtonLabel();
    elements.stopWorkflow.hidden = true;
    elements.stopWorkflow.style.display = "none";
    elements.stopWorkflow.disabled = false;
    elements.togglePassword.disabled = false;
    updateLoginAvailability({ updateStatus: false });
  }
}

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === "AUTHX_STATUS") {
    handleJobStatus(message.status, message.tone);
  }
  if (message?.type === "AUTHX_BATCH_REPORT") {
    renderBatchReport(message.report);
  }
});

elements.loginExport.addEventListener("click", () => {
  loginAndExport();
});

elements.stopWorkflow.addEventListener("click", () => {
  stopWorkflow();
});

elements.clearBatchReport.addEventListener("click", () => {
  clearBatchReport().catch((error) => setStatus(error?.message || "Failed to clear report.", "error"));
});

elements.togglePassword.addEventListener("click", () => {
  setPasswordVisible(field("password").type === "password");
});

field("username").addEventListener("input", () => {
  if (!isWorking && elements.loginExport.textContent === "Finish") {
    elements.loginExport.textContent = idleLoginButtonLabel();
  }
  updateLoginAvailability();
});

for (const key of ["password", "totpSecret"]) {
  field(key).addEventListener("input", () => {
    if (!isWorking && elements.loginExport.textContent === "Finish") {
      elements.loginExport.textContent = idleLoginButtonLabel();
    }
    updateLoginAvailability();
  });
}

elements.batchUsernames.addEventListener("input", () => {
  if (!isWorking && elements.loginExport.textContent === "Finish") {
    elements.loginExport.textContent = idleLoginButtonLabel();
  }
  updateLoginAvailability();
});

loadSavedState().catch((error) => setStatus(error?.message || "AuthX failed to initialize.", "error"));
