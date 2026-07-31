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

function placeInMessage(root, node) {
  const addon = root.querySelector('[data-testid="addon-bubble-container"]');
  if (addon) {
    addon.append(node);
    return;
  }
  root.append(node);
}

function ensureTranscriptPanel(root) {
  let panel = root.querySelector(`.${CITEPANE_PANEL_CLASS}`);
  if (panel) {
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
  placeInMessage(root, panel);
  return panel;
}

function setPanelState(panel, { text = '', error = '', loading = false } = {}) {
  const body = panel.querySelector('.citepane-wa-transcript-text');
  const copyBtn = panel.querySelector('.citepane-wa-copy');
  panel.hidden = false;
  panel.classList.toggle('is-error', Boolean(error));
  panel.classList.toggle('is-loading', loading);

  if (loading) {
    body.textContent = extMessage('uiTranscribing');
    copyBtn.hidden = true;
    return;
  }
  if (error) {
    body.textContent = error;
    copyBtn.hidden = true;
    return;
  }
  body.textContent = text;
  copyBtn.hidden = !text;
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

async function sendTranscribeRequest(panel, buffer, mimeType, fileName) {
  const payload = {
    type: MESSAGE_TRANSCRIBE_AUDIO,
    audioBase64: arrayBufferToBase64(buffer),
    mimeType,
    fileName,
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

async function transcribeVoiceRoot(root, panel, button) {
  button.disabled = true;
  setPanelState(panel, { loading: true });

  try {
    const { buffer, mimeType: rawMime } = await resolveAudioPayload(root);
    if (!buffer?.byteLength) {
      throw new Error('Empty audio');
    }

    const mimeType = (rawMime || 'audio/ogg').split(';')[0].trim() || 'audio/ogg';
    const ext = mimeType.includes('mpeg') || mimeType.includes('mp3') ? 'mp3' : 'ogg';

    const result = await sendTranscribeRequest(panel, buffer, mimeType, `whatsapp-voice.${ext}`);

    if (!result?.ok) {
      throw new Error(result?.error || extMessage('uiTranscriptError'));
    }
    setPanelState(panel, { text: result.text });
  } catch (error) {
    setPanelState(panel, { error: formatCaught(error) || extMessage('uiTranscriptError') });
  } finally {
    button.disabled = false;
  }
}

function placeTranscribeButton(root, button) {
  const addon = root.querySelector('[data-testid="addon-bubble-container"]');
  if (addon) {
    addon.prepend(button);
    return;
  }
  const playBtn = findPlayButton(root);
  if (playBtn?.parentElement) {
    playBtn.parentElement.append(button);
    return;
  }
  root.append(button);
}

function enhanceVoiceRoot(root) {
  if (!(root instanceof Element) || !isVoiceMessageRoot(root)) {
    return;
  }
  if (root.getAttribute(CITEPANE_VOICE_ATTR) === '1' || root.querySelector(`.${CITEPANE_BTN_CLASS}`)) {
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
  placeTranscribeButton(root, button);
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
