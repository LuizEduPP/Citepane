/**
 * WhatsApp Web voice-message transcription UI.
 * Loaded only on https://web.whatsapp.com/* (after defaults.js + content.js).
 *
 * Newer WA layouts render PTT as play + canvas (often no <audio> in the DOM).
 * Capture: MAIN-world createObjectURL hook and/or blob: <audio> after play.
 */

const CITEPANE_VOICE_ATTR = 'data-citepane-voice';
const CITEPANE_BTN_CLASS = 'citepane-wa-transcribe';
const CITEPANE_PANEL_CLASS = 'citepane-wa-transcript';
const CITEPANE_FOOTER_CLASS = 'citepane-wa-footer';
const AUDIO_CAPTURE_TIMEOUT_MS = 12000;

const WA_VOICE_MARKERS = [
  '[data-testid="ptt-status"]',
  '[data-icon="ptt-status"]',
  'audio',
  '[aria-label="Mensagem de voz"]',
  '[aria-label="Voice message"]',
  '[aria-label="Mensaje de voz"]',
];

const WA_PLAY_SELECTORS = [
  'button[aria-label*="mensagem de voz" i]',
  'button[aria-label*="voice message" i]',
  'button[aria-label*="mensaje de voz" i]',
  'button[aria-label*="message vocal" i]',
  'button[aria-label*="Sprachnachricht" i]',
  '[data-testid="audio-play"]',
];

function queryFirst(root, selectors) {
  for (const selector of selectors) {
    const node = root.querySelector(selector);
    if (node) {
      return node;
    }
  }
  return null;
}

function findVoiceRoot(node) {
  return (
    node.closest?.('[data-testid="msg-container"]') ||
    node.closest?.('[data-testid="audio-player"]') ||
    node.closest?.('[data-testid="ptt"]') ||
    node.closest?.('div[role="row"]') ||
    node.parentElement
  );
}

function isVoiceMessageRoot(root) {
  return root instanceof Element && Boolean(queryFirst(root, WA_VOICE_MARKERS.concat(WA_PLAY_SELECTORS)));
}

function findPlayButton(root) {
  return queryFirst(root, WA_PLAY_SELECTORS);
}

function findBlobAudio(root) {
  for (const scope of [root, document]) {
    if (!scope?.querySelectorAll) {
      continue;
    }
    for (const audio of scope.querySelectorAll('audio')) {
      const src = audio.currentSrc || audio.src || '';
      if (src.startsWith('blob:')) {
        return audio;
      }
    }
  }
  return null;
}

async function readAudioElementPayload(audio) {
  const src = audio.currentSrc || audio.src;
  const response = await fetch(src);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  const buffer = await response.arrayBuffer();
  try {
    audio.pause();
  } catch {
    // ignore
  }
  return {
    buffer,
    mimeType:
      audio.getAttribute('type') || response.headers.get('content-type') || 'audio/ogg',
  };
}

/** Message list row that owns msg-container + addon-bubble-container. */
function findMessageRow(msg) {
  return (
    msg.closest?.('[data-testid^="conv-msg-"]') ||
    msg.closest?.('[role="row"]') ||
    msg.closest?.('[data-id]') ||
    msg.parentElement
  );
}

/**
 * WhatsApp mounts reactions/addons in [data-testid="addon-bubble-container"]
 * under the message row — that is the correct host for our UI.
 */
function findAddonHost(msg) {
  const row = findMessageRow(msg);
  return (
    row?.querySelector?.('[data-testid="addon-bubble-container"]') ||
    msg.parentElement?.querySelector?.('[data-testid="addon-bubble-container"]') ||
    null
  );
}

function isOutgoingMessage(msg) {
  return Boolean(
    msg.querySelector('[data-testid="tail-out"], [data-icon="tail-out"]') ||
      msg.closest('.message-out') ||
      msg.querySelector('[aria-label="Você:"], [aria-label="You:"]'),
  );
}

function collectCitepaneFooters(msg) {
  const row = findMessageRow(msg);
  const host = findAddonHost(msg);
  const seen = new Set();
  const list = [];
  for (const scope of [host, row, msg].filter(Boolean)) {
    scope.querySelectorAll(`.${CITEPANE_FOOTER_CLASS}`).forEach((el) => {
      if (!seen.has(el)) {
        seen.add(el);
        list.push(el);
      }
    });
  }
  return list;
}

