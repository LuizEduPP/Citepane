# Citepane

![Citepane](https://raw.githubusercontent.com/LuizEduPP/Citepane/b9a042ed8186a84c14de7eedea6c8b290447fe44/cover.png)

**Highlight text → grounded answers in the Chrome side panel.**

Citepane is a Chromium MV3 extension. Select text on any page, pick an action, and read the result beside the page—backed by **your** OpenAI-compatible API (Ollama, LM Studio, or cloud). Research actions combine page context with DuckDuckGo evidence; writing and translate work on the selection; images and videos open a quick gallery without calling the LLM.

## Features

- **Research** — Explain, Define, Fact-check, Pros & cons (page + web evidence)
- **Sources** — Find images / Find videos (DuckDuckGo gallery)
- **Writing** — Summarize, Summarize page, Key points, Simplify, Improve writing, Improve prompt
- **Translate** — Choose a target language from the submenu
- **WhatsApp Web** — Transcribe voice messages in-page with on-device Whisper (model downloaded once after consent)
- **Side panel** — Live selection preview, cancel in flight, Markdown answers, copy, light/dark/auto theme
- **Local-first** — You own the model endpoint; Citepane has no cloud backend

## Requirements

- A Chromium browser with Side Panel (Chrome, Edge, Brave, …)
- An OpenAI-compatible `/v1` API (optional if you only use image/video search)

## Install (unpacked)

1. Open `chrome://extensions` (or your browser’s equivalent).
2. Enable **Developer mode**.
3. **Load unpacked** → choose this repository folder.
4. Pin Citepane and open the side panel from the toolbar.

## Configure

1. Open the side panel → **Settings**.
2. Set **API base URL** (examples):
   - Ollama: `http://127.0.0.1:11434/v1`
   - LM Studio: `http://127.0.0.1:1234/v1`
3. **Load models** → pick a **Model** → optional **API key** → **Save**.
4. Remote hosts ask for optional host permission when you Load models or Save.

| Setting | Default |
|---------|---------|
| API base URL | empty (required for chat actions) |
| Model | empty (loaded from `{Base URL}/models`) |
| On-device Whisper size | `Xenova/whisper-tiny` (~40 MB, downloaded once after consent) |
| API key | empty (usually fine for local servers) |
| Answer language | `auto` |
| Interface language | `auto` (`en`, `pt-BR`, `pt-PT`, `es`, `fr`, `de`) |
| Theme | `auto` / `light` / `dark` |

## Use

1. Select text on a page (or run **Summarize page** with no selection).
2. In the side panel, pick an action—or right-click → **Citepane** → choose an action.
3. Read the answer in the panel. **Stop** cancels search or inference in progress.

## Architecture

Vanilla JS, no build step.

| File | Role |
|------|------|
| `manifest.json` | MV3 permissions, side panel, content script |
| `defaults.js` | Actions, languages, settings helpers |
| `background.js` | Context menus, jobs, page context, cancel |
| `content.js` | Selection + page extract |
| `content_whatsapp.js` | WhatsApp Web voice transcription UI |
| `offscreen-stt.js` | On-device Whisper (Transformers.js) |
| `search.js` | DuckDuckGo web / images / videos |
| `sidepanel.*` | UI, streaming chat, Markdown render |
| `_locales/` | Extension strings |
| `vendor/` | marked + DOMPurify |

Grounded research uses page context and DuckDuckGo. If search fails but the page still has usable text, the action continues with page evidence only.

## Privacy

See [PRIVACY.md](PRIVACY.md). Citepane does not run a backend or collect analytics.

## License

[MIT](LICENSE) © 2026 [Luiz Eduardo (LuizEduPP)](https://github.com/LuizEduPP)
