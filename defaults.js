const EXT_PARENT_MENU_ID = 'citepane-root';
const TRANSLATE_ACTION_PREFIX = 'translate:';

const AUTHOR_GITHUB_HANDLE = 'LuizEduPP';
const AUTHOR_GITHUB_URL = `https://github.com/${AUTHOR_GITHUB_HANDLE}`;
const BRAND_CITE = 'Cite';
const BRAND_PANE = 'pane';
/** Octocat mark path (viewBox 0 0 24 24). */
const GITHUB_MARK_PATH =
  'M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0 1 12 6.844a9.59 9.59 0 0 1 2.504.337c1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.02 10.02 0 0 0 22 12.017C22 6.484 17.522 2 12 2z';
const GITHUB_GRAD_ID = 'github-logo-grad';

const STORAGE_SETTINGS_KEY = 'settings';
const STORAGE_PENDING_JOB_KEY = 'pendingJob';
const STORAGE_LAST_RESULT_KEY = 'lastResult';
const STORAGE_LIVE_SELECTION_KEY = 'liveSelection';
const STORAGE_CANCELLED_JOB_KEY = 'cancelledJobAt';

const DEFAULT_BASE_URL = '';
const DEFAULT_MODEL = '';
const DEFAULT_API_KEY = '';
const DEFAULT_RESPONSE_LANGUAGE = 'auto';
const DEFAULT_UI_LANGUAGE = 'auto';
const DEFAULT_THEME = 'auto';

const THEME_OPTIONS = Object.freeze(['auto', 'light', 'dark']);

const PAGE_CONTEXT_MAX_CHARS = 2000;
const PAGE_BODY_MAX_CHARS = 12000;
const SEARCH_RESULT_LIMIT = 5;
const MEDIA_SEARCH_RESULT_LIMIT = 6;
const SEARCH_QUERY_MAX_CHARS = 220;
const SELECTION_PREVIEW_MAX_CHARS = 280;
const LIVE_SELECTION_MAX_CHARS = 8000;

const MESSAGE_GET_PAGE_CONTEXT = 'GET_PAGE_CONTEXT';
const MESSAGE_SELECTION_CHANGED = 'SELECTION_CHANGED';
const MESSAGE_GET_LIVE_SELECTION = 'GET_LIVE_SELECTION';
const MESSAGE_CANCEL_JOB = 'CANCEL_JOB';
const SIDEPANEL_PORT_NAME = 'citepane-sidepanel';

const LOCAL_HOSTNAMES = new Set(['127.0.0.1', 'localhost']);

const LANGUAGES = Object.freeze([
  Object.freeze({ code: 'en', label: 'English' }),
  Object.freeze({ code: 'pt-BR', label: 'Português (Brasil)' }),
  Object.freeze({ code: 'pt-PT', label: 'Português (Portugal)' }),
  Object.freeze({ code: 'es', label: 'Español' }),
  Object.freeze({ code: 'fr', label: 'Français' }),
  Object.freeze({ code: 'de', label: 'Deutsch' }),
  Object.freeze({ code: 'it', label: 'Italiano' }),
  // Latin labels: side panel ships Latin-only webfonts; native scripts become tofu boxes.
  Object.freeze({ code: 'ja', label: 'Japanese' }),
  Object.freeze({ code: 'zh-CN', label: 'Chinese (Simplified)' }),
  Object.freeze({ code: 'ko', label: 'Korean' }),
  Object.freeze({ code: 'ru', label: 'Russian' }),
  Object.freeze({ code: 'ar', label: 'Arabic' }),
]);

const UI_LOCALE_CODES = Object.freeze(['en', 'pt-BR', 'pt-PT', 'es', 'fr', 'de']);

const GROUNDING_RULE =
  'Use ONLY the provided page context and search evidence. ' +
  'If evidence is insufficient, say clearly that there is not enough grounding. ' +
  'Do not invent facts. Cite sources as Markdown links [Title](url) using the compact URLs provided. ' +
  'Never paste long query-string URLs into the answer body.';

const MARKDOWN_FORMAT_RULE =
  'Format the answer in Markdown when helpful (headings, bullet lists, numbered steps, bold, inline code, links). ' +
  'Prefer short links: [source title](https://example.com/path). Do not dump raw tracking URLs. ' +
  'Do not wrap the entire answer in a fenced code block.';

