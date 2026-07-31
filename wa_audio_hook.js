/**
 * MAIN-world hook for WhatsApp Web.
 * Newer WA voice UI may never expose <audio> in the DOM; media arrives via
 * createObjectURL(Blob). We mirror those blobs to the isolated content script.
 */
(function citepaneWaAudioHook() {
  if (window.__citepaneWaAudioHook) {
    return;
  }
  window.__citepaneWaAudioHook = true;

  const SOURCE = 'citepane-wa-audio'; // keep in sync with WA_AUDIO_HOOK_SOURCE in defaults.js

  function publishBlob(blob, url) {
    if (!(blob instanceof Blob) || blob.size < 200) {
      return;
    }
    const mimeType = blob.type || 'audio/ogg';
    const looksAudio =
      mimeType.startsWith('audio/') ||
      mimeType === 'application/ogg' ||
      mimeType === 'application/octet-stream' ||
      !blob.type;
    if (!looksAudio) {
      return;
    }

    blob
      .slice(0)
      .arrayBuffer()
      .then((buffer) => {
        window.postMessage(
          {
            source: SOURCE,
            url: url || '',
            mimeType,
            buffer,
            size: blob.size,
          },
          '*',
          [buffer],
        );
      })
      .catch(() => {});
  }

  const originalCreateObjectURL = URL.createObjectURL.bind(URL);
  URL.createObjectURL = function citepaneCreateObjectURL(object) {
    const url = originalCreateObjectURL(object);
    if (object instanceof Blob) {
      publishBlob(object, url);
    }
    return url;
  };

  const srcDesc = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'src');
  if (srcDesc?.set) {
    Object.defineProperty(HTMLMediaElement.prototype, 'src', {
      configurable: true,
      enumerable: srcDesc.enumerable,
      get: srcDesc.get,
      set(value) {
        srcDesc.set.call(this, value);
        if (typeof value === 'string' && value.startsWith('blob:')) {
          fetch(value)
            .then((response) => response.blob())
            .then((blob) => publishBlob(blob, value))
            .catch(() => {});
        }
      },
    });
  }
})();
