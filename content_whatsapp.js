/**
 * WhatsApp Web voice-message transcription UI.
 * Loaded only on https://web.whatsapp.com/*
 *
 * Newer WA layouts render PTT as play button + canvas (no <audio> in the DOM).
 * We detect those bubbles and capture audio via MAIN-world createObjectURL hook
 * after briefly triggering play.
 */

const CITEPANE_VOICE_ATTR = 'data-citepane-voice';
const CITEPANE_BTN_CLASS = 'citepane-wa-transcribe';
const CITEPANE_PANEL_CLASS = 'citepane-wa-transcript';
const WA_AUDIO_MSG_SOURCE = 'citepane-wa-audio';
const AUDIO_CAPTURE_TIMEOUT_MS = 12000;

function waMessage(key) {
  try {
    return globalThis.chrome?.i18n?.getMessage?.(key) || key;
  } catch {
    return key;
  }
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
  if (!(root instanceof Element)) {
    return false;
  }
  return Boolean(
    root.querySelector('[data-testid="ptt-status"]') ||
      root.querySelector('[data-icon="ptt-status"]') ||
      root.querySelector('audio') ||
      root.querySelector('[aria-label="Mensagem de voz"]') ||
      root.querySelector('[aria-label="Voice message"]') ||
      root.querySelector('[aria-label="Mensaje de voz"]') ||
      root.querySelector('button[aria-label*="mensagem de voz" i]') ||
      root.querySelector('button[aria-label*="voice message" i]') ||
      root.querySelector('button[aria-label*="mensaje de voz" i]') ||
      root.querySelector('button[aria-label*="message vocal" i]') ||
      root.querySelector('button[aria-label*="Sprachnachricht" i]'),
  );
}

function findPlayButton(root) {
  return (
    root.querySelector('button[aria-label*="mensagem de voz" i]') ||
    root.querySelector('button[aria-label*="voice message" i]') ||
    root.querySelector('button[aria-label*="mensaje de voz" i]') ||
    root.querySelector('button[aria-label*="message vocal" i]') ||
    root.querySelector('button[aria-label*="Sprachnachricht" i]') ||
    root.querySelector('[data-testid="audio-play"]')
  );
}

function findBlobAudio(root) {
  const scopes = [root, document];
  for (const scope of scopes) {
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

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  const chunk = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
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
  copyBtn.textContent = waMessage('uiTranscriptCopy');
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
      copyBtn.textContent = waMessage('uiCopied');
      setTimeout(() => {
        copyBtn.textContent = waMessage('uiTranscriptCopy');
      }, 1200);
    } catch {
      // ignore
    }
  });

  tools.append(copyBtn);
  panel.append(body, tools);

  const addon = root.querySelector('[data-testid="addon-bubble-container"]');
  if (addon) {
    addon.append(panel);
  } else {
    root.append(panel);
  }
  return panel;
}

function setPanelState(panel, { text = '', error = '', loading = false } = {}) {
  const body = panel.querySelector('.citepane-wa-transcript-text');
  const copyBtn = panel.querySelector('.citepane-wa-copy');
  panel.hidden = false;
  panel.classList.toggle('is-error', Boolean(error));
  panel.classList.toggle('is-loading', loading);

  if (loading) {
    body.textContent = waMessage('uiTranscribing');
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

function waitForHookedAudio(signal) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(waMessage('uiTranscriptError')));
    }, AUDIO_CAPTURE_TIMEOUT_MS);

    function cleanup() {
      clearTimeout(timer);
      window.removeEventListener('message', onMessage);
      signal?.removeEventListener('abort', onAbort);
    }

    function onAbort() {
      cleanup();
      reject(new DOMException('Aborted', 'AbortError'));
    }

    function onMessage(event) {
      if (event.source !== window) {
        return;
      }
      const data = event.data;
      if (!data || data.source !== WA_AUDIO_MSG_SOURCE || !data.buffer) {
        return;
      }
      cleanup();
      resolve({
        buffer: data.buffer,
        mimeType: data.mimeType || 'audio/ogg',
      });
    }

    if (signal?.aborted) {
      onAbort();
      return;
    }
    signal?.addEventListener('abort', onAbort, { once: true });
    window.addEventListener('message', onMessage);
  });
}

