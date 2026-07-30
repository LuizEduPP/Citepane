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
let cancelRequested = false;
let localCancelledAt = 0;
let inferenceBusy = false;
let latestResultText = '';
let lastLiveSelection = '';
let lastHandledJobKey = '';
let runJobSeq = 0;

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
  resultChrome: document.getElementById('result-chrome'),
  resultWrap: document.getElementById('result-wrap'),
  status: document.getElementById('status'),
  cancelBtn: document.getElementById('cancel-btn'),
  result: document.getElementById('result'),
  error: document.getElementById('error'),
  copyBtn: document.getElementById('copy-btn'),
  settingsBtn: document.getElementById('settings-btn'),
  githubLink: document.getElementById('github-link'),
  settingsOverlay: document.getElementById('settings-overlay'),
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

function setupGithubIcon() {
  const path = els.githubLink?.querySelector('.github-path');
  if (!path) {
    return;
  }

  const len = Math.ceil(path.getTotalLength());
  path.style.setProperty('--github-len', String(len));

  const play = () => {
    path.classList.remove('is-drawing');
    // Force restart so hover can replay the stroke draw.
    void path.getBoundingClientRect();
    path.classList.add('is-drawing');
  };

  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    path.style.fillOpacity = '1';
    path.style.strokeOpacity = '0';
    path.style.strokeDashoffset = '0';
    return;
  }

  play();
  els.githubLink.addEventListener('mouseenter', play);
  els.githubLink.addEventListener('focus', play);
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
  syncResultSection();
}

function setStatus(text) {
  const status = typeof text === 'string' ? text.trim() : '';
  els.status.textContent = status;
  els.status.hidden = !status;
  syncResultSection();
}

function setCancelAvailable(available) {
  els.cancelBtn.hidden = !available;
  els.cancelBtn.classList.toggle('is-busy', Boolean(available));
  syncResultSection();
}

function setCopyAvailable(available) {
  els.copyBtn.hidden = !(available && latestResultText);
  syncResultSection();
}

function syncResultSection() {
  const hasGallery = Boolean(els.result.querySelector('.media-gallery'));
  const hasResult = Boolean(latestResultText) || hasGallery;
  const hasError = !els.error.hidden && Boolean(els.error.textContent);
  const hasAction = Boolean(els.actionLabel.textContent);
  const canCancel = !els.cancelBtn.hidden;
  const showChrome = hasAction || canCancel || !els.copyBtn.hidden;
  const showBody = hasResult || hasError;

  if (els.resultChrome) {
    els.resultChrome.hidden = !showChrome;
  }
  els.resultWrap.hidden = !showBody;
}

function markLocalCancelled(createdAt) {
  const stamp =
    typeof createdAt === 'number' && Number.isFinite(createdAt) ? createdAt : Date.now();
  localCancelledAt = Math.max(localCancelledAt, stamp);
  cancelRequested = true;
  return localCancelledAt;
}

function jobIsCancelled(job) {
  if (typeof job?.createdAt !== 'number') {
    return cancelRequested;
  }
  return job.createdAt <= localCancelledAt;
}

async function syncCancelledWatermark() {
  try {
    const stored = await chrome.storage.session.get(STORAGE_CANCELLED_JOB_KEY);
    const cancelledAt = stored[STORAGE_CANCELLED_JOB_KEY];
    if (typeof cancelledAt === 'number') {
      localCancelledAt = Math.max(localCancelledAt, cancelledAt);
    }
  } catch {
    // ignore
  }
}

function abortActiveStream() {
  if (activeAbort) {
    activeAbort.abort();
    activeAbort = null;
  }
}

function invalidateJobRuns() {
  runJobSeq += 1;
  lastHandledJobKey = '';
}

function clearJobOutputUi() {
  setActionLabel('');
  setStatus('');
  setCancelAvailable(false);
  setInferenceBusy(false);
  els.error.hidden = true;
  els.error.textContent = '';
  latestResultText = '';
  els.result.replaceChildren();
  setCopyAvailable(false);
  if (els.resultChrome) {
    els.resultChrome.hidden = true;
  }
  els.resultWrap.hidden = true;
  renderSources([]);
}

function finishCancelledUi() {
  setCancelAvailable(false);
  setStatus('');
  setInferenceBusy(false);
}

