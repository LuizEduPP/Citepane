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
  selectionWrap: document.getElementById('selection-wrap'),
  selection: document.getElementById('selection'),
  actionsWrap: document.getElementById('actions-wrap'),
  actionTabs: document.getElementById('action-tabs'),
  actions: document.getElementById('actions'),
  sourcesWrap: document.getElementById('sources-wrap'),
  sources: document.getElementById('sources'),
  resultWrap: document.getElementById('result-wrap'),
  status: document.getElementById('status'),
  result: document.getElementById('result'),
  error: document.getElementById('error'),
  copyBtn: document.getElementById('copy-btn'),
  settingsBtn: document.getElementById('settings-btn'),
  settingsOverlay: document.getElementById('settings-overlay'),
  settingsPanel: document.getElementById('settings-panel'),
  settingsBackdrop: document.getElementById('settings-backdrop'),
  settingsClose: document.getElementById('settings-close'),
  form: document.getElementById('settings-form'),
  baseUrl: document.getElementById('base-url'),
  model: document.getElementById('model'),
  refreshModels: document.getElementById('refresh-models'),
  apiKey: document.getElementById('api-key'),
  responseLanguage: document.getElementById('response-language'),
  uiLanguage: document.getElementById('ui-language'),
  theme: document.getElementById('theme'),
  settingsFeedback: document.getElementById('settings-feedback'),
  summarizePageBtn: document.getElementById('summarize-page-btn'),
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
  els.settingsOverlay.hidden = !open;
  els.settingsBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
  document.body.classList.toggle('settings-open', open);
  if (open) {
    const focusTarget = els.baseUrl;
    if (focusTarget && typeof focusTarget.focus === 'function') {
      focusTarget.focus();
    }
  }
}

function setSelectionVisible(text) {
  const trimmed = typeof text === 'string' ? text.trim() : '';
  els.selection.textContent = trimmed;
  els.selectionWrap.hidden = !trimmed;
}

function setActionLabel(text) {
  const label = typeof text === 'string' ? text.trim() : '';
  els.actionLabel.textContent = label;
  els.actionLabel.hidden = !label;
}

function setStatus(text) {
  const status = typeof text === 'string' ? text.trim() : '';
  els.status.textContent = status;
  els.status.hidden = !status;
}

function syncResultSection() {
  const hasGallery = Boolean(els.result.querySelector('.media-gallery'));
  const hasResult = Boolean(latestResultText) || hasGallery;
  const hasError = !els.error.hidden && Boolean(els.error.textContent);
  els.resultWrap.hidden = !(hasResult || hasError);
}

function isMediaTooltipAction(action) {
  return action?.resultMode === 'media-tooltips';
}

function parseMediaCaptions(text) {
  if (typeof text !== 'string' || !text.trim()) {
    return {};
  }

  const match = text.match(/\[[\s\S]*\]/);
  if (!match) {
    return {};
  }

  try {
    const data = JSON.parse(match[0]);
    if (!Array.isArray(data)) {
      return {};
    }
    const captions = {};
    for (const row of data) {
      const index = Number(row?.i ?? row?.index);
      const caption = typeof row?.caption === 'string' ? row.caption.trim() : '';
      if (Number.isFinite(index) && index > 0 && caption) {
        captions[index] = caption;
      }
    }
    return captions;
  } catch {
    return {};
  }
}

function mediaCopyText(evidence, captionsByIndex = {}) {
  if (!Array.isArray(evidence)) {
    return '';
  }
  return evidence
    .map((item, index) => {
      const caption = captionsByIndex[index + 1] || item.title || '';
      const url = item.url || item.imageUrl || '';
      return caption ? `${caption}\n${url}` : url;
    })
    .filter(Boolean)
    .join('\n\n');
}