function pickKeepFooter(footers) {
  return (
    footers.find((f) => f.querySelector(`.${CITEPANE_BTN_CLASS}`) && f.querySelector(`.${CITEPANE_PANEL_CLASS}`)) ||
    footers.find((f) => f.querySelector(`.${CITEPANE_BTN_CLASS}`)) ||
    footers.find((f) => f.querySelector(`.${CITEPANE_PANEL_CLASS}`)) ||
    footers[0] ||
    null
  );
}

/** One footer per voice message; merge button+transcript; drop empty clones. */
function ensureCitepaneFooter(root) {
  const msg = root.closest?.('[data-testid="msg-container"]') || root;
  const host = findAddonHost(msg) || msg;
  const footers = collectCitepaneFooters(msg);
  let footer = pickKeepFooter(footers);

  for (const extra of footers) {
    if (extra === footer) {
      continue;
    }
    if (footer) {
      const btn = extra.querySelector(`.${CITEPANE_BTN_CLASS}`);
      const panel = extra.querySelector(`.${CITEPANE_PANEL_CLASS}`);
      if (btn && !footer.querySelector(`.${CITEPANE_BTN_CLASS}`)) {
        footer.prepend(btn);
      } else if (btn) {
        btn.remove();
      }
      if (panel && !footer.querySelector(`.${CITEPANE_PANEL_CLASS}`)) {
        footer.append(panel);
      } else if (panel) {
        panel.remove();
      }
    }
    extra.remove();
  }

  if (!footer) {
    footer = document.createElement('div');
    footer.className = CITEPANE_FOOTER_CLASS;
    host.append(footer);
  } else if (footer.parentElement !== host) {
    host.append(footer);
  }

  footer.dataset.side = isOutgoingMessage(msg) ? 'out' : 'in';
  syncFooterBubbleWidth(footer, msg);
  return footer;
}

function findCitepaneInRow(root, className) {
  const msg = root.closest?.('[data-testid="msg-container"]') || root;
  const row = findMessageRow(msg);
  return (
    row?.querySelector(`.${className}`) ||
    msg.querySelector(`.${className}`) ||
    null
  );
}

function relocateCitepaneUi(root) {
  const footer = ensureCitepaneFooter(root);
  const button = findCitepaneInRow(root, CITEPANE_BTN_CLASS);
  const panel = findCitepaneInRow(root, CITEPANE_PANEL_CLASS);
  if (button && button.parentElement !== footer) {
    footer.prepend(button);
  }
  if (panel && panel.parentElement !== footer) {
    footer.append(panel);
  }
  return { footer, button, panel };
}

function ensureTranscriptPanel(root) {
  let panel = findCitepaneInRow(root, CITEPANE_PANEL_CLASS);
  if (panel) {
    relocateCitepaneUi(root);
    return panel;
  }

  panel = document.createElement('div');
  panel.className = CITEPANE_PANEL_CLASS;
  panel.hidden = true;

  const body = document.createElement('p');
  body.className = 'citepane-wa-transcript-text';

  const tools = document.createElement('div');
  tools.className = 'citepane-wa-transcript-tools';

  const copyBtn = document.createElement('button');
  copyBtn.type = 'button';
  copyBtn.className = 'citepane-wa-copy';
  copyBtn.textContent = extMessage('uiTranscriptCopy');
  copyBtn.hidden = true;
  copyBtn.addEventListener('click', async (event) => {
    event.preventDefault();
    event.stopPropagation();
    const text = body.textContent || '';
    if (!text) {
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      copyBtn.textContent = extMessage('uiCopied');
      setTimeout(() => {
        copyBtn.textContent = extMessage('uiTranscriptCopy');
      }, 1200);
    } catch {
      // ignore
    }
  });

  tools.append(copyBtn);
  panel.append(body, tools);
  ensureCitepaneFooter(root).append(panel);
  return panel;
}

