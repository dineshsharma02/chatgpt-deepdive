const SESSION_PREFIX = "deepdive:";
const TAB_PREFIX = "deepdive-tab:";
const SESSION_TTL_MS = 5 * 60 * 1000;
const DEFAULT_PROMPT_TEMPLATE =
  'I\'m learning something and came across "{term}".\n' +
  "Could you explain it in a bit more detail so I can learn it better?";

const LEGACY_PROMPT_TEMPLATE =
  'I\'m learning software engineering and came across the term "{term}".\n' +
  "Explain what it means in plain language with a brief example.\n" +
  "Keep it concise so I can return to my main topic quickly.";

const DEFAULT_SETTINGS = {
  enabled: true,
  promptTemplate: DEFAULT_PROMPT_TEMPLATE,
};

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.sync.get(["enabled", "promptTemplate"], (stored) => {
    const updates = {};
    if (stored.enabled === undefined) updates.enabled = DEFAULT_SETTINGS.enabled;
    if (!stored.promptTemplate) {
      updates.promptTemplate = DEFAULT_PROMPT_TEMPLATE;
    } else if (stored.promptTemplate === LEGACY_PROMPT_TEMPLATE) {
      updates.promptTemplate = DEFAULT_PROMPT_TEMPLATE;
    }
    if (Object.keys(updates).length) {
      chrome.storage.sync.set(updates);
    }
  });
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "deepdive.getSettings") {
    chrome.storage.sync.get(["enabled", "promptTemplate"], (stored) => {
      sendResponse({
        enabled: stored.enabled !== false,
        promptTemplate: stored.promptTemplate || DEFAULT_PROMPT_TEMPLATE,
      });
    });
    return true;
  }

  if (message?.type === "deepdive.open") {
    const prompt = (message.prompt || "").trim();
    if (!prompt) {
      sendResponse({ ok: false, error: "empty_prompt" });
      return false;
    }

    chrome.storage.sync.get(["enabled"], async (stored) => {
      if (stored.enabled === false) {
        sendResponse({ ok: false, error: "disabled" });
        return;
      }

      try {
        const id = crypto.randomUUID();
        const key = SESSION_PREFIX + id;
        await chrome.storage.session.set({
          [key]: { prompt, createdAt: Date.now() },
        });
        const tab = await chrome.tabs.create({
          url: `https://chatgpt.com/?deepdive=${encodeURIComponent(id)}`,
          active: true,
        });
        await chrome.storage.session.set({
          [`${TAB_PREFIX}${tab.id}`]: { id, createdAt: Date.now() },
        });
        sendResponse({ ok: true, tabId: tab.id, id });
      } catch (err) {
        sendResponse({ ok: false, error: String(err?.message || err) });
      }
    });
    return true;
  }

  if (message?.type === "deepdive.consume") {
    const id = message.id;
    if (!id) {
      sendResponse({ ok: false, error: "missing_id" });
      return false;
    }

    const key = SESSION_PREFIX + id;
    chrome.storage.session.get([key], (result) => {
      const entry = result[key];
      if (!entry) {
        sendResponse({ ok: false, error: "not_found" });
        return;
      }
      if (Date.now() - entry.createdAt > SESSION_TTL_MS) {
        chrome.storage.session.remove(key);
        sendResponse({ ok: false, error: "expired" });
        return;
      }
      sendResponse({ ok: true, prompt: entry.prompt });
    });
    return true;
  }

  if (message?.type === "deepdive.delete") {
    const id = message.id;
    if (!id) {
      sendResponse({ ok: false });
      return false;
    }
    const keys = [SESSION_PREFIX + id];
    if (_sender?.tab?.id) keys.push(TAB_PREFIX + _sender.tab.id);
    chrome.storage.session.remove(keys, () => {
      sendResponse({ ok: true });
    });
    return true;
  }

  if (message?.type === "deepdive.resolveForTab") {
    const tabId = message.tabId ?? _sender?.tab?.id;
    if (!tabId) {
      sendResponse({ ok: false, error: "missing_tab" });
      return false;
    }
    const tabKey = TAB_PREFIX + tabId;
    chrome.storage.session.get([tabKey], (result) => {
      const entry = result[tabKey];
      if (!entry || Date.now() - entry.createdAt > SESSION_TTL_MS) {
        if (entry) chrome.storage.session.remove(tabKey);
        sendResponse({ ok: false, error: "not_found" });
        return;
      }
      sendResponse({ ok: true, id: entry.id });
    });
    return true;
  }

  return false;
});
