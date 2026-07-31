importScripts('defaults.js', 'search.js');

/** In-memory cancel watermark — avoids storage races with in-flight search. */
let cancelledJobAtMem = 0;

function t(key) {
  const message = chrome.i18n.getMessage(key);
  if (!message) {
    throw new Error(`Missing i18n message: ${key}`);
  }
  return message;
}

async function readSettings() {
  const stored = await chrome.storage.sync.get(STORAGE_SETTINGS_KEY);
  return mergeSettings(stored[STORAGE_SETTINGS_KEY]);
}

function markJobCancelled(createdAt) {
  const stamp =
    typeof createdAt === 'number' && Number.isFinite(createdAt) ? createdAt : Date.now();
  cancelledJobAtMem = Math.max(cancelledJobAtMem, stamp);
  return chrome.storage.session.set({ [STORAGE_CANCELLED_JOB_KEY]: cancelledJobAtMem });
}

async function writePendingJob(job) {
  if (await isJobCancelled(job?.createdAt)) {
    return;
  }
  await chrome.storage.session.set({ [STORAGE_PENDING_JOB_KEY]: job });
  // Re-check after await — cancel may have landed during the write.
  if (await isJobCancelled(job?.createdAt)) {
    await chrome.storage.session.remove([STORAGE_PENDING_JOB_KEY]);
  }
}

async function isJobCancelled(createdAt) {
  if (typeof createdAt !== 'number') {
    return false;
  }
  if (createdAt <= cancelledJobAtMem) {
    return true;
  }
  try {
    const stored = await chrome.storage.session.get(STORAGE_CANCELLED_JOB_KEY);
    const cancelledAt = stored[STORAGE_CANCELLED_JOB_KEY];
    if (typeof cancelledAt === 'number' && cancelledAt > cancelledJobAtMem) {
      cancelledJobAtMem = cancelledAt;
    }
    return createdAt <= cancelledJobAtMem;
  } catch {
    return createdAt <= cancelledJobAtMem;
  }
}

async function ensureContextMenus() {
  await chrome.contextMenus.removeAll();

  // Only on web pages — never inside the Citepane side panel (chrome-extension://).
  const documentUrlPatterns = ['http://*/*', 'https://*/*'];
  const selectionOnly = {
    contexts: ['selection'],
    documentUrlPatterns,
  };
  const pageOrSelection = {
    contexts: ['page', 'selection'],
    documentUrlPatterns,
  };

  chrome.contextMenus.create({
    id: EXT_PARENT_MENU_ID,
    title: t('menuRoot'),
    ...pageOrSelection,
  });

  // Direct child: available with or without a text selection.
  chrome.contextMenus.create({
    id: 'summarize-page',
    parentId: EXT_PARENT_MENU_ID,
    title: t('actionSummarizePage'),
    ...pageOrSelection,
  });

  for (const group of ACTION_MENU_GROUPS) {
    chrome.contextMenus.create({
      id: group.id,
      parentId: EXT_PARENT_MENU_ID,
      title: t(group.titleKey),
      ...selectionOnly,
    });

    if (group.kind === 'translate') {
      for (const language of LANGUAGES) {
        chrome.contextMenus.create({
          id: `${TRANSLATE_ACTION_PREFIX}${language.code}`,
          parentId: group.id,
          title: language.label,
          ...selectionOnly,
        });
      }
      continue;
    }

    for (const actionId of group.actionIds) {
      // Already created as a direct child of the root menu.
      if (actionId === 'summarize-page') {
        continue;
      }
      const action = ACTION_BY_ID[actionId];
      if (!action) {
        throw new Error(`Unknown action in menu group ${group.id}: ${actionId}`);
      }
      chrome.contextMenus.create({
        id: action.id,
        parentId: group.id,
        title: t(action.titleKey),
        ...selectionOnly,
      });
    }
  }
}

function emptyPageContext(tabUrl) {
  return {
    url: tabUrl || '',
    title: '',
    description: '',
    excerpt: '',
    body: '',
  };
}

