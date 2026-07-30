const localeFolderByCode = Object.freeze({
  en: 'en',
  'pt-BR': 'pt_BR',
  'pt-PT': 'pt_PT',
  es: 'es',
  fr: 'fr',
  de: 'de',
});

let messageCatalog = null;
let currentSettings = getDefaultSettings();
let activeAbort = null;
let latestResultText = '';
let lastLiveSelection = '';

const els = {
  idle: document.getElementById('idle'),
  job: document.getElementById('job'),
  actionLabel: document.getElementById('action-label'),
  selection: document.getElementById('selection'),
  actionsWrap: document.getElementById('actions-wrap'),
  actions: document.getElementById('actions'),
  sourcesWrap: document.getElementById('sources-wrap'),
  sources: document.getElementById('sources'),
  resultWrap: document.getElementById('result-wrap'),
  status: document.getElementById('status'),
  result: document.getElementById('result'),
  error: document.getElementById('error'),
  copyBtn: document.getElementById('copy-btn'),
  settingsBtn: document.getElementById('settings-btn'),
  settingsPanel: document.getElementById('settings-panel'),
  form: document.getElementById('settings-form'),
  baseUrl: document.getElementById('base-url'),
  model: document.getElementById('model'),
  refreshModels: document.getElementById('refresh-models'),
  apiKey: document.getElementById('api-key'),
  responseLanguage: document.getElementById('response-language'),
  uiLanguage: document.getElementById('ui-language'),
  theme: document.getElementById('theme'),
  settingsFeedback: document.getElementById('settings-feedback'),
};

let themeMediaQuery = null;
let themeMediaHandler = null;

function browserMessage(key) {
  return chrome.i18n.getMessage(key) || '';
}

function uiMessage(key) {
  if (messageCatalog?.[key]?.message) {
    return messageCatalog[key].message;
  }
  const fallback = browserMessage(key);
  if (!fallback) {
    throw new Error(`Missing UI string: ${key}`);
  }
  return fallback;
}

