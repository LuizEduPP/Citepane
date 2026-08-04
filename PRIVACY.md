# Privacy

Citepane is a browser extension that runs locally in your Chromium profile.

## Data

| Data | Where | Notes |
|------|--------|--------|
| Settings (API URL, models, languages, theme) | `chrome.storage.sync` | Synced with your browser account if sync is enabled |
| Live selection / pending job (session) | `chrome.storage.session` | Cleared when the side panel session ends |
| Page text / selection | Sent only to the API Base URL you configure | Never sent to a Citepane server |
| Search / media queries | DuckDuckGo (html / lite / API hosts listed in the manifest) | Used for grounded research and image/video galleries |

Citepane does not include analytics, accounts, or a first-party backend.

## Permissions (why)

- **contextMenus / sidePanel / storage / scripting / activeTab** — menus, panel, settings, page context
- **Host permissions for localhost** — local LLM servers
- **DuckDuckGo hosts** — evidence and media search
- **Optional `http(s)://*/*`** — granted when you connect a remote API in Settings

## Contact

Author: Luiz Eduardo (LuizEduPP) — https://github.com/LuizEduPP