function renderMediaGallery(evidence, captionsByIndex = {}) {
  renderSources([]);
  els.result.replaceChildren();

  if (!Array.isArray(evidence) || evidence.length === 0) {
    latestResultText = '';
    els.copyBtn.hidden = true;
    syncResultSection();
    return;
  }

  const grid = document.createElement('div');
  grid.className = 'media-gallery';

  evidence.forEach((item, index) => {
    const caption = captionsByIndex[index + 1] || item.title || item.snippet || '';
    const href = item.url || item.imageUrl || '#';
    const thumb = item.thumbnail || item.imageUrl || '';

    const card = document.createElement('a');
    card.className = `media-card${item.kind === 'video' ? ' media-video' : ' media-image'}`;
    card.href = href;
    card.target = '_blank';
    card.rel = 'noreferrer noopener';
    card.dataset.index = String(index + 1);
    if (caption) {
      card.title = caption;
      card.setAttribute('aria-label', caption);
    }

    if (thumb) {
      const img = document.createElement('img');
      img.src = thumb;
      img.alt = caption || '';
      img.loading = 'lazy';
      img.referrerPolicy = 'no-referrer';
      card.append(img);
    } else {
      const fallback = document.createElement('span');
      fallback.className = 'media-fallback';
      fallback.textContent = item.kind === 'video' ? '▶' : '🖼';
      card.append(fallback);
    }

    if (item.kind === 'video') {
      const badge = document.createElement('span');
      badge.className = 'media-badge';
      badge.textContent = '▶';
      badge.setAttribute('aria-hidden', 'true');
      card.append(badge);
    }

    grid.append(card);
  });

  els.result.append(grid);
  latestResultText = mediaCopyText(evidence, captionsByIndex);
  els.copyBtn.hidden = !latestResultText;
  els.error.hidden = true;
  els.error.textContent = '';
  syncResultSection();
}

function applyMediaCaptions(captionsByIndex) {
  const cards = els.result.querySelectorAll('.media-card[data-index]');
  cards.forEach((card) => {
    const index = Number(card.dataset.index);
    const caption = captionsByIndex[index];
    if (!caption) {
      return;
    }
    card.title = caption;
    card.setAttribute('aria-label', caption);
    const img = card.querySelector('img');
    if (img) {
      img.alt = caption;
    }
  });
}

function setResultVisible(visible) {
  if (!visible) {
    els.resultWrap.hidden = true;
    return;
  }
  syncResultSection();
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
    lines.push(`URL: ${compactUrl(pageContext.url || '')}`);
    lines.push(`Title: ${pageContext.title || ''}`);
    if (pageContext.description) {
      lines.push(`Description: ${pageContext.description}`);
    }
    if (pageContext.excerpt) {
      lines.push(`Excerpt: ${pageContext.excerpt}`);
    }
    if (pageContext.body) {
      lines.push('PAGE CONTENT');
      lines.push(pageContext.body);
    }
  }

  if (Array.isArray(evidence) && evidence.length > 0) {
    lines.push('');
    const kind = evidence[0]?.kind;
    lines.push(kind === 'image' ? 'IMAGE EVIDENCE' : kind === 'video' ? 'VIDEO EVIDENCE' : 'SEARCH EVIDENCE');
    evidence.forEach((item, index) => {
      lines.push(`${index + 1}. ${item.title}`);
      lines.push(`   URL: ${compactUrl(item.url || '')}`);
      if (item.imageUrl) {
        lines.push(`   Image URL: ${compactUrl(item.imageUrl)}`);
      }
      if (item.kind) {
        lines.push(`   Kind: ${item.kind}`);
      }
      if (item.snippet) {
        lines.push(`   Snippet: ${item.snippet}`);
      }
    });
  }

  return lines.join('\n');
}

function buildUserContent(job, action) {
  if (action.id === 'summarize-page') {
    const body = typeof job.pageContext?.body === 'string' ? job.pageContext.body.trim() : '';
    if (body) {
      return body;
    }
  }
  return job.selectionText || '';
}