const ACTIONS = Object.freeze([
  Object.freeze({
    id: 'explain',
    titleKey: 'actionExplain',
    needsGrounding: true,
    searchKind: 'web',
    systemPrompt:
      'Explain the selected text clearly and directly. ' +
      'Situate it in the page topic when relevant, and say what the evidence confirms. ' +
      GROUNDING_RULE,
  }),
  Object.freeze({
    id: 'define',
    titleKey: 'actionDefine',
    needsGrounding: true,
    searchKind: 'web',
    systemPrompt:
      'Give a precise definition of the selected term or concept, with sources. ' +
      GROUNDING_RULE,
  }),
  Object.freeze({
    id: 'fact-check',
    titleKey: 'actionFactCheck',
    needsGrounding: true,
    searchKind: 'web',
    systemPrompt:
      'Fact-check claims in the selected text. Mark each as supported, contested, or insufficient data. ' +
      GROUNDING_RULE,
  }),
  Object.freeze({
    id: 'find-images',
    titleKey: 'actionFindImages',
    needsGrounding: true,
    searchKind: 'images',
    resultMode: 'media-gallery',
    skipInference: true,
  }),
  Object.freeze({
    id: 'find-videos',
    titleKey: 'actionFindVideos',
    needsGrounding: true,
    searchKind: 'videos',
    resultMode: 'media-gallery',
    skipInference: true,
  }),
  Object.freeze({
    id: 'pros-cons',
    titleKey: 'actionProsCons',
    needsGrounding: true,
    searchKind: 'web',
    systemPrompt:
      'List pros and cons anchored in evidence, not free opinion. ' +
      'Include the strongest counterpoints on each side when sources support them. ' +
      GROUNDING_RULE,
  }),
  Object.freeze({
    id: 'summarize',
    titleKey: 'actionSummarize',
    needsGrounding: false,
    usePageContext: true,
    systemPrompt:
      'Summarize the selected text briefly and accurately. ' +
      'Use PAGE CONTEXT only to disambiguate what the selection refers to. ' +
      'Do not invent facts that are not in the selection or page context.',
  }),
  Object.freeze({
    id: 'summarize-page',
    titleKey: 'actionSummarizePage',
    needsGrounding: false,
    usePageContext: true,
    requiresSelection: false,
    systemPrompt:
      'Summarize the whole web page clearly and accurately based on PAGE CONTENT. ' +
      'Cover the main topic, key points, and important details. ' +
      'Do not invent facts that are not in the page content. ' +
      'Ignore ads, navigation chrome, and unrelated boilerplate when possible.',
  }),
  Object.freeze({
    id: 'key-points',
    titleKey: 'actionKeyPoints',
    needsGrounding: false,
    usePageContext: true,
    systemPrompt:
      'Extract objective key points from the selected text as short bullets. ' +
      'Use PAGE CONTEXT only to disambiguate what the selection refers to. ' +
      'Do not invent points that are not in the selection or page context.',
  }),
  Object.freeze({
    id: 'simplify',
    titleKey: 'actionSimplify',
    needsGrounding: false,
    systemPrompt: 'Rewrite the selected text more simply while preserving meaning.',
  }),
  Object.freeze({
    id: 'improve-writing',
    titleKey: 'actionImproveWriting',
    needsGrounding: false,
    systemPrompt:
      'Improve the writing quality of the selected text (clarity, grammar, flow) while preserving meaning. Return only the rewritten text.',
  }),
  Object.freeze({
    id: 'improve-prompt',
    titleKey: 'actionImprovePrompt',
    needsGrounding: false,
    systemPrompt:
      'Rewrite the selected text as a clear, specific, executable LLM prompt ' +
      '(goal, context, constraints, output format). Return only the ready-to-paste prompt.',
  }),
]);

const ACTION_BY_ID = Object.freeze(
  Object.fromEntries(ACTIONS.map((action) => [action.id, action])),
);

/** Context-menu grouping. `translate` is a special submenu of languages. */
const ACTION_MENU_GROUPS = Object.freeze([
  Object.freeze({
    id: 'citepane-group-research',
    titleKey: 'menuGroupResearch',
    actionIds: Object.freeze(['explain', 'define', 'fact-check', 'pros-cons']),
  }),
  Object.freeze({
    id: 'citepane-group-sources',
    titleKey: 'menuGroupSources',
    actionIds: Object.freeze(['find-images', 'find-videos']),
  }),
  Object.freeze({
    id: 'citepane-group-writing',
    titleKey: 'menuGroupWriting',
    actionIds: Object.freeze([
      'summarize',
      'summarize-page',
      'key-points',
      'simplify',
      'improve-writing',
      'improve-prompt',
    ]),
  }),
  Object.freeze({
    id: 'citepane-group-translate',
    titleKey: 'menuGroupTranslate',
    kind: 'translate',
  }),
]);