function waitForDomBlobAudio(root, signal) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const poll = setInterval(async () => {
      if (signal?.aborted) {
        clearInterval(poll);
        reject(new DOMException('Aborted', 'AbortError'));
        return;
      }
      const audio = findBlobAudio(root);
      if (audio) {
        clearInterval(poll);
        try {
          const src = audio.currentSrc || audio.src;
          const response = await fetch(src);
          const buffer = await response.arrayBuffer();
          try {
            audio.pause();
          } catch {
            // ignore
          }
          resolve({
            buffer,
            mimeType:
              audio.getAttribute('type') ||
              response.headers.get('content-type') ||
              'audio/ogg',
          });
        } catch (error) {
          reject(error);
        }
        return;
      }
      if (Date.now() - started > AUDIO_CAPTURE_TIMEOUT_MS) {
        clearInterval(poll);
        reject(new Error(waMessage('uiTranscriptError')));
      }
    }, 200);

    signal?.addEventListener(
      'abort',
      () => {
        clearInterval(poll);
        reject(new DOMException('Aborted', 'AbortError'));
      },
      { once: true },
    );
  });
}

async function resolveAudioPayload(root) {
  const existing = findBlobAudio(root);
  if (existing) {
    const src = existing.currentSrc || existing.src;
    const response = await fetch(src);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const buffer = await response.arrayBuffer();
    const mimeType =
      existing.getAttribute('type') ||
      response.headers.get('content-type') ||
      'audio/ogg; codecs=opus';
    return { buffer, mimeType };
  }

  const playBtn = findPlayButton(root);
  if (!playBtn) {
    throw new Error(waMessage('uiTranscriptError'));
  }

  const ac = new AbortController();
  playBtn.click();

  try {
    const result = await Promise.any([
      waitForHookedAudio(ac.signal),
      waitForDomBlobAudio(root, ac.signal),
    ]);
    ac.abort();
    return result;
  } catch (error) {
    if (error instanceof AggregateError) {
      throw new Error(waMessage('uiTranscriptError'));
    }
    throw error;
  } finally {
    const audio = findBlobAudio(root);
    try {
      audio?.pause();
    } catch {
      // ignore
    }
  }
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

    const result = await runtimeSendMessage({
      type: MESSAGE_TRANSCRIBE_AUDIO,
      audioBase64: arrayBufferToBase64(buffer),
      mimeType,
      fileName: `whatsapp-voice.${ext}`,
    });

    if (!result) {
      throw new Error(waMessage('uiTranscriptError'));
    }
    if (!result.ok) {
      throw new Error(result.error || waMessage('uiTranscriptError'));
    }

    setPanelState(panel, { text: result.text });
  } catch (error) {
    setPanelState(panel, {
      error: error instanceof Error ? error.message : waMessage('uiTranscriptError'),
    });
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
  if (root.getAttribute(CITEPANE_VOICE_ATTR) === '1') {
    return;
  }
  if (root.querySelector(`.${CITEPANE_BTN_CLASS}`)) {
    root.setAttribute(CITEPANE_VOICE_ATTR, '1');
    return;
  }

  root.setAttribute(CITEPANE_VOICE_ATTR, '1');

  const button = document.createElement('button');
  button.type = 'button';
  button.className = CITEPANE_BTN_CLASS;
  button.textContent = waMessage('uiTranscribe');
  button.title = waMessage('uiTranscribe');

  const panel = ensureTranscriptPanel(root);

  button.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    transcribeVoiceRoot(root, panel, button);
  });

  placeTranscribeButton(root, button);
}

function enhanceVoiceAudio(audio) {
  if (!(audio instanceof HTMLAudioElement)) {
    return;
  }
  const root = findVoiceRoot(audio);
  if (root) {
    enhanceVoiceRoot(root);
  }
}

function scanVoiceMessages(root = document) {
  if (!isExtensionContextValid()) {
    return;
  }
  root.querySelectorAll?.('[data-testid="msg-container"]').forEach((node) => {
    enhanceVoiceRoot(node);
  });
  root.querySelectorAll?.('audio').forEach((audio) => {
    enhanceVoiceAudio(audio);
  });
}

async function ensureAudioHook() {
  if (!isExtensionContextValid()) {
    return;
  }
  // Prefer MAIN-world injection (bypasses page CSP). Fall back to WAR script tag.
  const injected = await runtimeSendMessage({ type: MESSAGE_INJECT_WA_AUDIO_HOOK });
  if (injected?.ok) {
    return;
  }
  if (document.documentElement.dataset.citepaneWaHook === '1') {
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
        if (!(node instanceof Element)) {
          continue;
        }
        if (node.matches?.('[data-testid="msg-container"]')) {
          enhanceVoiceRoot(node);
        }
        node.querySelectorAll?.('[data-testid="msg-container"]').forEach((el) => {
          enhanceVoiceRoot(el);
        });
        if (node.matches?.('audio')) {
          enhanceVoiceAudio(node);
        }
        node.querySelectorAll?.('audio').forEach((audio) => enhanceVoiceAudio(audio));
      }
      if (mutation.type === 'attributes' && mutation.target instanceof HTMLAudioElement) {
        enhanceVoiceAudio(mutation.target);
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
