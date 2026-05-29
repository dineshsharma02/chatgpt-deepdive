const DEFAULT_PROMPT_TEMPLATE =
  'I\'m learning software engineering and came across the term "{term}".\n' +
  "Explain what it means in plain language with a brief example.\n" +
  "Keep it concise so I can return to my main topic quickly.";

const enabledEl = document.getElementById("enabled");
const templateEl = document.getElementById("template");
const statusEl = document.getElementById("status");

let saveTimer = null;

function showStatus(msg) {
  statusEl.textContent = msg;
  clearTimeout(showStatus._t);
  showStatus._t = setTimeout(() => {
    statusEl.textContent = "";
  }, 2000);
}

function load() {
  chrome.storage.sync.get(["enabled", "promptTemplate"], (stored) => {
    enabledEl.checked = stored.enabled !== false;
    templateEl.value = stored.promptTemplate || DEFAULT_PROMPT_TEMPLATE;
  });
}

function save() {
  const enabled = enabledEl.checked;
  const promptTemplate = templateEl.value.trim() || DEFAULT_PROMPT_TEMPLATE;

  chrome.storage.sync.set({ enabled, promptTemplate }, () => {
    showStatus("Saved");
  });
}

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(save, 400);
}

enabledEl.addEventListener("change", save);
templateEl.addEventListener("input", scheduleSave);

load();
