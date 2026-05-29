(function () {
  "use strict";

  const ROOT_ID = "chatgpt-deepdive-root";
  const MAX_SELECTED_TEXT = 500;
  const VIEW_PAD = 8;
  const FLOAT_GAP = 6;
  const INJECT_RETRY_MS = 250;
  const INJECT_MAX_MS = 25000;
  const POST_FILL_DELAY_MS = 400;

  const ALLOWED_HOSTS = new Set(["chatgpt.com", "chat.openai.com"]);

  if (!ALLOWED_HOSTS.has(location.hostname)) return;

  let deepdiveId = new URLSearchParams(location.search).get("deepdive");
  let isInjectionOnly = Boolean(deepdiveId);

  let enabled = true;
  let promptTemplate = "";
  let rootEl = null;
  let floatBtn = null;
  let overlayEl = null;
  let termLabelEl = null;
  let promptEl = null;
  let pendingSelection = "";
  let anchorRangeClone = null;

  function getSettings() {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: "deepdive.getSettings" }, (res) => {
        if (chrome.runtime.lastError || !res) {
          resolve({ enabled: true, promptTemplate: defaultTemplate() });
          return;
        }
        resolve(res);
      });
    });
  }

  function defaultTemplate() {
    return (
      'I\'m learning software engineering and came across the term "{term}".\n' +
      "Explain what it means in plain language with a brief example.\n" +
      "Keep it concise so I can return to my main topic quickly."
    );
  }

  function applyTemplate(term) {
    const tpl = promptTemplate || defaultTemplate();
    return tpl.replace(/\{term\}/g, term);
  }

  function isExtensionNode(node) {
    if (!node) return false;
    const el = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
    return !!(el && rootEl && rootEl.contains(el));
  }

  function selectionInPage(sel) {
    if (!sel?.rangeCount) return false;
    if (isExtensionNode(sel.anchorNode) || isExtensionNode(sel.focusNode)) return false;
    return true;
  }

  function trimSelection(text) {
    const t = (text || "").trim();
    if (!t) return "";
    if (t.length > MAX_SELECTED_TEXT) return t.slice(0, MAX_SELECTED_TEXT) + "…";
    return t;
  }

  function layoutFloatingButton(rect) {
    if (!floatBtn) return;
    floatBtn.style.display = "block";
    const btnW = floatBtn.offsetWidth || 100;
    const btnH = floatBtn.offsetHeight || 32;

    let top = rect.bottom + FLOAT_GAP;
    let left = rect.left;

    if (left + btnW > window.innerWidth - VIEW_PAD) {
      left = window.innerWidth - VIEW_PAD - btnW;
    }
    if (left < VIEW_PAD) left = VIEW_PAD;

    if (top + btnH > window.innerHeight - VIEW_PAD) {
      top = rect.top - FLOAT_GAP - btnH;
    }
    if (top < VIEW_PAD) {
      top = Math.max(VIEW_PAD, Math.min(rect.bottom + FLOAT_GAP, window.innerHeight - VIEW_PAD - btnH));
    }

    floatBtn.style.top = `${top}px`;
    floatBtn.style.left = `${left}px`;
  }

  function hideFloatingButton() {
    if (floatBtn) floatBtn.style.display = "none";
    pendingSelection = "";
    anchorRangeClone = null;
  }

  function syncFloatingButton() {
    if (!enabled || isInjectionOnly || !floatBtn) return;

    const sel = window.getSelection();
    if (sel?.rangeCount && selectionInPage(sel)) {
      const text = trimSelection(sel.toString());
      if (text) {
        pendingSelection = text;
        try {
          anchorRangeClone = sel.getRangeAt(0).cloneRange();
          layoutFloatingButton(anchorRangeClone.getBoundingClientRect());
          return;
        } catch {
          hideFloatingButton();
          return;
        }
      }
    }

    if (overlayEl && !overlayEl.hidden) return;
    hideFloatingButton();
  }

  async function showDialog() {
    if (!enabled) return;

    const term = pendingSelection;
    if (!term || !overlayEl || !promptEl) return;

    const settings = await getSettings();
    applySettings(settings);

    if (termLabelEl) {
      termLabelEl.innerHTML = "Selected: <strong></strong>";
      termLabelEl.querySelector("strong").textContent = term;
    }
    promptEl.value = applyTemplate(term);
    overlayEl.hidden = false;
    promptEl.focus();
    promptEl.setSelectionRange(promptEl.value.length, promptEl.value.length);
  }

  function hideDialog() {
    if (overlayEl) overlayEl.hidden = true;
  }

  function openDeepDive() {
    const prompt = (promptEl?.value || "").trim();
    if (!prompt) return;

    chrome.runtime.sendMessage({ type: "deepdive.open", prompt }, (res) => {
      if (chrome.runtime.lastError || !res?.ok) {
        showToast(
          res?.error === "disabled"
            ? "Deep Dive is disabled. Enable it from the extension popup."
            : "Could not open a new chat. Try again."
        );
        return;
      }
      hideDialog();
      hideFloatingButton();
      window.getSelection()?.removeAllRanges();
    });
  }

  function showToast(message) {
    const toast = document.createElement("div");
    toast.className = "cgdd-toast";
    toast.setAttribute("role", "status");
    toast.textContent = message;
    rootEl.appendChild(toast);
    setTimeout(() => toast.remove(), 6000);
  }

  function ensureUI() {
    if (rootEl) return;

    rootEl = document.createElement("div");
    rootEl.id = ROOT_ID;

    floatBtn = document.createElement("button");
    floatBtn.type = "button";
    floatBtn.className = "cgdd-floating-btn";
    floatBtn.textContent = "Deep dive";
    floatBtn.style.display = "none";
    floatBtn.addEventListener("mousedown", (e) => e.preventDefault());
    floatBtn.addEventListener("click", () => showDialog());

    overlayEl = document.createElement("div");
    overlayEl.className = "cgdd-overlay";
    overlayEl.hidden = true;
    overlayEl.innerHTML = `
      <div class="cgdd-dialog" role="dialog" aria-labelledby="cgdd-title">
        <h2 id="cgdd-title">Deep dive</h2>
        <p class="cgdd-term-label"></p>
        <textarea class="cgdd-prompt" placeholder="Edit your prompt…" rows="6"></textarea>
        <div class="cgdd-actions">
          <button type="button" class="cgdd-btn cgdd-btn-secondary" data-action="cancel">Cancel</button>
          <button type="button" class="cgdd-btn cgdd-btn-primary" data-action="submit">Deep dive</button>
        </div>
      </div>
    `;

    termLabelEl = overlayEl.querySelector(".cgdd-term-label");
    promptEl = overlayEl.querySelector(".cgdd-prompt");

    overlayEl.querySelector('[data-action="cancel"]').addEventListener("click", hideDialog);
    overlayEl.querySelector('[data-action="submit"]').addEventListener("click", openDeepDive);

    overlayEl.addEventListener("click", (e) => {
      if (e.target === overlayEl) hideDialog();
    });

    promptEl.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        hideDialog();
      } else if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        openDeepDive();
      }
    });

    rootEl.appendChild(floatBtn);
    rootEl.appendChild(overlayEl);
    document.documentElement.appendChild(rootEl);
  }

  function bindSelectionListeners() {
    document.addEventListener("mouseup", () => requestAnimationFrame(syncFloatingButton));
    document.addEventListener("selectionchange", () => {
      requestAnimationFrame(syncFloatingButton);
    });
    window.addEventListener("scroll", () => {
      if (!floatBtn || floatBtn.style.display === "none" || !anchorRangeClone) return;
      requestAnimationFrame(() => {
        try {
          layoutFloatingButton(anchorRangeClone.getBoundingClientRect());
        } catch {
          hideFloatingButton();
        }
      });
    }, { passive: true });
    window.addEventListener("resize", () => requestAnimationFrame(syncFloatingButton));
  }

  // --- Prompt injection (new tab) ---

  const COMPOSER_SELECTORS = [
    "div#prompt-textarea.ProseMirror[contenteditable='true']",
    "div#prompt-textarea[contenteditable='true']",
    "[contenteditable='true'][data-testid='prompt-textarea']",
    "div.ProseMirror[contenteditable='true']",
    "div[contenteditable='true'][role='textbox']",
    "div[contenteditable='true'][data-placeholder]",
  ];

  const SEND_SELECTORS = [
    'button[data-testid="send-button"]',
    'button[data-testid="composer-send-button"]',
    'button[aria-label="Send prompt"]',
    'button[aria-label="Send message"]',
    'button[aria-label*="Send"]',
    'form button[type="submit"]',
  ];

  function isVisible(el) {
    if (!el) return false;
    const style = window.getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden") return false;
    return el.getClientRects().length > 0;
  }

  function isButtonEnabled(btn) {
    if (!btn || !isVisible(btn)) return false;
    if (btn.disabled) return false;
    if (btn.getAttribute("aria-disabled") === "true") return false;
    return true;
  }

  function findComposer() {
    for (const selector of COMPOSER_SELECTORS) {
      const el = document.querySelector(selector);
      if (el && (el.isContentEditable || el.tagName === "TEXTAREA")) return el;
    }

    const host = document.querySelector("#prompt-textarea");
    if (host) {
      if (host.isContentEditable) return host;
      const inner = host.querySelector('[contenteditable="true"], .ProseMirror');
      if (inner?.isContentEditable) return inner;
    }

    for (const form of document.querySelectorAll("form")) {
      const editable = form.querySelector('[contenteditable="true"], textarea');
      if (editable) return editable;
    }

    const fallback = document.querySelector('[contenteditable="true"]');
    if (fallback) return fallback;

    return document.querySelector("textarea");
  }

  function findSendButton(requireEnabled) {
    for (const selector of SEND_SELECTORS) {
      const btn = document.querySelector(selector);
      if (!btn) continue;
      if (!requireEnabled || isButtonEnabled(btn)) return btn;
    }

    const composer = findComposer();
    if (composer) {
      const form = composer.closest("form");
      if (form) {
        const submit = form.querySelector('button[type="submit"]');
        if (submit && (!requireEnabled || isButtonEnabled(submit))) return submit;
        for (const btn of form.querySelectorAll("button")) {
          if (!requireEnabled || isButtonEnabled(btn)) return btn;
        }
      }
    }

    return null;
  }

  function getComposerText(el) {
    if (!el) return "";
    if (el.tagName === "TEXTAREA" || el.tagName === "INPUT") return el.value || "";
    return (el.innerText || el.textContent || "").trim();
  }

  function focusComposer(el) {
    el.focus();
    el.click();
    try {
      const range = document.createRange();
      range.selectNodeContents(el);
      range.collapse(false);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    } catch {
      /* ignore */
    }
  }

  function setComposerText(el, text) {
    if (!el || !text) return false;

    focusComposer(el);

    if (el.tagName === "TEXTAREA" || el.tagName === "INPUT") {
      const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
      if (setter) setter.call(el, text);
      else el.value = text;
      el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      return getComposerText(el).length > 0;
    }

    if (!el.isContentEditable) return false;

    try {
      const dt = new DataTransfer();
      dt.setData("text/plain", text);
      const pasted = el.dispatchEvent(
        new ClipboardEvent("paste", {
          bubbles: true,
          cancelable: true,
          clipboardData: dt,
        })
      );
      if (pasted && getComposerText(el).length > 0) {
        el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertFromPaste", data: text }));
        return true;
      }
    } catch {
      /* fall through to execCommand */
    }

    try {
      document.execCommand("selectAll", false, null);
      document.execCommand("delete", false, null);
    } catch {
      el.textContent = "";
    }

    const lines = text.split("\n");
    let inserted = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line) {
        el.dispatchEvent(
          new InputEvent("beforeinput", {
            bubbles: true,
            cancelable: true,
            inputType: "insertText",
            data: line,
          })
        );
        if (document.execCommand("insertText", false, line)) {
          inserted = true;
        } else {
          el.textContent = (el.textContent || "") + line;
          inserted = true;
        }
        el.dispatchEvent(
          new InputEvent("input", {
            bubbles: true,
            inputType: "insertText",
            data: line,
          })
        );
      }
      if (i < lines.length - 1) {
        document.execCommand("insertParagraph", false, null);
        el.dispatchEvent(
          new InputEvent("input", { bubbles: true, inputType: "insertParagraph" })
        );
      }
    }

    if (!inserted && !getComposerText(el)) {
      el.textContent = text;
      el.dispatchEvent(
        new InputEvent("input", { bubbles: true, inputType: "insertFromPaste", data: text })
      );
    }

    el.dispatchEvent(new Event("change", { bubbles: true }));
    return getComposerText(el).length > 0;
  }

  function dispatchEnter(composer) {
    const opts = {
      key: "Enter",
      code: "Enter",
      keyCode: 13,
      which: 13,
      bubbles: true,
      cancelable: true,
      composed: true,
    };
    for (const type of ["keydown", "keypress", "keyup"]) {
      composer.dispatchEvent(new KeyboardEvent(type, opts));
    }
  }

  function trySubmit(composer) {
    const sendBtn = findSendButton(true);
    if (sendBtn) {
      sendBtn.click();
      return true;
    }

    dispatchEnter(composer);

    const form = composer.closest("form");
    if (form) {
      form.requestSubmit?.();
      const submit = form.querySelector('button[type="submit"]');
      if (submit && isButtonEnabled(submit)) {
        submit.click();
        return true;
      }
    }

    return false;
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function waitForComposer() {
    const start = Date.now();
    while (Date.now() - start < INJECT_MAX_MS) {
      const composer = findComposer();
      if (composer && isVisible(composer)) return composer;
      await sleep(INJECT_RETRY_MS);
    }
    return null;
  }

  async function waitForSendReady(composer) {
    const start = Date.now();
    while (Date.now() - start < INJECT_MAX_MS) {
      if (getComposerText(composer).length > 0 && findSendButton(true)) return true;
      await sleep(INJECT_RETRY_MS);
    }
    return getComposerText(composer).length > 0;
  }

  function cleanDeepdiveUrl() {
    const url = new URL(location.href);
    url.searchParams.delete("deepdive");
    const next = url.pathname + url.search + url.hash;
    history.replaceState(null, "", next || "/");
  }

  function consumeSessionPrompt(id) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: "deepdive.consume", id }, (res) => {
        if (chrome.runtime.lastError || !res?.ok) {
          resolve(null);
          return;
        }
        resolve(res.prompt);
      });
    });
  }

  function deleteSessionPrompt(id) {
    chrome.runtime.sendMessage({ type: "deepdive.delete", id });
  }

  async function injectAndSend(prompt, id) {
    const composer = await waitForComposer();
    if (!composer) return false;

    let filled = false;
    for (let attempt = 0; attempt < 8 && !filled; attempt++) {
      filled = setComposerText(composer, prompt);
      if (!filled) await sleep(INJECT_RETRY_MS);
    }

    if (!filled) return false;

    await sleep(POST_FILL_DELAY_MS);
    await waitForSendReady(composer);
    await sleep(150);

    for (let i = 0; i < 5; i++) {
      trySubmit(composer);
      await sleep(400);
      if (document.querySelector("[data-message-author-role='user']")) {
        cleanDeepdiveUrl();
        deleteSessionPrompt(id);
        return true;
      }
      const sendBtn = findSendButton(true);
      if (sendBtn) sendBtn.click();
      await sleep(300);
    }

    if (getComposerText(composer).length > 0) {
      trySubmit(composer);
      await sleep(600);
      if (document.querySelector("[data-message-author-role='user']")) {
        cleanDeepdiveUrl();
        deleteSessionPrompt(id);
        return true;
      }
    }

    return false;
  }

  function resolveDeepdiveId() {
    return new Promise((resolve) => {
      if (deepdiveId) {
        resolve(deepdiveId);
        return;
      }
      chrome.runtime.sendMessage({ type: "deepdive.resolveForTab" }, (res) => {
        if (chrome.runtime.lastError || !res?.ok) {
          resolve(null);
          return;
        }
        resolve(res.id);
      });
    });
  }

  async function runInjectionFlow() {
    const id = await resolveDeepdiveId();
    if (!id) return;

    deepdiveId = id;
    isInjectionOnly = true;
    ensureUI();

    const prompt = await consumeSessionPrompt(id);
    if (!prompt) {
      showToast("Could not load the deep dive prompt. It may have expired.");
      cleanDeepdiveUrl();
      return;
    }

    const ok = await injectAndSend(prompt, id);
    if (!ok) {
      try {
        await navigator.clipboard.writeText(prompt);
        showToast("Prompt copied to clipboard — paste it into ChatGPT and send.");
      } catch {
        showToast("Could not auto-send. Paste your prompt manually.");
      }
      cleanDeepdiveUrl();
      deleteSessionPrompt(id);
    }
  }

  function applySettings(settings) {
    enabled = settings.enabled !== false;
    promptTemplate = settings.promptTemplate || defaultTemplate();
    if (!enabled) {
      hideDialog();
      hideFloatingButton();
    }
  }

  async function init() {
    applySettings(await getSettings());
    ensureUI();

    const pendingId = await resolveDeepdiveId();
    if (pendingId) {
      deepdiveId = pendingId;
      await runInjectionFlow();
      return;
    }

    bindSelectionListeners();

    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "sync") return;
      const next = {
        enabled,
        promptTemplate,
      };
      if (changes.enabled) next.enabled = changes.enabled.newValue !== false;
      if (changes.promptTemplate) next.promptTemplate = changes.promptTemplate.newValue;
      applySettings(next);
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