async function loadMessageCatalog(uiLanguage) {
  const locale = resolveUiLocale(uiLanguage);
  const folder = localeFolderByCode[locale];
  if (!folder) {
    throw new Error(`No locale folder for ${locale}`);
  }

  const url = chrome.runtime.getURL(`_locales/${folder}/messages.json`);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to load locale ${folder}`);
  }
  messageCatalog = await response.json();
  return locale;
}

function applyStaticI18n() {
  document.querySelectorAll('[data-i18n]').forEach((node) => {
    const key = node.getAttribute('data-i18n');
    node.textContent = uiMessage(key);
  });
  document.querySelectorAll('[data-i18n-aria]').forEach((node) => {
    const key = node.getAttribute('data-i18n-aria');
    node.setAttribute('aria-label', uiMessage(key));
    node.setAttribute('title', uiMessage(key));
  });
  document.title = uiMessage('extName');
  document.documentElement.lang = resolveUiLocale(currentSettings.uiLanguage);
  fillActionPicker();
}

function setSettingsOpen(open) {
  els.settingsPanel.hidden = !open;
  els.settingsBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
}

function fillLanguageSelects() {
  els.responseLanguage.replaceChildren();
  const responseAuto = document.createElement('option');
  responseAuto.value = 'auto';
  responseAuto.textContent = uiMessage('uiResponseLanguageAuto');
  els.responseLanguage.append(responseAuto);

  for (const language of LANGUAGES) {
    const option = document.createElement('option');
    option.value = language.code;
    option.textContent = language.label;
    els.responseLanguage.append(option);
  }

  els.uiLanguage.replaceChildren();
  const auto = document.createElement('option');
  auto.value = 'auto';
  auto.textContent = uiMessage('uiUiLanguageAuto');
  els.uiLanguage.append(auto);

  for (const code of UI_LOCALE_CODES) {
    const language = LANGUAGE_BY_CODE[code];
    const option = document.createElement('option');
    option.value = code;
    option.textContent = language.label;
    els.uiLanguage.append(option);
  }

  fillThemeSelect();
}

function fillThemeSelect() {
  els.theme.replaceChildren();
  const options = [
    ['auto', 'uiThemeAuto'],
    ['light', 'uiThemeLight'],
    ['dark', 'uiThemeDark'],
  ];
  for (const [value, key] of options) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = uiMessage(key);
    els.theme.append(option);
  }
}

function resolveTheme(theme) {
  if (theme === 'light' || theme === 'dark') {
    return theme;
  }
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function applyTheme(theme) {
  const resolved = resolveTheme(theme);
  document.documentElement.dataset.theme = resolved;

  if (themeMediaQuery && themeMediaHandler) {
    themeMediaQuery.removeEventListener('change', themeMediaHandler);
    themeMediaQuery = null;
    themeMediaHandler = null;
  }

  if (theme === 'auto') {
    themeMediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    themeMediaHandler = () => {
      document.documentElement.dataset.theme = resolveTheme('auto');
    };
    themeMediaQuery.addEventListener('change', themeMediaHandler);
  }
}

function fillModelSelect(modelIds, selectedModel) {
  const ids = [...new Set(modelIds.filter(Boolean))];
  if (selectedModel && !ids.includes(selectedModel)) {
    ids.unshift(selectedModel);
  }
  ids.sort((a, b) => a.localeCompare(b));

  els.model.replaceChildren();
  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = uiMessage('uiModelPlaceholder');
  if (!selectedModel) {
    placeholder.selected = true;
  }
  els.model.append(placeholder);

  for (const id of ids) {
    const option = document.createElement('option');
    option.value = id;
    option.textContent = id;
    if (id === selectedModel) {
      option.selected = true;
    }
    els.model.append(option);
  }
}

async function ensureApiPermission(baseUrl, { interactive = false } = {}) {
  if (isLocalApiHost(baseUrl)) {
    return;
  }

  const origin = `${new URL(normalizeBaseUrl(baseUrl)).origin}/*`;

  // chrome.permissions.request must run in this page during the user gesture.
  // Do not await anything else before request(), or Chrome drops the gesture.
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
      `Host permission required for ${origin}. Click Refresh or Save in Settings to grant access.`,
    );
  }
}

async function fetchAvailableModels(baseUrl, apiKey, { interactive = false } = {}) {
  await ensureApiPermission(baseUrl, { interactive });

  const headers = {};
  if (typeof apiKey === 'string' && apiKey.trim()) {
    headers.Authorization = `Bearer ${apiKey.trim()}`;
  }

  const response = await fetch(modelsUrl(baseUrl), { headers });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`${uiMessage('uiModelLoadFailed')} HTTP ${response.status}: ${body.slice(0, 200)}`);
  }

  const payload = await response.json();
  const list = Array.isArray(payload?.data) ? payload.data : [];
  return list
    .map((item) => (typeof item?.id === 'string' ? item.id.trim() : ''))
    .filter(Boolean);
}

async function refreshModelOptions({ quiet = false, interactive = false } = {}) {
  const baseUrl = els.baseUrl.value.trim();
  const selected = els.model.value || currentSettings.model;

  if (!baseUrl) {
    fillModelSelect([], selected);
    if (!quiet) {
      els.settingsFeedback.hidden = false;
      els.settingsFeedback.textContent = uiMessage('uiModelNeedBaseUrl');
    }
    return;
  }

  try {
    // Request host access before any other await so the click gesture stays valid.
    await ensureApiPermission(baseUrl, { interactive });
  } catch (error) {
    fillModelSelect([], selected);
    if (!quiet) {
      els.settingsFeedback.hidden = false;
      els.settingsFeedback.textContent = error instanceof Error ? error.message : String(error);
    }
    return;
  }

  els.refreshModels.disabled = true;
  try {
    const ids = await fetchAvailableModels(baseUrl, els.apiKey.value, { interactive: false });
    fillModelSelect(ids, selected);
    if (!quiet) {
      els.settingsFeedback.hidden = false;
      els.settingsFeedback.textContent = uiMessage('uiModelsLoaded');
    }
  } catch (error) {
    fillModelSelect([], selected);
    if (!quiet) {
      els.settingsFeedback.hidden = false;
      els.settingsFeedback.textContent = error instanceof Error ? error.message : String(error);
    }
  } finally {
    els.refreshModels.disabled = false;
  }
}

function paintSettingsForm(settings) {
  els.baseUrl.value = settings.baseUrl;
  els.apiKey.value = settings.apiKey;
  els.responseLanguage.value = settings.responseLanguage;
  els.uiLanguage.value = settings.uiLanguage;
  els.theme.value = settings.theme;
  fillModelSelect(settings.model ? [settings.model] : [], settings.model);
  applyTheme(settings.theme);
}

async function persistSettings(settings) {
  const next = mergeSettings(settings);
  await chrome.storage.sync.set({ [STORAGE_SETTINGS_KEY]: next });
  currentSettings = next;
  await chrome.runtime.sendMessage({ type: 'REBUILD_MENUS' }).catch(() => {});
  return next;
}

function formatEvidenceBlock(pageContext, evidence) {
  const lines = [];

  if (pageContext) {
    lines.push('PAGE CONTEXT');
    lines.push(`URL: ${pageContext.url || ''}`);
    lines.push(`Title: ${pageContext.title || ''}`);
    if (pageContext.description) {
      lines.push(`Description: ${pageContext.description}`);
    }
    if (pageContext.excerpt) {
      lines.push(`Excerpt: ${pageContext.excerpt}`);
    }
  }

  if (Array.isArray(evidence) && evidence.length > 0) {
    lines.push('');
    lines.push('SEARCH EVIDENCE');
    evidence.forEach((item, index) => {
      lines.push(`${index + 1}. ${item.title}`);
      lines.push(`   URL: ${item.url}`);
      if (item.snippet) {
        lines.push(`   Snippet: ${item.snippet}`);
      }
    });
  }

  return lines.join('\n');
}

function buildMessages(job, action) {
  const systemParts = [action.systemPrompt];

  if (!isTranslateActionId(action.id)) {
    systemParts.push(MARKDOWN_FORMAT_RULE);
    systemParts.push(languageInstruction(job.responseLanguage));
  }

  if (action.needsGrounding || action.usePageContext) {
    systemParts.push(formatEvidenceBlock(job.pageContext, job.evidence));
  }

  return [
    { role: 'system', content: systemParts.join('\n\n') },
    { role: 'user', content: job.selectionText },
  ];
}

function extractDeltaContent(payload) {
  const choice = payload?.choices?.[0];
  if (!choice) {
    return '';
  }
  if (typeof choice.delta?.content === 'string') {
    return choice.delta.content;
  }
  if (typeof choice.message?.content === 'string') {
    return choice.message.content;
  }
  return '';
}

async function streamChatCompletion({ settings, messages, signal, onDelta }) {
  await ensureApiPermission(settings.baseUrl);

  const headers = {
    'Content-Type': 'application/json',
  };
  if (settings.apiKey.trim()) {
    headers.Authorization = `Bearer ${settings.apiKey.trim()}`;
  }

  const response = await fetch(chatCompletionsUrl(settings.baseUrl), {
    method: 'POST',
    headers,
    signal,
    body: JSON.stringify({
      model: settings.model,
      messages,
      stream: true,
      temperature: 0.2,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`${uiMessage('errorApi')} HTTP ${response.status}: ${body.slice(0, 400)}`);
  }

  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('text/event-stream') && !contentType.includes('text/plain')) {
    const data = await response.json();
    const text = extractDeltaContent(data);
    if (!text) {
      throw new Error(`${uiMessage('errorApi')} Empty completion payload`);
    }
    onDelta(text);
    return text;
  }

  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error(`${uiMessage('errorApi')} Missing response body`);
  }

  const decoder = new TextDecoder();
  let buffer = '';
  let full = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const chunks = buffer.split('\n');
    buffer = chunks.pop() || '';

    for (const rawLine of chunks) {
      const line = rawLine.trim();
      if (!line.startsWith('data:')) {
        continue;
      }
      const data = line.slice(5).trim();
      if (!data || data === '[DONE]') {
        continue;
      }

      let payload;
      try {
        payload = JSON.parse(data);
      } catch {
        throw new Error(`${uiMessage('errorApi')} Invalid SSE JSON`);
      }

      const delta = extractDeltaContent(payload);
      if (delta) {
        full += delta;
        onDelta(delta);
      }
    }
  }

  if (!full.trim()) {
    throw new Error(`${uiMessage('errorApi')} Empty streamed completion`);
  }

  return full;
}

function renderSources(evidence) {
  els.sources.replaceChildren();
  if (!Array.isArray(evidence) || evidence.length === 0) {
    els.sourcesWrap.hidden = true;
    return;
  }

  els.sourcesWrap.hidden = false;
  for (const item of evidence) {
    const li = document.createElement('li');
    const link = document.createElement('a');
    link.href = item.url;
    link.target = '_blank';
    link.rel = 'noreferrer noopener';
    link.textContent = item.title || item.url;
    li.append(link);
    if (item.snippet) {
      const snip = document.createElement('div');
      snip.className = 'muted';
      snip.textContent = item.snippet;
      li.append(snip);
    }
    els.sources.append(li);
  }
}

function renderMarkdown(text) {
  if (!text) {
    return '';
  }

  const rawHtml = marked.parse(text, {
    async: false,
    gfm: true,
    breaks: true,
  });

  return DOMPurify.sanitize(rawHtml, {
    USE_PROFILES: { html: true },
  });
}

function setResultText(text) {
  latestResultText = text;
  if (!text) {
    els.result.replaceChildren();
    if (els.error.hidden && !els.status.textContent) {
      els.resultWrap.hidden = true;
    }
  } else {
    els.resultWrap.hidden = false;
    els.result.innerHTML = renderMarkdown(text);
    els.result.querySelectorAll('a[href]').forEach((anchor) => {
      anchor.setAttribute('target', '_blank');
      anchor.setAttribute('rel', 'noopener noreferrer');
    });
  }
  els.copyBtn.hidden = !text;
}

function clearGeneratedOutput({ clearJobStorage = true } = {}) {
  if (activeAbort) {
    activeAbort.abort();
    activeAbort = null;
  }

  els.actionLabel.textContent = '';
  els.status.textContent = '';
  els.error.hidden = true;
  els.error.textContent = '';
  els.resultWrap.hidden = true;
  setResultText('');
  renderSources([]);

  if (clearJobStorage) {
    chrome.storage.session.remove([STORAGE_PENDING_JOB_KEY, STORAGE_LAST_RESULT_KEY]).catch(() => {});
  }
}

async function runJob(job) {
  if (activeAbort) {
    activeAbort.abort();
    activeAbort = null;
  }

  const selectionText = (job.selectionText || '').trim();
  lastLiveSelection = selectionText;

  els.idle.hidden = true;
  els.job.hidden = false;
  els.error.hidden = true;
  els.error.textContent = '';
  els.selection.textContent = selectionText;
  setActionsVisible(Boolean(selectionText));
  setActionsEnabled(false);
  renderSources(job.evidence);

  try {
    const action = resolveAction(job.actionId);
    els.actionLabel.textContent = isTranslateActionId(job.actionId)
      ? `${uiMessage('actionTranslate')} → ${LANGUAGE_BY_CODE[job.targetLanguage].label}`
      : uiMessage(action.titleKey);
  } catch {
    els.actionLabel.textContent = job.actionId || '';
  }

  if (job.status === 'loading') {
    els.resultWrap.hidden = false;
    els.status.textContent = uiMessage('uiLoading');
    els.result.replaceChildren();
    latestResultText = '';
    els.copyBtn.hidden = true;
    setActionsEnabled(false);
    return;
  }

  if (job.status === 'error') {
    els.resultWrap.hidden = false;
    els.status.textContent = '';
    setResultText('');
    els.error.hidden = false;
    els.error.textContent = job.error || uiMessage('errorApi');
    setActionsEnabled(true);
    return;
  }

  if (job.status !== 'ready') {
    setActionsEnabled(true);
    return;
  }

  const action = resolveAction(job.actionId);
  if (action.needsGrounding && !evidenceIsUsable(job.pageContext, job.evidence)) {
    els.resultWrap.hidden = false;
    els.status.textContent = '';
    setResultText('');
    els.error.hidden = false;
    els.error.textContent = uiMessage('errorNoEvidence');
    setActionsEnabled(true);
    return;
  }

  els.resultWrap.hidden = false;
  els.status.textContent = uiMessage('uiLoading');
  setResultText('');
  setActionsEnabled(false);

  const controller = new AbortController();
  activeAbort = controller;

  try {
    const messages = buildMessages(job, action);
    const full = await streamChatCompletion({
      settings: currentSettings,
      messages,
      signal: controller.signal,
      onDelta: (delta) => {
        setResultText(latestResultText + delta);
      },
    });

    setResultText(full);
    els.status.textContent = '';
    await chrome.storage.session.set({
      [STORAGE_LAST_RESULT_KEY]: {
        actionId: job.actionId,
        text: full,
        createdAt: Date.now(),
      },
    });
  } catch (error) {
    if (error?.name === 'AbortError') {
      return;
    }
    els.status.textContent = '';
    els.resultWrap.hidden = false;
    els.error.hidden = false;
    els.error.textContent = error instanceof Error ? error.message : String(error);
  } finally {
    if (activeAbort === controller) {
      activeAbort = null;
    }
    setActionsEnabled(true);
  }
}

async function loadPendingJob() {
  const stored = await chrome.storage.session.get(STORAGE_PENDING_JOB_KEY);
  const job = stored[STORAGE_PENDING_JOB_KEY];
  if (!job) {
    return;
  }
  await runJob(job);
}

els.refreshModels.addEventListener('click', async () => {
  await refreshModelOptions({ quiet: false, interactive: true });
});

els.baseUrl.addEventListener('change', () => {
  refreshModelOptions({ quiet: true, interactive: false }).catch(() => {});
});

els.theme.addEventListener('change', () => {
  applyTheme(els.theme.value);
});

els.form.addEventListener('submit', async (event) => {
  event.preventDefault();
  els.settingsFeedback.hidden = true;

  try {
    const baseUrl = els.baseUrl.value.trim();
    if (baseUrl) {
      await ensureApiPermission(baseUrl, { interactive: true });
    }

    const next = await persistSettings({
      baseUrl: els.baseUrl.value,
      model: els.model.value,
      apiKey: els.apiKey.value,
      responseLanguage: els.responseLanguage.value,
      uiLanguage: els.uiLanguage.value,
      theme: els.theme.value,
    });

    await loadMessageCatalog(next.uiLanguage);
    applyStaticI18n();
    fillLanguageSelects();
    paintSettingsForm(next);
    applyTheme(next.theme);
    if (next.baseUrl.trim()) {
      await refreshModelOptions({ quiet: true, interactive: false });
    }

    els.settingsFeedback.hidden = false;
    els.settingsFeedback.textContent = uiMessage('uiSaved');
  } catch (error) {
    els.settingsFeedback.hidden = false;
    els.settingsFeedback.textContent = error instanceof Error ? error.message : String(error);
  }
});

els.settingsBtn.addEventListener('click', () => {
  setSettingsOpen(els.settingsPanel.hidden);
});

els.copyBtn.addEventListener('click', async () => {
  if (!latestResultText) {
    return;
  }
  await navigator.clipboard.writeText(latestResultText);
  const previous = els.copyBtn.textContent;
  els.copyBtn.textContent = uiMessage('uiCopied');
  setTimeout(() => {
    els.copyBtn.textContent = previous;
  }, 1200);
});

function collapseActionGroups() {
  els.actions.querySelectorAll('details.action-group').forEach((details) => {
    details.open = false;
  });
}

function fillActionPicker() {
  els.actions.replaceChildren();

  for (const group of ACTION_MENU_GROUPS) {
    const details = document.createElement('details');
    details.className = 'action-group';

    const summary = document.createElement('summary');
    summary.textContent = uiMessage(group.titleKey);
    details.append(summary);

    details.addEventListener('toggle', () => {
      if (!details.open) {
        return;
      }
      els.actions.querySelectorAll('details.action-group').forEach((other) => {
        if (other !== details) {
          other.open = false;
        }
      });
    });

    if (group.kind === 'translate') {
      const row = document.createElement('div');
      row.className = 'action-translate';

      const select = document.createElement('select');
      select.id = 'translate-language';
      select.setAttribute('aria-label', uiMessage('menuGroupTranslate'));
      for (const language of LANGUAGES) {
        const option = document.createElement('option');
        option.value = language.code;
        option.textContent = language.label;
        select.append(option);
      }

      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'primary';
      button.textContent = uiMessage('menuGroupTranslate');
      button.addEventListener('click', () => {
        collapseActionGroups();
        requestRunAction(`${TRANSLATE_ACTION_PREFIX}${select.value}`);
      });

      row.append(select, button);
      details.append(row);
      els.actions.append(details);
      continue;
    }

    const chips = document.createElement('div');
    chips.className = 'action-chips';
    for (const actionId of group.actionIds) {
      const action = ACTION_BY_ID[actionId];
      if (!action) {
        continue;
      }
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.actionId = action.id;
      button.textContent = uiMessage(action.titleKey);
      button.addEventListener('click', () => {
        collapseActionGroups();
        requestRunAction(action.id);
      });
      chips.append(button);
    }
    details.append(chips);
    els.actions.append(details);
  }
}

function setActionsVisible(visible) {
  els.actionsWrap.hidden = !visible;
}

function setActionsEnabled(enabled) {
  els.actions.querySelectorAll('button, select').forEach((node) => {
    node.disabled = !enabled;
  });
}

async function requestRunAction(actionId) {
  const selectionText = els.selection.textContent.trim();
  if (!selectionText) {
    els.resultWrap.hidden = false;
    els.error.hidden = false;
    els.error.textContent = uiMessage('errorNoSelection');
    return;
  }

  els.error.hidden = true;
  els.error.textContent = '';
  setActionsEnabled(false);

  try {
    const response = await chrome.runtime.sendMessage({
      type: 'RUN_ACTION',
      actionId,
      selectionText,
    });
    if (!response?.ok) {
      throw new Error(response?.error || uiMessage('errorApi'));
    }
  } catch (error) {
    els.resultWrap.hidden = false;
    els.error.hidden = false;
    els.error.textContent = error instanceof Error ? error.message : String(error);
    setActionsEnabled(true);
  }
}

function applyLiveSelection(text) {
  const trimmed = typeof text === 'string' ? text.trim() : '';

  if (!trimmed) {
    if (lastLiveSelection || latestResultText || activeAbort) {
      clearGeneratedOutput();
    }
    lastLiveSelection = '';
    els.selection.textContent = '';
    setActionsVisible(false);
    els.job.hidden = true;
    els.idle.hidden = false;
    return;
  }

  if (trimmed === lastLiveSelection) {
    els.idle.hidden = true;
    els.job.hidden = false;
    els.selection.textContent = trimmed;
    setActionsVisible(true);
    setActionsEnabled(!activeAbort);
    return;
  }

  lastLiveSelection = trimmed;
  clearGeneratedOutput();

  els.idle.hidden = true;
  els.job.hidden = false;
  els.selection.textContent = trimmed;
  setActionsVisible(true);
  setActionsEnabled(true);
}

async function loadLiveSelection() {
  const stored = await chrome.storage.session.get(STORAGE_LIVE_SELECTION_KEY);
  const live = stored[STORAGE_LIVE_SELECTION_KEY];
  if (live?.text) {
    applyLiveSelection(live.text);
  }
}

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === MESSAGE_JOB_UPDATED && message.job) {
    runJob(message.job);
  }
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'session') {
    return;
  }

  if (changes[STORAGE_LIVE_SELECTION_KEY]) {
    applyLiveSelection(changes[STORAGE_LIVE_SELECTION_KEY].newValue?.text || '');
  }

  if (changes[STORAGE_PENDING_JOB_KEY]?.newValue) {
    const job = changes[STORAGE_PENDING_JOB_KEY].newValue;
    const jobSelection = (job.selectionText || '').trim();
    // Ignore stale jobs after the user already selected different text.
    if (!lastLiveSelection || !jobSelection || jobSelection === lastLiveSelection) {
      runJob(job);
    }
  }
});

async function init() {
  const stored = await chrome.storage.sync.get(STORAGE_SETTINGS_KEY);
  currentSettings = mergeSettings(stored[STORAGE_SETTINGS_KEY]);
  await loadMessageCatalog(currentSettings.uiLanguage);
  applyStaticI18n();
  fillLanguageSelects();
  paintSettingsForm(currentSettings);
  if (currentSettings.baseUrl.trim()) {
    await refreshModelOptions({ quiet: true });
  }
  await loadLiveSelection();
  await loadPendingJob();
}

init().catch((error) => {
  els.idle.hidden = true;
  els.job.hidden = false;
  els.error.hidden = false;
  els.error.textContent = error instanceof Error ? error.message : String(error);
});
