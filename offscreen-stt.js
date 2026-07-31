/**
 * Offscreen Whisper (Transformers.js) — runs on-device, no STT API.
 * Loaded only after the user accepts the model download.
 */

import { pipeline, env } from './vendor/transformers/transformers.js';

env.allowLocalModels = false;
env.useBrowserCache = true;
// MV3 forbids remote script-src; WASM assets ship next to the library.
env.backends.onnx.wasm.wasmPaths = chrome.runtime.getURL('vendor/transformers/');
// Avoid blob: workers (blocked by extension CSP).
env.backends.onnx.wasm.numThreads = 1;
env.backends.onnx.wasm.proxy = false;

const MESSAGE_OFFSCREEN_TRANSCRIBE = 'OFFSCREEN_TRANSCRIBE';

let transcriber = null;
let loadedModelId = '';

function base64ToArrayBuffer(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

async function decodeToMono16k(arrayBuffer) {
  const audioCtx = new AudioContext({ sampleRate: 16000 });
  try {
    const decoded = await audioCtx.decodeAudioData(arrayBuffer.slice(0));
    const channels = decoded.numberOfChannels;
    const length = decoded.length;
    if (channels === 1) {
      return decoded.getChannelData(0);
    }
    const mixed = new Float32Array(length);
    for (let c = 0; c < channels; c += 1) {
      const data = decoded.getChannelData(c);
      for (let i = 0; i < length; i += 1) {
        mixed[i] += data[i] / channels;
      }
    }
    return mixed;
  } finally {
    await audioCtx.close();
  }
}

async function getTranscriber(modelId) {
  if (transcriber && loadedModelId === modelId) {
    return transcriber;
  }
  // Extension offscreen pages usually cannot get a WebGPU adapter — use WASM.
  transcriber = await pipeline('automatic-speech-recognition', modelId, {
    device: 'wasm',
    dtype: 'q8',
  });
  loadedModelId = modelId;
  return transcriber;
}

function whisperLanguageHint(code) {
  if (!code || code === 'auto') {
    return null;
  }
  const base = String(code).split('-')[0].toLowerCase();
  const map = {
    en: 'english',
    pt: 'portuguese',
    es: 'spanish',
    fr: 'french',
    de: 'german',
    it: 'italian',
    ja: 'japanese',
    zh: 'chinese',
    ko: 'korean',
    ru: 'russian',
    ar: 'arabic',
  };
  return map[base] || null;
}

async function transcribePayload(message) {
  const modelId =
    typeof message.modelId === 'string' && message.modelId.trim()
      ? message.modelId.trim()
      : 'Xenova/whisper-tiny';
  const audioBase64 = typeof message.audioBase64 === 'string' ? message.audioBase64 : '';
  if (!audioBase64) {
    throw new Error('Missing audio payload.');
  }

  const samples = await decodeToMono16k(base64ToArrayBuffer(audioBase64));
  const asr = await getTranscriber(modelId);
  const language = whisperLanguageHint(message.language);
  const options = { task: 'transcribe', return_timestamps: false };
  if (language) {
    options.language = language;
  }

  const output = await asr(samples, options);
  const text = typeof output?.text === 'string' ? output.text.trim() : '';
  if (!text) {
    throw new Error('Transcription returned empty text.');
  }
  return text;
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== MESSAGE_OFFSCREEN_TRANSCRIBE) {
    return false;
  }
  transcribePayload(message)
    .then((text) => sendResponse({ ok: true, text }))
    .catch((error) =>
      sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
  return true;
});
