(function () {
  "use strict";

  const ROOT_ID = "chatgpt-deepdive-root";
  const MAX_SELECTED_TEXT = 500;
  const VIEW_PAD = 8;
  const FLOAT_GAP = 6;
  const INJECT_POLL_MS = 50;
  const COMPOSER_WAIT_MS = 12000;
  const PERSIST_CHECK_MS = 120;
  const PERSIST_STABLE_CHECKS = 2;
  const POST_FILL_DELAY_MS = 80;
  const SUBMIT_POLL_MS = 40;
  const SUBMIT_CONFIRM_MS = 2000;

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
      'I\'m learning something and came across "{term}".\n' +
      "Could you explain it in a bit more detail so I can learn it better?"
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
    'button#composer-submit-button[data-testid="send-button"]',
    'button[data-testid="send-button"]',
    'button[data-testid="composer-send-button"]',
    'button#send-button',
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
      if (!btn || !isVisible(btn)) continue;
      if (!requireEnabled || isButtonEnabled(btn)) return btn;
    }

    const composer = findComposer();
    if (composer) {
      const form = composer.closest("form");
      if (form) {
        for (const selector of SEND_SELECTORS) {
          const btn = form.querySelector(selector);
          if (btn && isVisible(btn) && (!requireEnabled || isButtonEnabled(btn))) return btn;
        }
        const submit = form.querySelector('button[type="submit"]');
        if (submit && isVisible(submit) && (!requireEnabled || isButtonEnabled(submit))) {
          return submit;
        }
        for (const btn of form.querySelectorAll("button")) {
          if (!isVisible(btn)) continue;
          const label = (btn.getAttribute("aria-label") || "").toLowerCase();
          if (label.includes("send") && (!requireEnabled || isButtonEnabled(btn))) return btn;
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
            composed: true,
            inputType: "insertText",
            data: line,
          })
        );
        if (document.execCommand("insertText", false, line)) {
          inserted = true;
        }
        el.dispatchEvent(
          new InputEvent("input", {
            bubbles: true,
            composed: true,
            inputType: "insertText",
            data: line,
          })
        );
      }
      if (i < lines.length - 1) {
        document.execCommand("insertParagraph", false, null);
        el.dispatchEvent(
          new InputEvent("input", { bubbles: true, composed: true, inputType: "insertParagraph" })
        );
      }
    }

    if (!inserted || !getComposerText(el)) {
      try {
        const dt = new DataTransfer();
        dt.setData("text/plain", text);
        el.dispatchEvent(
          new ClipboardEvent("paste", {
            bubbles: true,
            cancelable: true,
            clipboardData: dt,
          })
        );
      } catch {
        /* ignore */
      }
    }

    if (!getComposerText(el)) {
      el.textContent = text;
      el.dispatchEvent(
        new InputEvent("input", {
          bubbles: true,
          composed: true,
          inputType: "insertFromPaste",
          data: text,
        })
      );
    }

    el.dispatchEvent(new Event("change", { bubbles: true }));
    return getComposerText(el).length > 0;
  }

  function hasUserMessageInThread() {
    return Boolean(document.querySelector("[data-message-author-role='user']"));
  }

  function isResponseStreaming() {
    return Boolean(
      document.querySelector('button[data-testid="stop-button"]') ||
        document.querySelector('button[aria-label*="Stop"]') ||
        document.querySelector('[data-testid="stop-streaming-button"]')
    );
  }

  function wasMessageSubmitted(composer, pathBefore) {
    if (hasUserMessageInThread()) return true;
    if (isResponseStreaming()) return true;
    const pathNow = location.pathname;
    if (pathBefore !== pathNow && /^\/c\//.test(pathNow)) return true;
    // Do NOT treat an empty composer as success — ChatGPT SPA rehydration clears it mid-load.
    void composer;
    return false;
  }

  /** Nudge ProseMirror so Send handlers see non-empty editor state. */
  function syncProseMirrorState(composer, text) {
    focusComposer(composer);
    try {
      document.execCommand("selectAll", false, null);
      document.execCommand("insertText", false, text);
      composer.dispatchEvent(
        new InputEvent("input", {
          bubbles: true,
          composed: true,
          inputType: "insertText",
          data: text,
        })
      );
    } catch {
      /* ignore */
    }
  }

  function realClickButton(btn) {
    if (!btn) return false;
    try {
      const form = btn.closest("form");
      if (form) {
        if (typeof form.requestSubmit === "function") {
          form.requestSubmit(btn);
          return true;
        }
        form.submit();
        return true;
      }
    } catch {
      /* fall through */
    }

    try {
      btn.focus();
      const rect = btn.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const pointerInit = { bubbles: true, cancelable: true, composed: true, clientX: cx, clientY: cy, view: window };
      const mouseInit = { bubbles: true, cancelable: true, composed: true, clientX: cx, clientY: cy, view: window };
      btn.dispatchEvent(new PointerEvent("pointerover", pointerInit));
      btn.dispatchEvent(new PointerEvent("pointerenter", pointerInit));
      btn.dispatchEvent(new MouseEvent("mouseover", mouseInit));
      btn.dispatchEvent(new MouseEvent("mouseenter", mouseInit));
      btn.dispatchEvent(new PointerEvent("pointerdown", pointerInit));
      btn.dispatchEvent(new MouseEvent("mousedown", mouseInit));
      btn.dispatchEvent(new PointerEvent("pointerup", pointerInit));
      btn.dispatchEvent(new MouseEvent("mouseup", mouseInit));
      btn.dispatchEvent(new MouseEvent("click", mouseInit));
      btn.click();
      return true;
    } catch {
      try {
        btn.click();
        return true;
      } catch {
        return false;
      }
    }
  }

  function dispatchEnter(composer) {
    focusComposer(composer);
    const base = {
      key: "Enter",
      code: "Enter",
      keyCode: 13,
      which: 13,
      bubbles: true,
      cancelable: true,
      composed: true,
    };
    for (const type of ["keydown", "keypress", "keyup"]) {
      composer.dispatchEvent(new KeyboardEvent(type, base));
      document.dispatchEvent(new KeyboardEvent(type, base));
    }
  }

  function dispatchInsertParagraph(composer) {
    focusComposer(composer);
    composer.dispatchEvent(
      new InputEvent("beforeinput", {
        bubbles: true,
        cancelable: true,
        composed: true,
        inputType: "insertParagraph",
      })
    );
    composer.dispatchEvent(
      new InputEvent("input", {
        bubbles: true,
        composed: true,
        inputType: "insertParagraph",
      })
    );
  }

  function dispatchSubmitShortcut(composer) {
    focusComposer(composer);
    const isMac = navigator.platform.toUpperCase().includes("MAC");
    const base = {
      key: "Enter",
      code: "Enter",
      keyCode: 13,
      which: 13,
      bubbles: true,
      cancelable: true,
      composed: true,
      ctrlKey: !isMac,
      metaKey: isMac,
    };
    for (const type of ["keydown", "keypress", "keyup"]) {
      composer.dispatchEvent(new KeyboardEvent(type, base));
    }
  }

  async function waitForSubmitted(composer, pathBefore, maxMs) {
    const start = Date.now();
    while (Date.now() - start < maxMs) {
      if (wasMessageSubmitted(composer, pathBefore)) return true;
      await sleep(SUBMIT_POLL_MS);
    }
    return wasMessageSubmitted(composer, pathBefore);
  }

  async function performSubmitWithFallback(composer, prompt, { syncFirst = true } = {}) {
    if (syncFirst) {
      syncProseMirrorState(composer, prompt);
      await sleep(POST_FILL_DELAY_MS);
    }

    const pathBefore = location.pathname;
    let sendBtn = findSendButton(true) || findSendButton(false);

    if (sendBtn) {
      realClickButton(sendBtn);
      if (await waitForSubmitted(composer, pathBefore, SUBMIT_CONFIRM_MS)) return true;
    }

    dispatchEnter(composer);
    if (await waitForSubmitted(composer, pathBefore, SUBMIT_CONFIRM_MS)) return true;

    dispatchInsertParagraph(composer);
    if (await waitForSubmitted(composer, pathBefore, SUBMIT_CONFIRM_MS)) return true;

    dispatchSubmitShortcut(composer);
    if (await waitForSubmitted(composer, pathBefore, SUBMIT_CONFIRM_MS)) return true;

    sendBtn = findSendButton(false);
    if (sendBtn) {
      realClickButton(sendBtn);
      if (await waitForSubmitted(composer, pathBefore, SUBMIT_CONFIRM_MS)) return true;
    }

    const form = composer.closest("form");
    if (form?.requestSubmit) {
      form.requestSubmit();
      if (await waitForSubmitted(composer, pathBefore, SUBMIT_CONFIRM_MS)) return true;
    }

    return false;
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function waitForComposerFast() {
    const start = Date.now();
    while (Date.now() - start < COMPOSER_WAIT_MS) {
      const composer = findComposer();
      if (composer && isVisible(composer) && findSendButton(false)) return composer;
      await sleep(INJECT_POLL_MS);
    }
    return findComposer();
  }

  function fillComposer(composer, prompt) {
    setComposerText(composer, prompt);
    syncProseMirrorState(composer, prompt);
  }

  /** Fill quickly; re-fill only if ChatGPT SPA clears the composer. */
  async function ensurePromptPersists(prompt, maxMs = 3000) {
    const start = Date.now();
    let stableChecks = 0;

    while (Date.now() - start < maxMs) {
      const composer = findComposer();
      if (!composer) {
        stableChecks = 0;
        await sleep(INJECT_POLL_MS);
        continue;
      }

      if (promptStillPresent(composer, prompt)) {
        stableChecks += 1;
        if (stableChecks >= PERSIST_STABLE_CHECKS) return composer;
        await sleep(PERSIST_CHECK_MS);
        continue;
      }

      stableChecks = 0;
      fillComposer(composer, prompt);
      await sleep(PERSIST_CHECK_MS);
    }

    const composer = findComposer();
    return composer && promptStillPresent(composer, prompt) ? composer : null;
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

  function promptStillPresent(composer, prompt) {
    const text = getComposerText(composer);
    if (!text) return false;
    const snippet = prompt.trim().slice(0, Math.min(24, prompt.trim().length));
    return snippet.length === 0 || text.includes(snippet);
  }

  async function injectAndSend(prompt, id) {
    const composer = await waitForComposerFast();
    if (!composer) return false;

    fillComposer(composer, prompt);

    let activeComposer = await ensurePromptPersists(prompt);
    if (!activeComposer) return false;

    for (let round = 0; round < 4; round++) {
      activeComposer = findComposer() || activeComposer;
      if (!activeComposer) {
        await sleep(INJECT_POLL_MS);
        continue;
      }

      if (!promptStillPresent(activeComposer, prompt)) {
        fillComposer(activeComposer, prompt);
        activeComposer = (await ensurePromptPersists(prompt, 1500)) || activeComposer;
        if (!promptStillPresent(activeComposer, prompt)) continue;
      }

      const submitted = await performSubmitWithFallback(activeComposer, prompt, {
        syncFirst: round === 0,
      });
      if (submitted) {
        cleanDeepdiveUrl();
        deleteSessionPrompt(id);
        return true;
      }

      await sleep(120);
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
