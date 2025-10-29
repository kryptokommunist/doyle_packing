import { renderSpiral } from './doyle_spiral_engine.js';

let activeRequest = null;

self.addEventListener('message', event => {
  const data = event.data || {};
  if (data.type !== 'render') {
    return;
  }
  const { requestId, params } = data;
  activeRequest = requestId;
  try {
    const result = renderSpiral(params || {});
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
