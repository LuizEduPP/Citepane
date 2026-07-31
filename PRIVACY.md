# Privacy

Citepane is a browser extension that runs locally in your Chromium profile.

## Data

| Data | Where | Notes |
|------|--------|--------|
| Settings (API URL, models, Whisper size, languages, theme) | `chrome.storage.sync` | Synced with your browser account if sync is enabled |
| Local Whisper download consent | `chrome.storage.local` | Set only after you accept the on-device model download |
| WhatsApp transcript cache | `chrome.storage.local` | Text transcripts keyed by message id / audio hash so Transcribe is not repeated; stays on your device |
| Live selection / pending job (session) | `chrome.storage.session` | Cleared when the side panel session ends |
| Page text / selection | Sent only to the API Base URL you configure | Never sent to a Citepane server |
| WhatsApp Web voice audio (on Transcribe) | Processed on-device in an extension offscreen page with bundled Transformers.js; Whisper weights may be fetched from Hugging Face after you consent | Audio is not uploaded to a Citepane server or to your chat API |
| Search / media queries | DuckDuckGo (html / lite / API hosts listed in the manifest) | Used for grounded research and image/video galleries |

Citepane does not include analytics, accounts, or a first-party backend.

## Permissions (why)

- **contextMenus / sidePanel / storage / scripting / activeTab / offscreen** — menus, panel, settings, page context, on-device Whisper
- **Host permissions for localhost** — local LLM servers
- **DuckDuckGo hosts** — evidence and media search
- **Optional Hugging Face** — requested when you accept On-device Whisper (model weights; Transformers.js runtime is bundled)
- **Optional `http(s)://*/*`** — granted when you connect a remote API in Settings
- **Content script on `web.whatsapp.com`** — Transcribe button on voice messages; a small page hook may observe in-page audio blobs only while you use Transcribe

## Contact

Author: Luiz Eduardo (LuizEduPP) — https://github.com/LuizEduPP
