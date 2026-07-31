/**
 * Offscreen Whisper (Transformers.js) — runs on-device, no STT API.
 * Loaded only after the user accepts the model download.
 * Streams decode tokens via WhisperTextStreamer when requestId is set.
 * Shared helpers/constants come from defaults.js (classic script) via globalThis.CITEPANE.
 */

import { pipeline, env, WhisperTextStreamer } from './vendor/transformers/transformers.js';

env.allowLocalModels = false;
env.useBrowserCache = true;
// MV3 forbids remote script-src; WASM assets ship next to the library.
env.backends.onnx.wasm.wasmPaths = chrome.runtime.getURL('vendor/transformers/');
// Avoid blob: workers (blocked by extension CSP).
env.backends.onnx.wasm.numThreads = 1;
env.backends.onnx.wasm.proxy = false;

const {
  MESSAGE_OFFSCREEN_TRANSCRIBE,
  MESSAGE_OFFSCREEN_TRANSCRIBE_PARTIAL,
  DEFAULT_LOCAL_WHISPER_MODEL,
  base64ToUint8Array,
  whisperLanguageForAsr,
} = globalThis.CITEPANE;

let transcriber = null;
let loadedModelId = '';

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

function emitPartial(requestId, text) {
  if (!requestId || !text) {
    return;
  }
  chrome.runtime
    .sendMessage({
      type: MESSAGE_OFFSCREEN_TRANSCRIBE_PARTIAL,
      requestId,
      text,
    })
    .catch(() => {});
}

async function transcribePayload(message) {
  const modelId =
    typeof message.modelId === 'string' && message.modelId.trim()
      ? message.modelId.trim()
      : DEFAULT_LOCAL_WHISPER_MODEL;
  const audioBase64 = typeof message.audioBase64 === 'string' ? message.audioBase64 : '';
  const requestId = typeof message.requestId === 'string' ? message.requestId : '';
  if (!audioBase64) {
    throw new Error('Missing audio payload.');
  }

  const samples = await decodeToMono16k(base64ToUint8Array(audioBase64).buffer);
  const asr = await getTranscriber(modelId);
  const language = whisperLanguageForAsr(message.language);
  const durationSec = samples.length / 16000;

  let streamed = '';
  const options = {
    task: 'transcribe',
    return_timestamps: false,
  };
  if (language) {
    options.language = language;
  }
  // Longer notes: chunk so the UI gets progress between segments as well as tokens.
  if (durationSec > 28) {
    options.chunk_length_s = 20;
    options.stride_length_s = 3;
  }

  if (requestId && asr.tokenizer) {
    options.streamer = new WhisperTextStreamer(asr.tokenizer, {
      skip_prompt: true,
      skip_special_tokens: true,
      callback_function(piece) {
        if (typeof piece !== 'string' || !piece) {
          return;
        }
        streamed += piece;
        const trimmed = streamed.replace(/\s+/g, ' ').trim();
        if (trimmed) {
          emitPartial(requestId, trimmed);
        }
      },
    });
  }

  const output = await asr(samples, options);
  const text = typeof output?.text === 'string' ? output.text.trim() : streamed.trim();
  if (!text) {
    throw new Error('Transcription returned empty text.');
  }
  if (requestId) {
    emitPartial(requestId, text);
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
