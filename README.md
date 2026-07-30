# Citepane

Selected text → right-click AI actions → grounded answers in the Chrome side panel.

OpenAI-compatible backend (Ollama, LM Studio, cloud). Vanilla MV3, no build.

## Setup

1. Open `chrome://extensions` (or Edge/Brave equivalent).
2. Enable **Developer mode**.
3. **Load unpacked** → this folder (`033-citepane`).
4. Start a local server if needed (examples):
   - Ollama: `http://127.0.0.1:11434/v1`
   - LM Studio: `http://127.0.0.1:1234/v1`
5. Open the side panel (toolbar icon) → **Settings** → set Base URL, Model, optional API key, languages → **Save**.

## Use

1. Select text on a page.
2. Right-click → **Citepane** → pick an action (Translate has a language submenu).
3. Read the result in the side panel. Grounded actions show **Sources** from the page + DuckDuckGo.

## Architecture

| File | Role |
|------|------|
| `defaults.js` | ACTIONS, LANGUAGES, settings helpers |
| `background.js` | Context menus, page context, search, pending job |
| `content.js` | Page context extraction |
| `search.js` | DuckDuckGo HTML search |
| `sidepanel.*` | Settings, chat completions (stream), copy |

Grounded actions fail fast if search/page evidence is unusable — the model is not called “in the dark”.

## Settings

| Key | Default |
|-----|---------|
| Base URL | empty (set in Settings; e.g. Ollama `http://127.0.0.1:11434/v1`) |
| Model | empty select — loaded from `{Base URL}/models` |
| API key | empty (ok for local) |
| Response language | `auto` (browser UI language) |
| UI language | `auto` (browser) / `en` `pt-BR` `pt-PT` `es` `fr` `de` |

Remote API hosts require optional host permission (prompted on first use).

## License

MIT
