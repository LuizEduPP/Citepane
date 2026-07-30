importScripts('defaults.js', 'search.js');

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

async function writePendingJob(job) {
  await chrome.storage.session.set({ [STORAGE_PENDING_JOB_KEY]: job });
  try {
    await chrome.runtime.sendMessage({ type: MESSAGE_JOB_UPDATED, job });
  } catch {
    // Side panel may be closed.
  }
}

async function ensureContextMenus() {
  await chrome.contextMenus.removeAll();

  // Only on web pages — never inside the Citepane side panel (chrome-extension://).
  const documentUrlPatterns = ['http://*/*', 'https://*/*'];
  const base = {
    contexts: ['selection'],
    documentUrlPatterns,
  };

  chrome.contextMenus.create({
    id: EXT_PARENT_MENU_ID,
    title: t('menuRoot'),
    ...base,
  });

  for (const group of ACTION_MENU_GROUPS) {
    chrome.contextMenus.create({
      id: group.id,
      parentId: EXT_PARENT_MENU_ID,
      title: t(group.titleKey),
      ...base,
    });

    if (group.kind === 'translate') {
      for (const language of LANGUAGES) {
        chrome.contextMenus.create({
          id: `${TRANSLATE_ACTION_PREFIX}${language.code}`,
          parentId: group.id,
          title: language.label,
          ...base,
        });
      }
      continue;
    }

    for (const actionId of group.actionIds) {
      const action = ACTION_BY_ID[actionId];
      if (!action) {
        throw new Error(`Unknown action in menu group ${group.id}: ${actionId}`);
      }
      chrome.contextMenus.create({
        id: action.id,
        parentId: group.id,
        title: t(action.titleKey),
        ...base,
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
      func: () => {
        const meta =
          document.querySelector('meta[name="description"]') ||
          document.querySelector('meta[property="og:description"]');
        const selection = window.getSelection()?.toString() || '';
        return {
          url: location.href,
          title: document.title || '',
          description: meta?.getAttribute('content')?.trim() || '',
          excerpt: selection.replace(/\s+/g, ' ').trim().slice(0, 2000),
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

async function ensureHostPermission(baseUrl) {
  if (isLocalApiHost(baseUrl)) {
    return;
  }

  const origin = `${new URL(normalizeBaseUrl(baseUrl)).origin}/*`;
  const already = await chrome.permissions.contains({ origins: [origin] });
  if (already) {
    return;
  }

  throw new Error(
    `Host permission required for ${origin}. Open Settings, then Save or Refresh models to grant access.`,
  );
}

async function requestHostPermission(baseUrl) {
  if (isLocalApiHost(baseUrl)) {
    return;
  }

  const origin = `${new URL(normalizeBaseUrl(baseUrl)).origin}/*`;
  const already = await chrome.permissions.contains({ origins: [origin] });
  if (already) {
    return;
  }

  const granted = await chrome.permissions.request({ origins: [origin] });
  if (!granted) {
    throw new Error(`Host permission denied for ${origin}`);
  }
}

async function openSidePanel(tabId) {
  if (typeof chrome.sidePanel?.open !== 'function') {
    throw new Error('sidePanel.open is unavailable in this browser');
  }

  await chrome.sidePanel.open({ tabId });
}

async function handleActionClick(actionId, selectionText, tab) {
  if (!tab?.id) {
    throw new Error('Active tab is required');
  }

  const trimmed = typeof selectionText === 'string' ? selectionText.trim() : '';
  if (!trimmed) {
    throw new Error(t('errorNoSelection'));
  }

  const action = resolveAction(actionId);
  const settings = await readSettings();
  const createdAt = Date.now();

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
    const pageContext = await requestPageContext(tab.id, tab.url);
    let evidence = [];

    if (action.needsGrounding) {
      let searchError = null;
      try {
        evidence = await searchDuckDuckGo(trimmed);
      } catch (error) {
        searchError = error;
        evidence = [];
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

    await writePendingJob({
      ...loadingJob,
      pageContext,
      evidence,
      status: 'ready',
      error: null,
    });
  } catch (error) {
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
  const actionId = info.menuItemId;
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

  handleActionClick(String(actionId), info.selectionText || '', tab).catch(async (error) => {
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

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'ENSURE_HOST_PERMISSION') {
    ensureHostPermission(message.baseUrl)
      .then(() => sendResponse({ ok: true }))
      .catch((error) =>
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    return true;
  }

  if (message?.type === 'REQUEST_HOST_PERMISSION') {
    requestHostPermission(message.baseUrl)
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
