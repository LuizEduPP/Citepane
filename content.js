function readMetaDescription() {
  const node =
    document.querySelector('meta[name="description"]') ||
    document.querySelector('meta[property="og:description"]');
  return node?.getAttribute('content')?.trim() || '';
}

function readSelectionExcerpt() {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) {
    return '';
  }

  const range = selection.getRangeAt(0);
  const container = range.commonAncestorContainer;
  const element =
    container.nodeType === Node.ELEMENT_NODE ? container : container.parentElement;

  if (!element) {
    return selection.toString().trim();
  }

  let block = element;
  while (
    block &&
    block !== document.body &&
    !/^(P|ARTICLE|SECTION|LI|BLOCKQUOTE|TD|DIV|MAIN)$/i.test(block.tagName)
  ) {
    block = block.parentElement;
  }

  const text = (block || element).innerText || selection.toString();
  return text.replace(/\s+/g, ' ').trim().slice(0, PAGE_CONTEXT_MAX_CHARS);
}

function readPageBody() {
  const root =
    document.querySelector('article') ||
    document.querySelector('main') ||
    document.querySelector('[role="main"]') ||
    document.body;
  const text = (root?.innerText || '').replace(/\s+/g, ' ').trim();
  return text.slice(0, PAGE_BODY_MAX_CHARS);
}

function collectPageContext() {
  return {
    url: location.href,
    title: document.title || '',
    description: readMetaDescription().slice(0, PAGE_CONTEXT_MAX_CHARS),
    excerpt: readSelectionExcerpt(),
    body: readPageBody(),
  };
}

function readLiveSelectionText() {
  const text = (window.getSelection()?.toString() || '').replace(/\s+/g, ' ').trim();
  if (!text) {
    return '';
  }
  return text.slice(0, LIVE_SELECTION_MAX_CHARS);
}

let lastPublishedSelection = null;
let selectionPublishTimer = null;

function publishLiveSelection({ force = false } = {}) {
  const selectionText = readLiveSelectionText();
  if (!force && selectionText === lastPublishedSelection) {
    return;
  }
  lastPublishedSelection = selectionText;

  chrome.runtime
    .sendMessage({
      type: MESSAGE_SELECTION_CHANGED,
      selectionText,
      pageUrl: location.href,
    })
    .catch(() => {
      // Side panel / service worker may be asleep.
    });
}

function scheduleLiveSelectionPublish() {
  if (selectionPublishTimer) {
    clearTimeout(selectionPublishTimer);
  }
  selectionPublishTimer = setTimeout(() => publishLiveSelection(), 160);
}

document.addEventListener('selectionchange', scheduleLiveSelectionPublish);
document.addEventListener('mouseup', scheduleLiveSelectionPublish);
document.addEventListener('keyup', scheduleLiveSelectionPublish);

// When this tab becomes visible again (user switched back), sync selection to the panel.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    publishLiveSelection({ force: true });
  }
});

window.addEventListener('focus', () => {
  publishLiveSelection({ force: true });
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message) {
    return false;
  }

  if (message.type === MESSAGE_GET_LIVE_SELECTION) {
    try {
      sendResponse({
        ok: true,
        selectionText: readLiveSelectionText(),
        pageUrl: location.href,
      });
    } catch (error) {
      sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    return false;
  }

  if (message.type !== MESSAGE_GET_PAGE_CONTEXT) {
    return false;
  }

  try {
    sendResponse({ ok: true, pageContext: collectPageContext() });
  } catch (error) {
    sendResponse({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  return false;
});