const LANGUAGE_BY_CODE = Object.freeze(
  Object.fromEntries(LANGUAGES.map((language) => [language.code, language])),
);

function getDefaultSettings() {
  return {
    baseUrl: DEFAULT_BASE_URL,
    model: DEFAULT_MODEL,
    apiKey: DEFAULT_API_KEY,
    responseLanguage: DEFAULT_RESPONSE_LANGUAGE,
    uiLanguage: DEFAULT_UI_LANGUAGE,
    theme: DEFAULT_THEME,
  };
}

function normalizeBaseUrl(baseUrl) {
  if (typeof baseUrl !== 'string' || baseUrl.trim() === '') {
    throw new Error('baseUrl is required');
  }

  return baseUrl.trim().replace(/\/+$/, '');
}

function normalizeModel(model) {
  if (typeof model !== 'string' || model.trim() === '') {
    throw new Error('model is required');
  }

  return model.trim();
}

function normalizeLanguageCode(code) {
  if (typeof code !== 'string' || code.trim() === '') {
    throw new Error('language code is required');
  }

  const normalized = code.trim();
  if (!LANGUAGE_BY_CODE[normalized]) {
    throw new Error(`Unsupported language code: ${normalized}`);
  }

  return normalized;
}

function mergeSettings(raw) {
  const defaults = getDefaultSettings();
  const incoming = raw && typeof raw === 'object' ? raw : {};

  return {
    baseUrl: typeof incoming.baseUrl === 'string' && incoming.baseUrl.trim()
      ? normalizeBaseUrl(incoming.baseUrl)
      : defaults.baseUrl,
    model: typeof incoming.model === 'string' && incoming.model.trim()
      ? normalizeModel(incoming.model)
      : defaults.model,
    apiKey: typeof incoming.apiKey === 'string' ? incoming.apiKey : defaults.apiKey,
    responseLanguage:
      incoming.responseLanguage === 'auto' || LANGUAGE_BY_CODE[incoming.responseLanguage]
        ? incoming.responseLanguage
        : defaults.responseLanguage,
    uiLanguage:
      incoming.uiLanguage === 'auto' || UI_LOCALE_CODES.includes(incoming.uiLanguage)
        ? incoming.uiLanguage
        : defaults.uiLanguage,
    theme: THEME_OPTIONS.includes(incoming.theme) ? incoming.theme : defaults.theme,
  };
}

function matchBrowserLanguage(supportedCodes) {
  const browser = chrome.i18n.getUILanguage().replace('_', '-');
  if (supportedCodes.includes(browser)) {
    return browser;
  }

  const short = browser.split('-')[0];
  const regional = supportedCodes.find((code) => code.startsWith(`${short}-`));
  if (regional) {
    return regional;
  }

  if (supportedCodes.includes(short)) {
    return short;
  }

  return 'en';
}

function resolveUiLocale(uiLanguage) {
  if (uiLanguage && uiLanguage !== 'auto') {
    if (!UI_LOCALE_CODES.includes(uiLanguage)) {
      throw new Error(`Unsupported UI language: ${uiLanguage}`);
    }
    return uiLanguage;
  }

  return matchBrowserLanguage([...UI_LOCALE_CODES]);
}

function resolveResponseLanguage(responseLanguage) {
  if (responseLanguage && responseLanguage !== 'auto') {
    return normalizeLanguageCode(responseLanguage);
  }

  return matchBrowserLanguage(LANGUAGES.map((language) => language.code));
}

function isTranslateActionId(actionId) {
  return typeof actionId === 'string' && actionId.startsWith(TRANSLATE_ACTION_PREFIX);
}

function parseTranslateTarget(actionId) {
  if (!isTranslateActionId(actionId)) {
    throw new Error(`Not a translate action: ${actionId}`);
  }

  return normalizeLanguageCode(actionId.slice(TRANSLATE_ACTION_PREFIX.length));
}

function resolveAction(actionId) {
  if (isTranslateActionId(actionId)) {
    const target = parseTranslateTarget(actionId);
    const label = LANGUAGE_BY_CODE[target].label;
    return {
      id: actionId,
      titleKey: 'actionTranslate',
      needsGrounding: false,
      targetLanguage: target,
      systemPrompt:
        `Translate the selected text into ${label} (${target}). ` +
        'Return only the translation.',
    };
  }

  const action = ACTION_BY_ID[actionId];
  if (!action) {
    throw new Error(`Unknown action: ${actionId}`);
  }

  return action;
}

