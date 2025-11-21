import { renderPreview, renderSpiral } from './doyle_spiral_engine.js';

let activeRequest = null;

self.addEventListener('message', event => {
  const data = event.data || {};
  if (data.type === 'cancel') {
    activeRequest = null;
    return;
  }
  if (data.type !== 'render' && data.type !== 'preview' && data.type !== 'export') {
    return;
  }
  const { requestId, params } = data;
  activeRequest = requestId;
  try {
    const startedAt = performance.now();
    const result = data.type === 'preview'
      ? renderPreview(params || {})
      : renderSpiral(params || {});
    const duration = performance.now() - startedAt;
    if (activeRequest !== requestId) {
      return;
    }
    self.postMessage({
      type: 'result',
      requestId,
      svgString: result.svgString || '',
      geometry: result.geometry || null,
      mode: result.mode || null,
      params: result.params || null,
      duration,
    });
  } catch (error) {
    const message = error && typeof error.message === 'string'
      ? error.message
      : 'Render failed';
    self.postMessage({
      type: 'error',
      requestId,
      message,
    });
  }
});
