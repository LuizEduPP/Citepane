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

const els = {
  idle: document.getElementById('idle'),
  job: document.getElementById('job'),
  actionLabel: document.getElementById('action-label'),
  selection: document.getElementById('selection'),
  sourcesWrap: document.getElementById('sources-wrap'),
  sources: document.getElementById('sources'),
  status: document.getElementById('status'),
  result: document.getElementById('result'),
  error: document.getElementById('error'),
  copyBtn: document.getElementById('copy-btn'),
  form: document.getElementById('settings-form'),
  baseUrl: document.getElementById('base-url'),
  model: document.getElementById('model'),
  apiKey: document.getElementById('api-key'),
  responseLanguage: document.getElementById('response-language'),
  uiLanguage: document.getElementById('ui-language'),
  settingsFeedback: document.getElementById('settings-feedback'),
};

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
  document.title = uiMessage('extName');
  document.documentElement.lang = resolveUiLocale(currentSettings.uiLanguage);
}

function fillLanguageSelects() {
  els.responseLanguage.replaceChildren();
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
}

function paintSettingsForm(settings) {
  els.baseUrl.value = settings.baseUrl;
  els.model.value = settings.model;
  els.apiKey.value = settings.apiKey;
  els.responseLanguage.value = settings.responseLanguage;
  els.uiLanguage.value = settings.uiLanguage;
}

async function persistSettings(settings) {
  const next = mergeSettings(settings);
  await chrome.storage.sync.set({ [STORAGE_SETTINGS_KEY]: next });
  currentSettings = next;
  await chrome.runtime.sendMessage({ type: 'REBUILD_MENUS' }).catch(() => {});
  return next;
}

async function ensureApiPermission(baseUrl) {
  const response = await chrome.runtime.sendMessage({
    type: 'ENSURE_HOST_PERMISSION',
    baseUrl,
  });
  if (!response?.ok) {
    throw new Error(response?.error || 'Host permission denied');
  }
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
    systemParts.push(languageInstruction(job.responseLanguage));
  }

  if (action.needsGrounding) {
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

function setResultText(text) {
  latestResultText = text;
  els.result.textContent = text;
  els.copyBtn.hidden = !text;
}

async function runJob(job) {
  if (activeAbort) {
    activeAbort.abort();
    activeAbort = null;
  }

  els.idle.hidden = true;
  els.job.hidden = false;
  els.error.hidden = true;
  els.error.textContent = '';
  els.selection.textContent = job.selectionText || '';
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
    els.status.textContent = uiMessage('uiLoading');
    setResultText('');
    return;
  }

  if (job.status === 'error') {
    els.status.textContent = '';
    setResultText('');
    els.error.hidden = false;
    els.error.textContent = job.error || uiMessage('errorApi');
    return;
  }

  if (job.status !== 'ready') {
    return;
  }

  const action = resolveAction(job.actionId);
  if (action.needsGrounding && !evidenceIsUsable(job.pageContext, job.evidence)) {
    els.status.textContent = '';
    setResultText('');
    els.error.hidden = false;
    els.error.textContent = uiMessage('errorNoEvidence');
    return;
  }

  els.status.textContent = uiMessage('uiLoading');
  setResultText('');

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
    els.error.hidden = false;
    els.error.textContent = error instanceof Error ? error.message : String(error);
  } finally {
    if (activeAbort === controller) {
      activeAbort = null;
    }
  }
}

async function loadPendingJob() {
  const stored = await chrome.storage.session.get(STORAGE_PENDING_JOB_KEY);
  const job = stored[STORAGE_PENDING_JOB_KEY];
  if (!job) {
    els.idle.hidden = false;
    els.job.hidden = true;
    els.copyBtn.hidden = true;
    return;
  }
  await runJob(job);
}

els.form.addEventListener('submit', async (event) => {
  event.preventDefault();
  els.settingsFeedback.hidden = true;

  try {
    const next = await persistSettings({
      baseUrl: els.baseUrl.value,
      model: els.model.value,
      apiKey: els.apiKey.value,
      responseLanguage: els.responseLanguage.value,
      uiLanguage: els.uiLanguage.value,
    });

    await loadMessageCatalog(next.uiLanguage);
    applyStaticI18n();
    fillLanguageSelects();
    paintSettingsForm(next);

    els.settingsFeedback.hidden = false;
    els.settingsFeedback.textContent = uiMessage('uiSaved');
  } catch (error) {
    els.settingsFeedback.hidden = false;
    els.settingsFeedback.textContent = error instanceof Error ? error.message : String(error);
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

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === MESSAGE_JOB_UPDATED && message.job) {
    runJob(message.job);
  }
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === 'session' && changes[STORAGE_PENDING_JOB_KEY]?.newValue) {
    runJob(changes[STORAGE_PENDING_JOB_KEY].newValue);
  }
});

async function init() {
  const stored = await chrome.storage.sync.get(STORAGE_SETTINGS_KEY);
  currentSettings = mergeSettings(stored[STORAGE_SETTINGS_KEY]);
  await loadMessageCatalog(currentSettings.uiLanguage);
  applyStaticI18n();
  fillLanguageSelects();
  paintSettingsForm(currentSettings);
  await loadPendingJob();
}

init().catch((error) => {
  els.idle.hidden = true;
  els.job.hidden = false;
  els.error.hidden = false;
  els.error.textContent = error instanceof Error ? error.message : String(error);
});