function languageInstruction(responseLanguage) {
  const language = LANGUAGE_BY_CODE[normalizeLanguageCode(responseLanguage)];
  return `Respond in ${language.label} (${language.code}). Respect regional variant when relevant (e.g. pt-BR vs pt-PT).`;
}

function isLocalApiHost(baseUrl) {
  const url = new URL(normalizeBaseUrl(baseUrl));
  return LOCAL_HOSTNAMES.has(url.hostname);
}

/**
 * Shared by side panel (user gesture) and any future callers.
 * interactive:true uses permissions.request — must stay in the gesture stack.
 */
async function ensureApiHostPermission(baseUrl, { interactive = false } = {}) {
  if (isLocalApiHost(baseUrl)) {
    return;
  }

  const origin = `${new URL(normalizeBaseUrl(baseUrl)).origin}/*`;

  if (interactive) {
    const granted = await chrome.permissions.request({ origins: [origin] });
    if (!granted) {
      throw new Error(`Host permission denied for ${origin}`);
    }
    return;
  }

  const already = await chrome.permissions.contains({ origins: [origin] });
  if (!already) {
    throw new Error(
      `Host permission required for ${origin}. Open Settings, then Save or Refresh models to grant access.`,
    );
  }
}

function chatCompletionsUrl(baseUrl) {
  return `${normalizeBaseUrl(baseUrl)}/chat/completions`;
}

function modelsUrl(baseUrl) {
  return `${normalizeBaseUrl(baseUrl)}/models`;
}

function truncateText(text, maxChars) {
  if (typeof text !== 'string') {
    throw new Error('text must be a string');
  }

  if (text.length <= maxChars) {
    return text;
  }

  return `${text.slice(0, maxChars - 1)}…`;
}

/** Keep citation URLs short: drop tracking params; keep only a few meaningful query keys. */
function compactUrl(rawUrl, maxLength = 140) {
  if (typeof rawUrl !== 'string') {
    return '';
  }

  const trimmed = rawUrl.trim();
  if (!trimmed) {
    return '';
  }

  try {
    const url = new URL(trimmed);
    url.hash = '';

    const isSearchHost =
      /(^|\.)google\./i.test(url.hostname) ||
      /(^|\.)bing\./i.test(url.hostname) ||
      /(^|\.)duckduckgo\./i.test(url.hostname);

    if (isSearchHost) {
      const q = url.searchParams.get('q');
      url.search = '';
      if (q) {
        url.searchParams.set('q', q);
      }
    } else {
      const keepKeys = new Set(['q', 'v', 'id', 'p', 'page', 't']);
      const nextParams = new URLSearchParams();
      for (const [key, value] of url.searchParams.entries()) {
        if (!keepKeys.has(key.toLowerCase())) {
          continue;
        }
        if (value.length > 120) {
          continue;
        }
        nextParams.set(key, value);
      }
      url.search = nextParams.toString();
    }

    let out = url.toString();
    if (out.length > maxLength) {
      url.search = '';
      out = url.toString();
    }
    if (out.length > maxLength) {
      return truncateText(out, maxLength);
    }
    return out;
  } catch {
    return truncateText(trimmed, maxLength);
  }
}

function compactUrlsInText(text) {
  if (typeof text !== 'string' || !text) {
    return text || '';
  }

  return text.replace(/https?:\/\/[^\s)\]>'"<]+/g, (match) => {
    const cleaned = match.replace(/[.,;:!?]+$/g, '');
    const trailing = match.slice(cleaned.length);
    return `${compactUrl(cleaned)}${trailing}`;
  });
}

function pageContextHasSignal(pageContext) {
  if (!pageContext || typeof pageContext !== 'object') {
    return false;
  }

  return Boolean(
    (pageContext.title && pageContext.title.trim()) ||
      (pageContext.description && pageContext.description.trim()) ||
      (pageContext.excerpt && pageContext.excerpt.trim()) ||
      (pageContext.body && pageContext.body.trim()) ||
      (pageContext.url && pageContext.url.trim()),
  );
}

function pageBodyIsUsable(pageContext) {
  return Boolean(pageContext?.body && String(pageContext.body).trim());
}

function evidenceIsUsable(pageContext, evidence) {
  return pageContextHasSignal(pageContext) || (Array.isArray(evidence) && evidence.length > 0);
}

function buildSearchQuery(selectionText) {
  if (typeof selectionText !== 'string' || selectionText.trim() === '') {
    throw new Error('selectionText is required for search');
  }

  return truncateText(selectionText.trim().replace(/\s+/g, ' '), SEARCH_QUERY_MAX_CHARS);
}