function syncFooterBubbleWidth(footer, msg) {
  if (!(footer instanceof HTMLElement) || !(msg instanceof Element)) {
    return;
  }
  const meta = msg.querySelector('[data-testid="msg-meta"]');
  let bubble = meta?.parentElement || null;
  while (bubble && bubble.parentElement !== msg) {
    bubble = bubble.parentElement;
  }
  if (!bubble) {
    const play = findPlayButton(msg);
    bubble = play?.parentElement || null;
    while (bubble && bubble.parentElement !== msg) {
      bubble = bubble.parentElement;
    }
  }
  const width = Math.round((bubble || msg).getBoundingClientRect?.().width || 0);
  if (width > 80) {
    footer.style.setProperty('--citepane-wa-bubble-width', `${width}px`);
  }
}

function updateFooterChrome(footer, panel) {
  if (!(footer instanceof HTMLElement)) {
    return;
  }
  const hasText =
    panel instanceof HTMLElement &&
    !panel.hidden &&
    Boolean(panel.querySelector('.citepane-wa-transcript-text')?.textContent?.trim());
  footer.classList.toggle('has-transcript', hasText && !panel.classList.contains('is-error'));
}

function setPanelState(panel, { text = '', error = '', loading = false, streaming = false } = {}) {
  const body = panel.querySelector('.citepane-wa-transcript-text');
  const copyBtn = panel.querySelector('.citepane-wa-copy');
  const footer = panel.closest(`.${CITEPANE_FOOTER_CLASS}`);
  const show = Boolean(text || error || loading || streaming);
  panel.hidden = !show;
  panel.classList.toggle('is-error', Boolean(error));
  panel.classList.toggle('is-loading', loading && !streaming && !text);
  panel.classList.toggle('is-streaming', streaming);

  if (loading && !text && !error) {
    body.textContent = extMessage('uiTranscribing');
    copyBtn.hidden = true;
    updateFooterChrome(footer, panel);
    return;
  }
  if (error) {
    body.textContent = error;
    copyBtn.hidden = true;
    updateFooterChrome(footer, panel);
    return;
  }
  body.textContent = text;
  copyBtn.hidden = !text || streaming;
  updateFooterChrome(footer, panel);
}

function waitWithTimeout(signal, run) {
  return new Promise((resolve, reject) => {
    let disposed = false;
    let disposeExtra = () => {};

    function cleanup() {
      if (disposed) {
        return;
      }
      disposed = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      disposeExtra();
    }

    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(extMessage('uiTranscriptError')));
    }, AUDIO_CAPTURE_TIMEOUT_MS);

    function onAbort() {
      cleanup();
      reject(new DOMException('Aborted', 'AbortError'));
    }

    if (signal?.aborted) {
      onAbort();
      return;
    }
    signal?.addEventListener('abort', onAbort, { once: true });

    disposeExtra =
      run({
        resolve(value) {
          cleanup();
          resolve(value);
        },
        reject(error) {
          cleanup();
          reject(error);
        },
      }) || (() => {});
  });
}

function waitForHookedAudio(signal) {
  return waitWithTimeout(signal, ({ resolve }) => {
    function onMessage(event) {
      if (event.source !== window) {
        return;
      }
      const data = event.data;
      if (!data || data.source !== WA_AUDIO_HOOK_SOURCE || !data.buffer) {
        return;
      }
      resolve({
        buffer: data.buffer,
        mimeType: data.mimeType || 'audio/ogg',
      });
    }
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  });
}

function waitForDomBlobAudio(root, signal) {
  return waitWithTimeout(signal, ({ resolve, reject }) => {
    const poll = setInterval(async () => {
      const audio = findBlobAudio(root);
      if (!audio) {
        return;
      }
      clearInterval(poll);
      try {
        resolve(await readAudioElementPayload(audio));
      } catch (error) {
        reject(error);
      }
    }, 200);
    return () => clearInterval(poll);
  });
}

async function resolveAudioPayload(root) {
  const existing = findBlobAudio(root);
  if (existing) {
    return readAudioElementPayload(existing);
  }

  const playBtn = findPlayButton(root);
  if (!playBtn) {
    throw new Error(extMessage('uiTranscriptError'));
  }

  const ac = new AbortController();
  playBtn.click();

  try {
    return await Promise.any([
      waitForHookedAudio(ac.signal),
      waitForDomBlobAudio(root, ac.signal),
    ]);
  } catch (error) {
    if (error instanceof AggregateError) {
      throw new Error(extMessage('uiTranscriptError'));
    }
    throw error;
  } finally {
    ac.abort();
    try {
      findBlobAudio(root)?.pause();
    } catch {
      // ignore
    }
  }
}

