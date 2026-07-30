# Citepane

**Selected text → grounded AI in the Chrome side panel.**

Citepane is a Chromium MV3 extension: highlight text on any page, pick an action, and get an answer in the side panel—backed by your own OpenAI-compatible API (Ollama, LM Studio, or cloud). Research actions ground replies in page context plus DuckDuckGo; writing and translate run on the selection; images/videos open a quick gallery (no LLM).

## Features

- **Research** — Explain, Define, Fact-check, Pros & cons (page + web evidence)
- **Sources** — Find images / Find videos (DuckDuckGo gallery)
- **Writing** — Summarize, Summarize page, Key points, Simplify, Improve writing, Improve prompt
- **Translate** — Target-language submenu
- **Side panel UX** — Live selection, cancel while running, Markdown results, copy, light/dark/auto theme
- **Local-first** — You bring the model endpoint; no Citepane cloud

## Requirements

- Chromium browser with Side Panel (Chrome, Edge, Brave, …)
- An OpenAI-compatible `/v1` API (optional for image/video-only use)

## Install (unpacked)

1. Open `chrome://extensions` (or the equivalent in your browser).
2. Enable **Developer mode**.
3. **Load unpacked** → select this repository folder.
4. Pin Citepane and open the side panel from the toolbar.

## Configure

1. Side panel → **Settings**.
2. Set **Base URL** (examples):
   - Ollama: `http://127.0.0.1:11434/v1`
   - LM Studio: `http://127.0.0.1:1234/v1`
3. **Refresh** models → pick a **Model** → optional **API key** → **Save**.
4. Remote hosts prompt for optional host permission on Refresh/Save.

| Setting | Default |
|---------|---------|
| Base URL | empty (required for chat actions) |
| Model | empty (loaded from `{Base URL}/models`) |
| API key | empty (fine for local servers) |
| Response language | `auto` |
| UI language | `auto` (`en`, `pt-BR`, `pt-PT`, `es`, `fr`, `de`) |
| Theme | `auto` / `light` / `dark` |

## Use

1. Select text on a web page (or use **Summarize page** with no selection).
2. Right-click → **Citepane** → choose an action, **or** use the action tabs in the side panel.
3. Read the answer in the panel. Cancel stops search/inference in progress.

## Architecture

Vanilla JS, no build step.

| File | Role |
|------|------|
| `manifest.json` | MV3 permissions, side panel, content script |
| `defaults.js` | Actions, languages, settings helpers |
| `background.js` | Context menus, jobs, page context, cancel |
| `content.js` | Selection + page extract |
| `search.js` | DuckDuckGo web / images / videos |
| `sidepanel.*` | UI, streaming chat, Markdown render |
| `_locales/` | Extension strings |
| `vendor/` | marked + DOMPurify |

Grounded research uses page context and DuckDuckGo. If search fails but the page still has usable context, the action continues with page evidence only.

## Privacy

See [PRIVACY.md](PRIVACY.md). Citepane does not run a backend or collect analytics.

## License

[MIT](LICENSE) © 2026 [Luiz Eduardo (LuizEduPP)](https://github.com/LuizEduPP)