async function persistLastResult(actionId, text) {
  await chrome.storage.session.set({
    [STORAGE_LAST_RESULT_KEY]: {
      actionId,
      text,
      createdAt: Date.now(),
    },
  });
}

/** Service worker owns cancelledJobAt + pending removal. Extra session keys cleared here. */
function requestCancelJob({ createdAt, removeKeys = [] } = {}) {
  const stamp = markLocalCancelled(createdAt ?? Date.now());
  chrome.runtime.sendMessage({ type: MESSAGE_CANCEL_JOB, createdAt: stamp }).catch(() => {});

  const extras = removeKeys.filter((key) => key !== STORAGE_PENDING_JOB_KEY);
  if (extras.length > 0) {
    chrome.storage.session.remove(extras).catch(() => {});
  }
  return stamp;
}

function stopCurrentWork({ removeKeys = [] } = {}) {
  abortActiveStream();
  invalidateJobRuns();
  clearJobOutputUi();

  chrome.storage.session
    .get(STORAGE_PENDING_JOB_KEY)
    .then((stored) => {
      const pendingAt = stored[STORAGE_PENDING_JOB_KEY]?.createdAt;
      requestCancelJob({
        createdAt: typeof pendingAt === 'number' ? Math.max(pendingAt, Date.now()) : Date.now(),
        removeKeys,
      });
    })
    .catch(() => {
      requestCancelJob({ removeKeys });
    });
}

function cancelInference() {
  stopCurrentWork();
}

function clearGeneratedOutput({ clearJobStorage = true } = {}) {
  if (!clearJobStorage) {
    abortActiveStream();
    invalidateJobRuns();
    markLocalCancelled(Date.now());
    clearJobOutputUi();
    return;
  }
  stopCurrentWork({ removeKeys: [STORAGE_LAST_RESULT_KEY] });
}

function isMediaGalleryAction(action) {
  return action?.resultMode === 'media-gallery' || action?.skipInference === true;
}