async function requestLocalWhisperConsent() {
  const ok = window.confirm(extMessage('uiWhisperDownloadConfirm'));
  if (!ok) {
    return false;
  }
  const accepted = await runtimeSendMessage({ type: MESSAGE_ACCEPT_LOCAL_WHISPER });
  if (!accepted?.ok) {
    throw new Error(accepted?.error || extMessage('uiWhisperDownloadDenied'));
  }
  return true;
}

async function sendTranscribeRequest(panel, buffer, mimeType, fileName, cacheKey = '', requestId = '') {
  const payload = {
    type: MESSAGE_TRANSCRIBE_AUDIO,
    audioBase64: arrayBufferToBase64(buffer),
    mimeType,
    fileName,
    cacheKey,
    requestId,
  };
  let result = await runtimeSendMessage(payload);
  if (result?.needsConsent) {
    const accepted = await requestLocalWhisperConsent();
    if (!accepted) {
      throw new Error(extMessage('uiWhisperDownloadDenied'));
    }
    setPanelState(panel, { loading: true });
    result = await runtimeSendMessage(payload);
  }
  return result;
}

function findMessageCacheKey(root) {
  const withId =
    root.closest?.('[data-id]') ||
    root.querySelector?.('[data-id]') ||
    root.closest?.('[data-testid^="conv-msg-"]') ||
    root.querySelector?.('[data-testid^="conv-msg-"]');
  if (!(withId instanceof Element)) {
    return '';
  }
  const dataId = withId.getAttribute('data-id');
  if (dataId) {
    return dataId;
  }
  const testId = withId.getAttribute('data-testid') || '';
  if (testId.startsWith('conv-msg-')) {
    return testId.slice('conv-msg-'.length);
  }
  return '';
}

async function fetchCachedTranscriptText(cacheKey) {
  if (!cacheKey) {
    return '';
  }
  const result = await runtimeSendMessage({
    type: MESSAGE_GET_WA_TRANSCRIPT,
    cacheKey,
  });
  return typeof result?.text === 'string' ? result.text.trim() : '';
}

async function restoreCachedTranscript(root, panel) {
  const text = await fetchCachedTranscriptText(findMessageCacheKey(root));
  if (!text) {
    return false;
  }
  setPanelState(panel, { text });
  return true;
}

/** Active STT stream request → panel (for live partials). */
const activeSttStreams = new Map();