function buildMessages(job, action) {
  const systemParts = [action.systemPrompt];

  if (!isTranslateActionId(action.id) && action.resultMode !== 'media-tooltips') {
    systemParts.push(MARKDOWN_FORMAT_RULE);
  }
  if (!isTranslateActionId(action.id)) {
    systemParts.push(languageInstruction(job.responseLanguage));
  }

  if (action.needsGrounding || action.usePageContext) {
    // For summarize-page the full body is the user message; keep metadata only here.
    if (action.id === 'summarize-page' && job.pageContext) {
      const meta = {
        url: job.pageContext.url,
        title: job.pageContext.title,
        description: job.pageContext.description,
      };
      systemParts.push(formatEvidenceBlock(meta, []));
    } else {
      systemParts.push(formatEvidenceBlock(job.pageContext, job.evidence));
    }
  }

  return [
    { role: 'system', content: systemParts.join('\n\n') },
    { role: 'user', content: buildUserContent(job, action) },
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
    if (item.kind === 'image' || item.kind === 'video') {
      li.className = `source-media source-${item.kind}`;
    }

    const thumbUrl = item.thumbnail || (item.kind === 'image' ? item.imageUrl : '');
    if (thumbUrl) {
      const thumb = document.createElement('img');
      thumb.className = 'source-thumb';
      thumb.src = thumbUrl;
      thumb.alt = '';
      thumb.loading = 'lazy';
      thumb.referrerPolicy = 'no-referrer';
      li.append(thumb);
    }

    const body = document.createElement('div');
    body.className = 'source-body';

    const link = document.createElement('a');
    link.href = item.url;
    link.target = '_blank';
    link.rel = 'noreferrer noopener';
    link.textContent = item.title || item.url;
    body.append(link);

    if (item.snippet) {
      const snip = document.createElement('div');
      snip.className = 'muted';
      snip.textContent = item.snippet;
      body.append(snip);
    }

    li.append(body);
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
  const compacted = compactUrlsInText(text || '');
  latestResultText = compacted;
  if (!compacted) {
    els.result.replaceChildren();
  } else {
    els.result.innerHTML = renderMarkdown(compacted);
    els.result.querySelectorAll('a[href]').forEach((anchor) => {
      const href = compactUrl(anchor.getAttribute('href') || '');
      if (href) {
        anchor.setAttribute('href', href);
      }
      anchor.setAttribute('target', '_blank');
      anchor.setAttribute('rel', 'noopener noreferrer');
    });
  }
  els.copyBtn.hidden = !compacted;
  syncResultSection();
}

function clearGeneratedOutput({ clearJobStorage = true } = {}) {
  if (activeAbort) {
    activeAbort.abort();
    activeAbort = null;
  }

  setActionLabel('');
  setStatus('');
  els.error.hidden = true;
  els.error.textContent = '';
  latestResultText = '';
  els.result.replaceChildren();
  els.copyBtn.hidden = true;
  els.resultWrap.hidden = true;
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

  let action = null;
  try {
    action = resolveAction(job.actionId);
    setActionLabel(
      isTranslateActionId(job.actionId)
        ? `${uiMessage('actionTranslate')} → ${LANGUAGE_BY_CODE[job.targetLanguage].label}`
        : uiMessage(action.titleKey),
    );
  } catch {
    setActionLabel(job.actionId || '');
  }

  if (!selectionText && action?.id === 'summarize-page' && job.pageContext) {
    const pageLabel = [job.pageContext.title, job.pageContext.url].filter(Boolean).join('\n');
    setSelectionVisible(pageLabel || '');
  } else {
    setSelectionVisible(selectionText);
  }
  setActionsVisible(Boolean(selectionText));
  collapseActionGroups();
  setActionsEnabled(false);

  if (action && isMediaTooltipAction(action) && Array.isArray(job.evidence) && job.evidence.length > 0) {
    renderMediaGallery(job.evidence);
  } else {
    renderSources(job.evidence);
  }

  if (job.status === 'loading') {
    setStatus(uiMessage('uiLoading'));
    if (!(action && isMediaTooltipAction(action))) {
      latestResultText = '';
      els.result.replaceChildren();
      els.copyBtn.hidden = true;
      syncResultSection();
    }
    els.error.hidden = true;
    els.error.textContent = '';
    setActionsEnabled(false);
    return;
  }

  if (job.status === 'error') {
    setStatus('');
    if (!(action && isMediaTooltipAction(action))) {
      latestResultText = '';
      els.result.replaceChildren();
      els.copyBtn.hidden = true;
    }
    els.error.hidden = false;
    els.error.textContent = job.error || uiMessage('errorApi');
    syncResultSection();
    setActionsEnabled(true);
    return;
  }

  if (job.status !== 'ready') {
    setActionsEnabled(true);
    return;
  }

  action = resolveAction(job.actionId);
  if (action.needsGrounding && !evidenceIsUsable(job.pageContext, job.evidence)) {
    setStatus('');
    latestResultText = '';
    els.result.replaceChildren();
    els.copyBtn.hidden = true;
    els.error.hidden = false;
    els.error.textContent = uiMessage('errorNoEvidence');
    syncResultSection();
    setActionsEnabled(true);
    return;
  }

  setStatus(uiMessage('uiLoading'));
  els.error.hidden = true;
  els.error.textContent = '';
  setActionsEnabled(false);

  const mediaMode = isMediaTooltipAction(action);
  if (mediaMode) {
    renderMediaGallery(job.evidence);
  } else {
    latestResultText = '';
    els.result.replaceChildren();
    els.copyBtn.hidden = true;
    syncResultSection();
  }

  const controller = new AbortController();
  activeAbort = controller;

  try {
    const messages = buildMessages(job, action);
    const full = await streamChatCompletion({
      settings: currentSettings,
      messages,
      signal: controller.signal,
      onDelta: mediaMode
        ? () => {}
        : (delta) => {
            setResultText(latestResultText + delta);
          },
    });

    if (mediaMode) {
      const captions = parseMediaCaptions(full);
      applyMediaCaptions(captions);
      latestResultText = mediaCopyText(job.evidence, captions);
      els.copyBtn.hidden = !latestResultText;
      setStatus('');
      await chrome.storage.session.set({
        [STORAGE_LAST_RESULT_KEY]: {
          actionId: job.actionId,
          text: latestResultText,
          createdAt: Date.now(),
        },
      });
    } else {
      setResultText(full);
      setStatus('');
      await chrome.storage.session.set({
        [STORAGE_LAST_RESULT_KEY]: {
          actionId: job.actionId,
          text: full,
          createdAt: Date.now(),
        },
      });
    }
  } catch (error) {
    if (error?.name === 'AbortError') {
      return;
    }
    setStatus('');
    els.error.hidden = false;
    els.error.textContent = error instanceof Error ? error.message : String(error);
    syncResultSection();
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

    els.settingsFeedback.hidden = true;
    els.settingsFeedback.textContent = '';
    setSettingsOpen(false);
  } catch (error) {
    els.settingsFeedback.hidden = false;
    els.settingsFeedback.textContent = error instanceof Error ? error.message : String(error);
  }
});