function renderMediaGallery(evidence) {
  renderSources([]);
  els.result.replaceChildren();
  latestResultText = '';
  setCopyAvailable(false);

  if (!Array.isArray(evidence) || evidence.length === 0) {
    syncResultSection();
    return;
  }

  const grid = document.createElement('div');
  grid.className = 'media-gallery';

  evidence.forEach((item) => {
    const caption = item.title || item.snippet || '';
    const href = item.url || item.imageUrl || '#';
    const thumb = item.thumbnail || item.imageUrl || '';

    const card = document.createElement('a');
    card.className = `media-card${item.kind === 'video' ? ' media-video' : ' media-image'}`;
    card.href = href;
    card.target = '_blank';
    card.rel = 'noreferrer noopener';
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
  els.error.hidden = true;
  els.error.textContent = '';
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

async function fetchAvailableModels(baseUrl, apiKey, { interactive = false } = {}) {
  await ensureApiHostPermission(baseUrl, { interactive });

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
    await ensureApiHostPermission(baseUrl, { interactive });
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

  if (!isTranslateActionId(action.id) && !isMediaGalleryAction(action)) {
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
  await ensureApiHostPermission(settings.baseUrl);

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
    if (signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }
    const data = await response.json();
    if (signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }
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

  const onAbort = () => {
    reader.cancel().catch(() => {});
  };
  if (signal) {
    if (signal.aborted) {
      onAbort();
      throw new DOMException('Aborted', 'AbortError');
    }
    signal.addEventListener('abort', onAbort, { once: true });
  }

  const decoder = new TextDecoder();
  let buffer = '';
  let full = '';

  try {
    while (true) {
      if (signal?.aborted) {
        throw new DOMException('Aborted', 'AbortError');
      }

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
  } finally {
    if (signal) {
      signal.removeEventListener('abort', onAbort);
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
  syncResultSection();
}

async function runJob(job) {
  await syncCancelledWatermark();

  if (activeAbort && jobIsCancelled(job)) {
    finishCancelledUi();
    return;
  }

  if (activeAbort) {
    abortActiveStream();
  }

  const selectionText = (job.selectionText || '').trim();
  if (selectionText) {
    lastLiveSelection = selectionText;
  }

  if (jobIsCancelled(job)) {
    finishCancelledUi();
    return;
  }

  // Newer loading job clears the cancel flag; watermark still blocks older jobs.
  if (job.status === 'loading' && typeof job.createdAt === 'number' && job.createdAt > localCancelledAt) {
    cancelRequested = false;
  }

  const seq = ++runJobSeq;

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
  setInferenceBusy(true);

  const mediaMode = action && isMediaGalleryAction(action);
  if (mediaMode && Array.isArray(job.evidence) && job.evidence.length > 0) {
    renderMediaGallery(job.evidence);
  } else if (!mediaMode) {
    renderSources(job.evidence);
  }

  if (job.status === 'loading') {
    setStatus(uiMessage('uiLoading'));
    setCopyAvailable(false);
    setCancelAvailable(true);
    if (!mediaMode) {
      latestResultText = '';
      els.result.replaceChildren();
      syncResultSection();
    }
    return;
  }

  if (job.status === 'error') {
    setStatus('');
    setCopyAvailable(false);
    setCancelAvailable(false);
    if (!mediaMode) {
      latestResultText = '';
      els.result.replaceChildren();
    }
    els.error.hidden = false;
    els.error.textContent = job.error || uiMessage('errorApi');
    syncResultSection();
    setInferenceBusy(false);
    return;
  }

  if (job.status !== 'ready') {
    setInferenceBusy(false);
    return;
  }

  action = resolveAction(job.actionId);
  if (action.needsGrounding && !evidenceIsUsable(job.pageContext, job.evidence)) {
    setStatus('');
    latestResultText = '';
    els.result.replaceChildren();
    setCopyAvailable(false);
    setCancelAvailable(false);
    els.error.hidden = false;
    els.error.textContent = uiMessage('errorNoEvidence');
    syncResultSection();
    setInferenceBusy(false);
    return;
  }

  // Images / videos: gallery only — no AI inference, no copy.
  if (isMediaGalleryAction(action)) {
    renderMediaGallery(job.evidence);
    setStatus('');
    setCopyAvailable(false);
    setCancelAvailable(false);
    setInferenceBusy(false);
    return;
  }

  setStatus(uiMessage('uiLoading'));
  els.error.hidden = true;
  els.error.textContent = '';
  setCopyAvailable(false);
  setCancelAvailable(true);
  setInferenceBusy(true);

  latestResultText = '';
  els.result.replaceChildren();
  syncResultSection();

  if (jobIsCancelled(job)) {
    finishCancelledUi();
    return;
  }

  const controller = new AbortController();
  activeAbort = controller;

  try {
    const messages = buildMessages(job, action);
    const full = await streamChatCompletion({
      settings: currentSettings,
      messages,
      signal: controller.signal,
      onDelta: (delta) => {
        if (jobIsCancelled(job) || seq !== runJobSeq) {
          return;
        }
        setResultText(latestResultText + delta);
      },
    });

    if (jobIsCancelled(job) || seq !== runJobSeq) {
      return;
    }

    setResultText(full);
    setCopyAvailable(true);
    setStatus('');
    await persistLastResult(job.actionId, full);
  } catch (error) {
    if (error?.name === 'AbortError' || jobIsCancelled(job)) {
      setStatus('');
      return;
    }
    setStatus('');
    setCopyAvailable(false);
    els.error.hidden = false;
    els.error.textContent = error instanceof Error ? error.message : String(error);
    syncResultSection();
  } finally {
    if (activeAbort === controller) {
      activeAbort = null;
    }
    if (seq === runJobSeq) {
      setCancelAvailable(false);
      setInferenceBusy(false);
    }
  }
}

async function loadPendingJob() {
  const stored = await chrome.storage.session.get(STORAGE_PENDING_JOB_KEY);
  const job = stored[STORAGE_PENDING_JOB_KEY];
  if (!job) {
    return;
  }
  enqueueJob(job);
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
      await ensureApiHostPermission(baseUrl, { interactive: true });
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
  els.copyBtn.classList.add('is-copied');
  els.copyBtn.setAttribute('aria-label', uiMessage('uiCopied'));
  setTimeout(() => {
    els.copyBtn.classList.remove('is-copied');
    els.copyBtn.setAttribute('aria-label', uiMessage('uiCopy'));
  }, 1200);
});

els.cancelBtn.addEventListener('click', () => {
  cancelInference();
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
  if (inferenceBusy) {
    return;
  }
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
  if (!enabled) {
    collapseActionGroups();
  }
  els.actionTabs.querySelectorAll('button').forEach((node) => {
    node.disabled = !enabled;
  });
  els.actions.querySelectorAll('button, select').forEach((node) => {
    node.disabled = !enabled;
  });
}

function setInferenceBusy(busy) {
  inferenceBusy = busy;
  setActionsEnabled(!busy);
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
  setInferenceBusy(true);

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
    setInferenceBusy(false);
  }
}

function applyLiveSelection(text) {
  const trimmed = typeof text === 'string' ? text.trim() : '';

  // Tab/window switches rewrite liveSelection (often empty). Never interrupt a run.
  if (inferenceBusy || activeAbort) {
    return;
  }

  // Click-away / empty selection: keep the last real selection until a new one arrives.
  if (!trimmed) {
    return;
  }

  if (trimmed === lastLiveSelection) {
    els.idle.hidden = true;
    els.job.hidden = false;
    setSelectionVisible(trimmed);
    setActionsVisible(true);
    setActionsEnabled(true);
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

function resetPanelUi({ cancelCurrent = false } = {}) {
  abortActiveStream();

  if (cancelCurrent) {
    markLocalCancelled(Date.now());
  }

  lastLiveSelection = '';
  latestResultText = '';
  cancelRequested = false;
  setInferenceBusy(false);
  invalidateJobRuns();
  setSettingsOpen(false);
  setActionLabel('');
  setStatus('');
  setCancelAvailable(false);
  els.error.hidden = true;
  els.error.textContent = '';
  els.result.replaceChildren();
  setCopyAvailable(false);
  if (els.resultChrome) {
    els.resultChrome.hidden = true;
  }
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
    .get(STORAGE_PENDING_JOB_KEY)
    .then((stored) => {
      const pendingAt = stored[STORAGE_PENDING_JOB_KEY]?.createdAt;
      requestCancelJob({
        createdAt: typeof pendingAt === 'number' ? pendingAt : Date.now(),
        removeKeys: [STORAGE_LAST_RESULT_KEY, STORAGE_LIVE_SELECTION_KEY],
      });
    })
    .catch(() => {
      requestCancelJob({
        removeKeys: [STORAGE_LAST_RESULT_KEY, STORAGE_LIVE_SELECTION_KEY],
      });
    });
}

function resetPanelOnClose() {
  resetPanelUi({ cancelCurrent: true });
  clearPanelSession();
}

chrome.runtime.connect({ name: SIDEPANEL_PORT_NAME });

// Real unload only — visibilitychange fires on focus loss / DevTools and must not wipe jobs.
window.addEventListener('pagehide', () => {
  resetPanelOnClose();
});

function enqueueJob(job) {
  if (!job) {
    return;
  }
  const key = `${job.createdAt || 0}:${job.status || ''}:${job.actionId || ''}`;
  if (key === lastHandledJobKey) {
    return;
  }
  lastHandledJobKey = key;
  runJob(job);
}

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
      enqueueJob(job);
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
  setupGithubIcon();
  if (currentSettings.baseUrl.trim()) {
    await refreshModelOptions({ quiet: true });
  }

  const session = await chrome.storage.session.get([
    STORAGE_CANCELLED_JOB_KEY,
    STORAGE_LIVE_SELECTION_KEY,
  ]);
  if (typeof session[STORAGE_CANCELLED_JOB_KEY] === 'number') {
    localCancelledAt = Math.max(localCancelledAt, session[STORAGE_CANCELLED_JOB_KEY]);
  }

  // Soft reset only — must NOT cancel a pending job that opened this panel.
  resetPanelUi({ cancelCurrent: false });

  const liveText =
    typeof session[STORAGE_LIVE_SELECTION_KEY]?.text === 'string'
      ? session[STORAGE_LIVE_SELECTION_KEY].text.trim()
      : '';
  if (liveText) {
    lastLiveSelection = liveText;
    els.idle.hidden = true;
    els.job.hidden = false;
    setSelectionVisible(liveText);
    setActionsVisible(true);
    setActionsEnabled(true);
  }

  await loadPendingJob();
}

init().catch((error) => {
  els.idle.hidden = true;
  els.job.hidden = false;
  els.error.hidden = false;
  els.error.textContent = error instanceof Error ? error.message : String(error);
  syncResultSection();
});