async function requestPageContext(tabId, tabUrl) {
  try {
    const response = await chrome.tabs.sendMessage(tabId, {
      type: MESSAGE_GET_PAGE_CONTEXT,
    });
    if (response?.ok && response.pageContext) {
      return response.pageContext;
    }
  } catch {
    // Fall through to executeScript.
  }

  try {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId },
      args: [PAGE_BODY_MAX_CHARS, PAGE_CONTEXT_MAX_CHARS],
      func: (bodyMax, excerptMax) => {
        const meta =
          document.querySelector('meta[name="description"]') ||
          document.querySelector('meta[property="og:description"]');
        const selection = window.getSelection()?.toString() || '';
        const root =
          document.querySelector('article') ||
          document.querySelector('main') ||
          document.querySelector('[role="main"]') ||
          document.body;
        const body = (root?.innerText || '').replace(/\s+/g, ' ').trim().slice(0, bodyMax);
        return {
          url: location.href,
          title: document.title || '',
          description: meta?.getAttribute('content')?.trim() || '',
          excerpt: selection.replace(/\s+/g, ' ').trim().slice(0, excerptMax),
          body,
        };
      },
    });
    if (result) {
      return result;
    }
  } catch {
    // Restricted pages (chrome://, Web Store, etc.).
  }

  return emptyPageContext(tabUrl);
}

async function openSidePanel(tabId) {
  if (typeof chrome.sidePanel?.open !== 'function') {
    throw new Error('sidePanel.open is unavailable in this browser');
  }

  await chrome.sidePanel.open({ tabId });
}

