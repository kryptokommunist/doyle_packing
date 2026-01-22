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
    let message = 'Render failed';

    if (error && typeof error.message === 'string') {
      message = error.message;

      // Enhance error messages with context
      if (error.message.includes('iteration limit')) {
        // Already has good context from generateCircles/generateOuterCircles
        message = error.message;
      } else if (error.message.includes('memory') || error.name === 'RangeError') {
        message = `Out of memory. Try reducing parameters: p=${params?.p || '?'}, q=${params?.q || '?'}, max_d=${params?.max_d || '?'}`;
      } else {
        // Add parameter context to generic errors
        message = `${error.message} [p=${params?.p || '?'}, q=${params?.q || '?'}, t=${params?.t || '?'}, max_d=${params?.max_d || '?'}]`;
      }
    }

    self.postMessage({
      type: 'error',
      requestId,
      message,
      errorType: error?.name || 'Error',
    });
  }
});
