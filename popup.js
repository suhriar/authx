const accountFields = ["username", "password", "totpSecret", "email"];
const REQUIRED_COOKIES = ["auth_token", "ct0"];
const DB_NAME = "authx";
const DB_STORE = "handles";
const DESTINATION_KEY = "exportDestination";

const elements = {
  tabBadge: document.querySelector("#tabBadge"),
  status: document.querySelector("#status"),
  destinationName: document.querySelector("#destinationName"),
  downloadName: document.querySelector("#downloadName"),
  saveAccount: document.querySelector("#saveAccount"),
  clearAccount: document.querySelector("#clearAccount"),
  changeDestination: document.querySelector("#changeDestination"),
  destinationHelp: document.querySelector("#destinationHelp"),
  loginExport: document.querySelector("#loginExport"),
  stopWorkflow: document.querySelector("#stopWorkflow"),
  togglePassword: document.querySelector("#togglePassword"),
};

const LOGIN_BUTTON_LABEL = "Login & Export";
const PROCESSING_STATUSES = new Set([
  "Processing...",
  "Starting login workflow",
  "Opening login",
  "Entering Username",
  "Entering Email",
  "Entering Password",
  "Waiting for TOTP form",
  "Generating TOTP",
  "Already logged in",
  "Waiting for session cookies",
  "Exporting Cookies",
  "Stopping...",
]);
let activeTabIsX = false;
let isWorking = false;

function field(id) {
  return document.querySelector(`#${id}`);
}

function setStatus(message, tone = "") {
  elements.status.textContent = message;
  elements.status.className = `status ${tone}`.trim();
}

function setBusy(isBusy) {
  isWorking = isBusy;
  elements.loginExport.textContent = isBusy ? "Processing..." : LOGIN_BUTTON_LABEL;
  elements.stopWorkflow.hidden = !isBusy;
  elements.stopWorkflow.style.display = isBusy ? "block" : "none";
  elements.stopWorkflow.disabled = false;
  updateLoginAvailability();
  elements.saveAccount.disabled = isBusy;
  elements.clearAccount.disabled = isBusy;
  elements.changeDestination.disabled = isBusy;
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

function updateLoginAvailability({ updateStatus = true } = {}) {
  const missingFields = getMissingRequiredFields();
  const canLogin = activeTabIsX && missingFields.length === 0 && !isWorking;
  elements.loginExport.disabled = !canLogin;

  if (!updateStatus || isWorking) {
    return;
  }

  if (!activeTabIsX) {
    setStatus("Open x.com to enable Login & Export.", "error");
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

function setTabState(isX) {
  activeTabIsX = isX;

  if (isX) {
    elements.tabBadge.textContent = "x.com";
    elements.tabBadge.className = "badge ok";
    updateLoginAvailability();
    return;
  }

  elements.tabBadge.textContent = "No X tab";
  elements.tabBadge.className = "badge error";
  updateLoginAvailability();
}

async function refreshTabState() {
  const tab = await getActiveTab();
  setTabState(isXTab(tab));
  return tab;
}

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(DB_STORE);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
}

async function idbGet(key) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, "readonly");
    const request = tx.objectStore(DB_STORE).get(key);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result || null);
  });
}

