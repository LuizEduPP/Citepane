# Privacy

Citepane is a browser extension that runs locally in your Chromium profile.

## Data

| Data | Where | Notes |
|------|--------|--------|
| Settings (API URL, model, transcription model, languages, theme) | `chrome.storage.sync` | Synced with your browser account if sync is enabled |
| Live selection / pending job (session) | `chrome.storage.session` | Cleared when the side panel session ends |
| Page text / selection | Sent only to the API Base URL you configure | Never sent to a Citepane server |
| WhatsApp Web voice audio (on Transcribe) | Sent only to the Transcription base URL if set, otherwise your API Base URL (`/audio/transcriptions`) | Fetched from the page `blob:` URL in your browser; never uploaded to a Citepane server |
| Search / media queries | DuckDuckGo (html / lite / API hosts listed in the manifest) | Used for grounded research and image/video galleries |

Citepane does not include analytics, accounts, or a first-party backend.

## Permissions (why)

- **contextMenus / sidePanel / storage / scripting / activeTab** — menus, panel, settings, page context
- **Host permissions for localhost** — local LLM servers
- **DuckDuckGo hosts** — evidence and media search
- **Optional `http(s)://*/*`** — granted when you connect a remote API in Settings
- **Content script on `web.whatsapp.com`** — Transcribe button on voice messages; audio stays between your browser and your API. A small page hook may observe in-page audio blobs only while you use Transcribe.

## Contact

Author: Luiz Eduardo (LuizEduPP) — https://github.com/LuizEduPP
