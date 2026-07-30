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

function collectPageContext() {
  return {
    url: location.href,
    title: document.title || '',
    description: readMetaDescription().slice(0, PAGE_CONTEXT_MAX_CHARS),
    excerpt: readSelectionExcerpt(),
  };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || message.type !== MESSAGE_GET_PAGE_CONTEXT) {
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