function newSttRequestId() {
  if (globalThis.crypto?.randomUUID) {
    return crypto.randomUUID();
  }
  return `stt-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

async function transcribeVoiceRoot(root, panel, button) {
  button.disabled = true;
  setPanelState(panel, { loading: true });

  const requestId = newSttRequestId();
  activeSttStreams.set(requestId, panel);

  try {
    const cacheKey = findMessageCacheKey(root);
    const cached = await fetchCachedTranscriptText(cacheKey);
    if (cached) {
      setPanelState(panel, { text: cached });
      return;
    }

    const { buffer, mimeType: rawMime } = await resolveAudioPayload(root);
    if (!buffer?.byteLength) {
      throw new Error('Empty audio');
    }

    const mimeType = (rawMime || 'audio/ogg').split(';')[0].trim() || 'audio/ogg';
    const ext = mimeType.includes('mpeg') || mimeType.includes('mp3') ? 'mp3' : 'ogg';

    const result = await sendTranscribeRequest(
      panel,
      buffer,
      mimeType,
      `whatsapp-voice.${ext}`,
      cacheKey,
      requestId,
    );

    if (!result?.ok) {
      throw new Error(result?.error || extMessage('uiTranscriptError'));
    }
    setPanelState(panel, { text: result.text });
  } catch (error) {
    setPanelState(panel, { error: formatCaught(error) || extMessage('uiTranscriptError') });
  } finally {
    activeSttStreams.delete(requestId);
    button.disabled = false;
  }
}

function enhanceVoiceRoot(root) {
  if (!(root instanceof Element) || !isVoiceMessageRoot(root)) {
    return;
  }

  const existingButton = findCitepaneInRow(root, CITEPANE_BTN_CLASS);
  // Already mounted (or leftover from older injectors): merge into one footer, drop clones.
  if (root.getAttribute(CITEPANE_VOICE_ATTR) === '1' || existingButton) {
    relocateCitepaneUi(root);
    root.setAttribute(CITEPANE_VOICE_ATTR, '1');
    return;
  }

  root.setAttribute(CITEPANE_VOICE_ATTR, '1');

  const label = extMessage('uiTranscribe');
  const button = document.createElement('button');
  button.type = 'button';
  button.className = CITEPANE_BTN_CLASS;
  button.textContent = label;
  button.title = label;

  const panel = ensureTranscriptPanel(root);
  button.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    transcribeVoiceRoot(root, panel, button);
  });
  const { footer } = relocateCitepaneUi(root);
  if (button.parentElement !== footer) {
    footer.prepend(button);
  }
  restoreCachedTranscript(root, panel).catch(() => {});
}

function scanVoiceMessages(root = document) {
  if (!isExtensionContextValid()) {
    return;
  }
  if (root.matches?.('[data-testid="msg-container"]')) {
    enhanceVoiceRoot(root);
  }
  root.querySelectorAll?.('[data-testid="msg-container"]').forEach(enhanceVoiceRoot);

  const audios = [];
  if (root instanceof HTMLAudioElement) {
    audios.push(root);
  }
  root.querySelectorAll?.('audio').forEach((audio) => audios.push(audio));
  for (const audio of audios) {
    const voiceRoot = findVoiceRoot(audio);
    if (voiceRoot) {
      enhanceVoiceRoot(voiceRoot);
    }
  }
}

function enhanceAddedNode(node) {
  if (node instanceof Element) {
    scanVoiceMessages(node);
  }
}

async function ensureAudioHook() {
  if (!isExtensionContextValid()) {
    return;
  }
  const injected = await runtimeSendMessage({ type: MESSAGE_INJECT_WA_AUDIO_HOOK });
  if (injected?.ok || document.documentElement.dataset.citepaneWaHook === '1') {
    return;
  }
  let hookUrl = '';
  try {
    hookUrl = globalThis.chrome?.runtime?.getURL?.('wa_audio_hook.js') || '';
  } catch {
    return;
  }
  if (!hookUrl) {
    return;
  }
  const script = document.createElement('script');
  script.src = hookUrl;
  script.async = false;
  script.onload = () => script.remove();
  (document.head || document.documentElement).append(script);
  document.documentElement.dataset.citepaneWaHook = '1';
}

function startWhatsAppTranscription() {
  if (!isExtensionContextValid()) {
    return;
  }

  try {
    chrome.runtime.onMessage.addListener((message) => {
      if (message?.type !== MESSAGE_TRANSCRIBE_PARTIAL) {
        return;
      }
      const requestId = typeof message.requestId === 'string' ? message.requestId : '';
      const text = typeof message.text === 'string' ? message.text.trim() : '';
      const panel = requestId ? activeSttStreams.get(requestId) : null;
      if (!panel || !text) {
        return;
      }
      setPanelState(panel, { text, streaming: true });
    });
  } catch {
    // Extension context may already be invalid.
  }

  ensureAudioHook().catch(() => {});
  scanVoiceMessages();

  const observer = new MutationObserver((mutations) => {
    if (!isExtensionContextValid()) {
      observer.disconnect();
      return;
    }
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        enhanceAddedNode(node);
      }
      if (mutation.type === 'attributes' && mutation.target instanceof HTMLAudioElement) {
        const voiceRoot = findVoiceRoot(mutation.target);
        if (voiceRoot) {
          enhanceVoiceRoot(voiceRoot);
        }
      }
    }
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['src'],
  });

  const rescanTimer = setInterval(() => {
    if (!isExtensionContextValid()) {
      clearInterval(rescanTimer);
      observer.disconnect();
      return;
    }
    scanVoiceMessages();
  }, 2500);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', startWhatsAppTranscription, { once: true });
} else {
  startWhatsAppTranscription();
}