async function idbSet(key, value) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, "readwrite");
    tx.objectStore(DB_STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function getStoredDestination() {
  return idbGet(DESTINATION_KEY);
}

async function ensureDestinationPermission(handle) {
  if (!handle) return false;
  const options = { mode: "readwrite" };
  if ((await handle.queryPermission(options)) === "granted") return true;
  return (await handle.requestPermission(options)) === "granted";
}

async function changeDestination() {
  if (!window.showDirectoryPicker) {
    throw new Error("Folder selection is not available in this browser.");
  }

  const handle = await window.showDirectoryPicker({ mode: "readwrite" });
  await idbSet(DESTINATION_KEY, handle);
  await chrome.storage.local.set({ exportDestinationName: handle.name });
  elements.destinationName.textContent = handle.name;
  elements.destinationHelp.textContent = "Custom destination selected. Exports will be saved to this folder.";
  setStatus(`Destination changed: ${handle.name}`, "success");
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

async function writeJsonFile(handle, fileName, data) {
  const fileHandle = await handle.getFileHandle(fileName, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(JSON.stringify(data, null, 2));
  await writable.close();
}

async function saveJsonFile(fileName, data) {
  const destination = await getStoredDestination();
  if (destination && (await ensureDestinationPermission(destination))) {
    await writeJsonFile(destination, fileName, data);
    return destination.name;
  }

  await downloadJsonFile(fileName, data);
  return "Downloads";
}

async function clearAccountData() {
  await chrome.storage.local.remove("account");
  for (const key of accountFields) {
    field(key).value = "";
  }
  elements.downloadName.textContent = "username.json";
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

async function loginAndExport() {
  const tab = await refreshTabState();
  if (!activeTabIsX) {
    return;
  }

  const account = getAccountFromForm();
  const accountError = validateAccount(account);
  if (accountError) {
    setStatus(accountError, "error");
    return;
  }

  setBusy(true);
  try {
    setStatus("Processing...");
    await chrome.storage.local.set({ account });
    const response = await chrome.runtime.sendMessage({ type: "AUTHX_START_WORKFLOW", tabId: tab.id, account });
    if (!response?.ok) {
      throw new Error(response?.error || "Failed to start AuthX workflow.");
    }
  } catch (error) {
    elements.loginExport.textContent = LOGIN_BUTTON_LABEL;
    elements.stopWorkflow.hidden = true;
    elements.stopWorkflow.style.display = "none";
    elements.stopWorkflow.disabled = false;
    isWorking = false;
    elements.saveAccount.disabled = false;
    elements.clearAccount.disabled = false;
    elements.changeDestination.disabled = false;
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
  const { account = {}, exportDestinationName = "", authxJob = null } = await chrome.storage.local.get([
    "account",
    "exportDestinationName",
    "authxJob",
  ]);
  for (const key of accountFields) {
    field(key).value = account[key] || "";
  }
  elements.destinationName.textContent = exportDestinationName || "Downloads";
  elements.destinationHelp.textContent = exportDestinationName
    ? "Custom destination selected. Exports will be saved to this folder."
    : "Default destination: Downloads. Use Change to export to a custom folder.";
  elements.downloadName.textContent = account.username ? `${account.username}.json` : "username.json";

  await refreshTabState();
  if (authxJob?.status) {
    if (authxJob.status.startsWith("Finish:") && !account.username) {
      await chrome.storage.local.remove("authxJob");
      elements.loginExport.textContent = LOGIN_BUTTON_LABEL;
      updateLoginAvailability();
      return;
    }
    handleJobStatus(authxJob.status, authxJob.tone);
  }
}

async function handleJobStatus(status, tone = "") {
  setStatus(status, tone);

  if (PROCESSING_STATUSES.has(status)) {
    isWorking = true;
    elements.loginExport.textContent = "Processing...";
    elements.stopWorkflow.hidden = false;
    elements.stopWorkflow.style.display = "block";
    elements.stopWorkflow.disabled = false;
    elements.saveAccount.disabled = true;
    elements.clearAccount.disabled = true;
    elements.changeDestination.disabled = true;
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
    elements.saveAccount.disabled = false;
    elements.clearAccount.disabled = false;
    elements.changeDestination.disabled = false;
    elements.togglePassword.disabled = false;
    updateLoginAvailability({ updateStatus: false });
    return;
  }

  if (tone === "error") {
    isWorking = false;
    elements.loginExport.textContent = LOGIN_BUTTON_LABEL;
    elements.stopWorkflow.hidden = true;
    elements.stopWorkflow.style.display = "none";
    elements.stopWorkflow.disabled = false;
    elements.saveAccount.disabled = false;
    elements.clearAccount.disabled = false;
    elements.changeDestination.disabled = false;
    elements.togglePassword.disabled = false;
    updateLoginAvailability({ updateStatus: false });
  }
}

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === "AUTHX_STATUS") {
    handleJobStatus(message.status, message.tone);
  }
});

elements.saveAccount.addEventListener("click", async () => {
  const account = getAccountFromForm();
  const accountError = validateAccount(account);
  if (accountError) {
    setStatus(accountError, "error");
    return;
  }
  await chrome.storage.local.set({ account });
  setStatus("Account saved.", "success");
});

elements.clearAccount.addEventListener("click", async () => {
  await clearAccountData();
  elements.loginExport.textContent = LOGIN_BUTTON_LABEL;
  setStatus("Account deleted.", "success");
});

elements.loginExport.addEventListener("click", () => {
  loginAndExport();
});

elements.stopWorkflow.addEventListener("click", () => {
  stopWorkflow();
});

elements.changeDestination.addEventListener("click", () => {
  changeDestination().catch((error) => setStatus(error?.message || "Destination change failed.", "error"));
});

elements.togglePassword.addEventListener("click", () => {
  setPasswordVisible(field("password").type === "password");
});

field("username").addEventListener("input", () => {
  const username = field("username").value.trim();
  elements.downloadName.textContent = username ? `${username}.json` : "username.json";
  if (!isWorking && elements.loginExport.textContent === "Finish") {
    elements.loginExport.textContent = LOGIN_BUTTON_LABEL;
  }
  updateLoginAvailability();
});

for (const key of ["password", "totpSecret"]) {
  field(key).addEventListener("input", () => {
    if (!isWorking && elements.loginExport.textContent === "Finish") {
      elements.loginExport.textContent = LOGIN_BUTTON_LABEL;
    }
    updateLoginAvailability();
  });
}

loadSavedState().catch((error) => setStatus(error?.message || "AuthX failed to initialize.", "error"));
