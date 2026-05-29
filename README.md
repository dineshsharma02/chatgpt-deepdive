# ChatGPT Deep Dive

Chrome extension: select text on ChatGPT, refine a prompt in a dialog, and open a **new chat** in a new tab with auto-send — without interrupting your current conversation.

## Install (unpacked)

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select this folder: `chatgpt-deepdive`

Pin the extension from the toolbar. Use the popup to enable/disable and edit the prompt template (`{term}` = selected text).

## Usage

1. On [chatgpt.com](https://chatgpt.com), select a word or phrase (e.g. "DRY").
2. Click the **Deep dive** floating button.
3. Edit the prompt if needed, then click **Deep dive** (or press Enter).
4. A new tab opens with a fresh chat; the prompt is sent automatically.
5. Your original tab and chat stay unchanged.

## Files

- `manifest.json` — Manifest V3 config
- `src/background.js` — Session storage and new tab creation
- `src/content/content.js` — Selection UI and prompt injection
- `src/popup/` — Enable toggle and prompt template