function base64ToUint8Array(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function transcribeAudioMessage(message) {
  const settings = await readSettings();
  let sttBaseUrl;
  try {
    sttBaseUrl = resolveTranscriptionBaseUrl(settings);
  } catch (error) {
    throw error instanceof Error ? error : new Error(String(error));
  }

  const model = (settings.transcriptionModel || DEFAULT_TRANSCRIPTION_MODEL).trim();
  if (!model) {
    throw new Error('Set a transcription model in Citepane Settings.');
  }

  const audioBase64 = typeof message.audioBase64 === 'string' ? message.audioBase64 : '';
  if (!audioBase64) {
    throw new Error('Missing audio payload.');
  }

  const mimeType =
    typeof message.mimeType === 'string' && message.mimeType.trim()
      ? message.mimeType.trim()
      : 'audio/ogg';
  const fileName =
    typeof message.fileName === 'string' && message.fileName.trim()
      ? message.fileName.trim()
      : 'voice.ogg';

  await ensureApiHostPermission(sttBaseUrl, { interactive: false });

  const bytes = base64ToUint8Array(audioBase64);
  const file = new File([bytes], fileName, { type: mimeType });
  const form = new FormData();
  form.append('file', file);
  form.append('model', model);
  form.append('language', transcriptionLanguageHint(settings.responseLanguage));

  const headers = {};
  if (settings.apiKey.trim()) {
    headers.Authorization = `Bearer ${settings.apiKey.trim()}`;
  }

  const response = await fetch(transcriptionsUrl(sttBaseUrl), {
    method: 'POST',
    headers,
    body: form,
  });

  const bodyText = await response.text();
  if (!response.ok) {
    let detail = bodyText.slice(0, 400);
    try {
      const err = JSON.parse(bodyText)?.error?.message;
      if (typeof err === 'string' && err.trim()) {
        detail = err.trim();
      }
    } catch {
      // keep raw body slice
    }
    if (/not found|model .* not found/i.test(detail)) {
      throw new Error(
        `STT model "${model}" not found on your API. ` +
          `Chat models (llama/granite) cannot transcribe. ` +
          `Load a Whisper/STT model and set it in Citepane Settings → Transcription model.`,
      );
    }
    throw new Error(`Transcription failed HTTP ${response.status}: ${detail}`);
  }

  let payload;
  try {
    payload = JSON.parse(bodyText);
  } catch {
    throw new Error('Transcription response was not JSON.');
  }

  const text = typeof payload.text === 'string' ? payload.text.trim() : '';
  if (!text) {
    throw new Error('Transcription returned empty text.');
  }

  return text;
}

async function handleActionClick(actionId, selectionText, tab) {
  if (!tab?.id) {
    throw new Error('Active tab is required');
  }

  const action = resolveAction(actionId);
  const trimmed = typeof selectionText === 'string' ? selectionText.trim() : '';
  if (!trimmed && action.requiresSelection !== false) {
    throw new Error(t('errorNoSelection'));
  }

  const settings = await readSettings();
  // Stay strictly newer than any cancel watermark (same-ms races).
  const createdAt = Math.max(Date.now(), cancelledJobAtMem + 1);

  // Keep side panel selection in sync with the action (context-menu path).
  if (trimmed) {
    await writeLiveSelection({
      text: trimmed,
      url: tab.url || '',
      tabId: tab.id,
    });
  }

  const loadingJob = {
    actionId: action.id,
    actionTitleKey: action.titleKey,
    selectionText: trimmed,
    pageContext: null,
    evidence: [],
    responseLanguage: resolveResponseLanguage(settings.responseLanguage),
    targetLanguage: action.targetLanguage || null,
    status: 'loading',
    error: null,
    createdAt,
  };
  await writePendingJob(loadingJob);

  try {
    if (await isJobCancelled(createdAt)) {
      return;
    }

    const pageContext = await requestPageContext(tab.id, tab.url);
    if (await isJobCancelled(createdAt)) {
      return;
    }

    let evidence = [];

    if (action.id === 'summarize-page' && !pageBodyIsUsable(pageContext)) {
      throw new Error(t('errorNoPageContent'));
    }

    if (action.needsGrounding) {
      let searchError = null;
      try {
        evidence = await searchEvidence(trimmed, action.searchKind || 'web');
      } catch (error) {
        searchError = error;
        evidence = [];
      }

      if (await isJobCancelled(createdAt)) {
        return;
      }

      if (!evidenceIsUsable(pageContext, evidence)) {
        if (searchError) {
          throw new Error(
            `${t('errorSearchFailed')} ${
              searchError instanceof Error ? searchError.message : String(searchError)
            }`,
          );
        }
        throw new Error(t('errorNoEvidence'));
      }
    }

    if (await isJobCancelled(createdAt)) {
      return;
    }

    await writePendingJob({
      ...loadingJob,
      pageContext: pageContext
        ? {
            ...pageContext,
            url: compactUrl(pageContext.url || ''),
          }
        : null,
      evidence: Array.isArray(evidence)
        ? evidence.map((item) => ({
            ...item,
            url: compactUrl(item.url || ''),
            imageUrl: item.imageUrl ? compactUrl(item.imageUrl) : item.imageUrl,
            thumbnail: item.thumbnail ? compactUrl(item.thumbnail) : item.thumbnail,
          }))
        : [],
      status: 'ready',
      error: null,
    });
  } catch (error) {
    if (await isJobCancelled(createdAt)) {
      return;
    }
    await writePendingJob({
      ...loadingJob,
      status: 'error',
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

chrome.runtime.onInstalled.addListener(async () => {
  await ensureContextMenus();
  await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
});

chrome.runtime.onStartup.addListener(async () => {
  await ensureContextMenus();
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'sync' || !changes[STORAGE_SETTINGS_KEY]) {
    return;
  }

  ensureContextMenus().catch((error) => {
    console.error('Failed to rebuild context menus', error);
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  const actionId = String(info.menuItemId);
  if (
    actionId === EXT_PARENT_MENU_ID ||
    ACTION_MENU_GROUPS.some((group) => group.id === actionId)
  ) {
    return;
  }

  // sidePanel.open must run in the same turn as the user gesture — before any await.
  if (tab?.id) {
    openSidePanel(tab.id).catch((openError) => {
      console.error('Failed to open side panel', openError);
    });
  }

  handleActionClick(actionId, info.selectionText || '', tab).catch(async (error) => {
    const message = error instanceof Error ? error.message : String(error);
    await writePendingJob({
      actionId: String(actionId),
      actionTitleKey: null,
      selectionText: info.selectionText || '',
      pageContext: null,
      evidence: [],
      responseLanguage: resolveResponseLanguage(DEFAULT_RESPONSE_LANGUAGE),
      targetLanguage: null,
      status: 'error',
      error: message,
      createdAt: Date.now(),
    });
  });
});

async function writeLiveSelection({ text = '', url = '', tabId = null } = {}) {
  await chrome.storage.session.set({
    [STORAGE_LIVE_SELECTION_KEY]: {
      text: typeof text === 'string' ? text.trim() : '',
      url: typeof url === 'string' ? url : '',
      tabId: typeof tabId === 'number' ? tabId : null,
      updatedAt: Date.now(),
    },
  });
}

async function syncLiveSelectionFromTab(tabId) {
  if (typeof tabId !== 'number') {
    return;
  }

  try {
    const response = await chrome.tabs.sendMessage(tabId, {
      type: MESSAGE_GET_LIVE_SELECTION,
    });
    if (response?.ok) {
      await writeLiveSelection({
        text: response.selectionText || '',
        url: response.pageUrl || '',
        tabId,
      });
      return;
    }
  } catch {
    // No content script on this tab (chrome://, Web Store, not injected yet).
  }

  await writeLiveSelection({ text: '', url: '', tabId });
}

async function isActiveTab(tabId) {
  if (typeof tabId !== 'number') {
    return false;
  }
  try {
    const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    return tabs.some((tab) => tab.id === tabId);
  } catch {
    return false;
  }
}

chrome.tabs.onActivated.addListener((activeInfo) => {
  syncLiveSelectionFromTab(activeInfo.tabId).catch((error) => {
    console.error('Failed to sync selection on tab activate', error);
  });
});

chrome.windows.onFocusChanged.addListener((windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) {
    return;
  }
  chrome.tabs
    .query({ active: true, windowId })
    .then(async (tabs) => {
      if (tabs[0]?.id) {
        await syncLiveSelectionFromTab(tabs[0].id);
      }
    })
    .catch((error) => {
      console.error('Failed to sync selection on window focus', error);
    });
});

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== SIDEPANEL_PORT_NAME) {
    return;
  }

  // Sync the current tab as soon as the side panel connects.
  // Session cleanup is owned by the side panel pagehide handler — not port
  // disconnect — because MV3 service worker restarts also drop the port.
  chrome.tabs
    .query({ active: true, lastFocusedWindow: true })
    .then(async (tabs) => {
      if (tabs[0]?.id) {
        await syncLiveSelectionFromTab(tabs[0].id);
      }
    })
    .catch(() => {});
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === MESSAGE_CANCEL_JOB) {
    const stamp =
      typeof message.createdAt === 'number' && Number.isFinite(message.createdAt)
        ? message.createdAt
        : Date.now();
    markJobCancelled(stamp)
      .then(async () => {
        await chrome.storage.session.remove([STORAGE_PENDING_JOB_KEY]);
        sendResponse({ ok: true, cancelledAt: cancelledJobAtMem });
      })
      .catch((error) =>
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    return true;
  }

  if (message?.type === MESSAGE_SELECTION_CHANGED) {
    const tabId = sender.tab?.id;
    const selectionText =
      typeof message.selectionText === 'string' ? message.selectionText.trim() : '';
    const pageUrl = typeof message.pageUrl === 'string' ? message.pageUrl : '';

    isActiveTab(tabId)
      .then(async (active) => {
        if (!active) {
          sendResponse({ ok: true, ignored: true });
          return;
        }
        await writeLiveSelection({ text: selectionText, url: pageUrl, tabId });
        sendResponse({ ok: true });
      })
      .catch((error) =>
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    return true;
  }

  if (message?.type === 'RUN_ACTION') {
    const actionId = String(message.actionId || '');
    const selectionText = typeof message.selectionText === 'string' ? message.selectionText : '';

    chrome.tabs
      .query({ active: true, currentWindow: true })
      .then(async (tabs) => {
        const tab = tabs[0];
        if (!tab?.id) {
          throw new Error('Active tab is required');
        }
        await handleActionClick(actionId, selectionText, tab);
        sendResponse({ ok: true });
      })
      .catch((error) =>
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    return true;
  }

  if (message?.type === MESSAGE_TRANSCRIBE_AUDIO) {
    transcribeAudioMessage(message)
      .then((text) => sendResponse({ ok: true, text }))
      .catch((error) =>
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    return true;
  }

  if (message?.type === MESSAGE_INJECT_WA_AUDIO_HOOK) {
    const tabId = sender.tab?.id;
    if (!tabId) {
      sendResponse({ ok: false, error: 'Missing tab' });
      return false;
    }
    chrome.scripting
      .executeScript({
        target: { tabId },
        world: 'MAIN',
        files: ['wa_audio_hook.js'],
      })
      .then(() => sendResponse({ ok: true }))
      .catch((error) =>
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    return true;
  }

  if (message?.type === 'REBUILD_MENUS') {
    ensureContextMenus()
      .then(() => sendResponse({ ok: true }))
      .catch((error) =>
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    return true;
  }

  return false;
});