els.settingsBtn.addEventListener('click', () => {
  setSettingsOpen(els.settingsOverlay.hidden);
});

els.settingsBackdrop.addEventListener('click', () => {
  setSettingsOpen(false);
});

els.settingsClose.addEventListener('click', () => {
  setSettingsOpen(false);
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !els.settingsOverlay.hidden) {
    setSettingsOpen(false);
  }
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

els.summarizePageBtn?.addEventListener('click', () => {
  requestRunAction('summarize-page');
});

let activeActionGroupId = null;

function collapseActionGroups() {
  activeActionGroupId = null;
  els.actions.replaceChildren();
  els.actions.hidden = true;
  els.actionTabs.hidden = false;
  els.actionTabs.querySelectorAll('.action-tab').forEach((tab) => {
    tab.setAttribute('aria-selected', 'false');
  });
}

function renderActionGroupPanel(group) {
  els.actions.replaceChildren();

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
    button.className = 'action-item action-run';
    button.textContent = uiMessage('menuGroupTranslate');
    button.addEventListener('click', () => {
      collapseActionGroups();
      requestRunAction(`${TRANSLATE_ACTION_PREFIX}${select.value}`);
    });

    row.append(select, button);
    els.actions.append(row);
    els.actions.hidden = false;
    return;
  }

  for (const actionId of group.actionIds) {
    const action = ACTION_BY_ID[actionId];
    if (!action) {
      continue;
    }
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'action-item';
    button.dataset.actionId = action.id;
    button.textContent = uiMessage(action.titleKey);
    button.addEventListener('click', () => {
      collapseActionGroups();
      requestRunAction(action.id);
    });
    els.actions.append(button);
  }

  els.actions.hidden = els.actions.childElementCount === 0;
}

function setActiveActionGroup(groupId) {
  if (activeActionGroupId === groupId) {
    collapseActionGroups();
    return;
  }

  const group = ACTION_MENU_GROUPS.find((item) => item.id === groupId);
  if (!group) {
    collapseActionGroups();
    return;
  }

  activeActionGroupId = groupId;
  els.actionTabs.querySelectorAll('.action-tab').forEach((tab) => {
    tab.setAttribute('aria-selected', tab.dataset.groupId === groupId ? 'true' : 'false');
  });
  renderActionGroupPanel(group);
}

function fillActionPicker() {
  els.actionTabs.replaceChildren();
  collapseActionGroups();

  for (const group of ACTION_MENU_GROUPS) {
    const tab = document.createElement('button');
    tab.type = 'button';
    tab.className = 'action-tab';
    tab.setAttribute('role', 'tab');
    tab.dataset.groupId = group.id;
    tab.setAttribute('aria-selected', 'false');
    tab.textContent = uiMessage(group.titleKey);
    tab.addEventListener('click', () => {
      setActiveActionGroup(group.id);
    });
    els.actionTabs.append(tab);
  }
}

function setActionsVisible(visible) {
  els.actionsWrap.hidden = !visible;
  collapseActionGroups();
}

function setActionsEnabled(enabled) {
  els.actionTabs.querySelectorAll('button').forEach((node) => {
    node.disabled = !enabled;
  });
  els.actions.querySelectorAll('button, select').forEach((node) => {
    node.disabled = !enabled;
  });
  if (els.summarizePageBtn) {
    els.summarizePageBtn.disabled = !enabled;
  }
}

async function requestRunAction(actionId) {
  let action;
  try {
    action = resolveAction(actionId);
  } catch (error) {
    els.error.hidden = false;
    els.error.textContent = error instanceof Error ? error.message : String(error);
    els.idle.hidden = true;
    els.job.hidden = false;
    syncResultSection();
    return;
  }

  const selectionText = els.selection.textContent.trim();
  if (!selectionText && action.requiresSelection !== false) {
    els.error.hidden = false;
    els.error.textContent = uiMessage('errorNoSelection');
    els.idle.hidden = true;
    els.job.hidden = false;
    syncResultSection();
    return;
  }

  els.error.hidden = true;
  els.error.textContent = '';
  syncResultSection();
  setActionsEnabled(false);
  if (els.summarizePageBtn) {
    els.summarizePageBtn.disabled = true;
  }

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
    els.idle.hidden = true;
    els.job.hidden = false;
    els.error.hidden = false;
    els.error.textContent = error instanceof Error ? error.message : String(error);
    syncResultSection();
    setActionsEnabled(true);
    if (els.summarizePageBtn) {
      els.summarizePageBtn.disabled = false;
    }
  }
}

function applyLiveSelection(text) {
  const trimmed = typeof text === 'string' ? text.trim() : '';

  if (!trimmed) {
    if (lastLiveSelection || latestResultText || activeAbort) {
      clearGeneratedOutput();
    }
    lastLiveSelection = '';
    setSelectionVisible('');
    setActionLabel('');
    setActionsVisible(false);
    els.job.hidden = true;
    els.idle.hidden = false;
    return;
  }

  if (trimmed === lastLiveSelection) {
    els.idle.hidden = true;
    els.job.hidden = false;
    setSelectionVisible(trimmed);
    setActionsVisible(true);
    setActionsEnabled(!activeAbort);
    return;
  }

  lastLiveSelection = trimmed;
  clearGeneratedOutput();

  els.idle.hidden = true;
  els.job.hidden = false;
  setSelectionVisible(trimmed);
  setActionsVisible(true);
  setActionsEnabled(true);
}

function resetPanelUi() {
  if (activeAbort) {
    activeAbort.abort();
    activeAbort = null;
  }

  lastLiveSelection = '';
  latestResultText = '';
  setSettingsOpen(false);
  setActionLabel('');
  setStatus('');
  els.error.hidden = true;
  els.error.textContent = '';
  els.result.replaceChildren();
  els.copyBtn.hidden = true;
  els.resultWrap.hidden = true;
  renderSources([]);
  setSelectionVisible('');
  setActionsVisible(false);
  collapseActionGroups();
  els.job.hidden = true;
  els.idle.hidden = false;
}

function clearPanelSession() {
  chrome.storage.session
    .remove([STORAGE_PENDING_JOB_KEY, STORAGE_LAST_RESULT_KEY, STORAGE_LIVE_SELECTION_KEY])
    .catch(() => {});
}

function resetPanelOnClose() {
  resetPanelUi();
  clearPanelSession();
}

chrome.runtime.connect({ name: SIDEPANEL_PORT_NAME });

window.addEventListener('pagehide', () => {
  resetPanelOnClose();
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    resetPanelOnClose();
  }
});

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
  // Fresh open: idle until a new selection or job arrives (closing clears session).
  resetPanelUi();
  await loadPendingJob();
}

init().catch((error) => {
  els.idle.hidden = true;
  els.job.hidden = false;
  els.error.hidden = false;
  els.error.textContent = error instanceof Error ? error.message : String(error);
  syncResultSection();
});
