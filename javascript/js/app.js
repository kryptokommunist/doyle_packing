import { renderPreview, renderSpiral, normaliseParams } from './doyle_spiral_engine.js';
import { createThreeViewer } from './three_viewer.js';

const form = document.getElementById('controlsForm');
const statusEl = document.getElementById('statusMessage');
const svgPreview = document.getElementById('svgPreview');
const statsBlock = document.getElementById('stats');
const statArcGroups = document.getElementById('statArcGroups');
const statPolygons = document.getElementById('statPolygons');
const statMode = document.getElementById('statMode');
const statPerformance = document.getElementById('statPerformance');
const tRange = document.getElementById('inputT');
const tValue = document.getElementById('tValue');
const renderTimeoutInput = document.getElementById('renderTimeoutSeconds');
const fillToggle = document.getElementById('togglePattern');
const fillSettings = document.getElementById('fillSettings');
const fillPatternTypeSelect = document.getElementById('fillPatternType');
const fillRectWidthGroup = document.getElementById('rectWidthGroup');
const outlineToggle = document.getElementById('toggleOutline');
const redToggle = document.getElementById('toggleRed');
const viewButtons = Array.from(document.querySelectorAll('[data-view]'));
const view2d = document.getElementById('view2d');
const view3d = document.getElementById('view3d');
const threeStatus = document.getElementById('threeStatus');
const threeSettingsToggle = document.getElementById('threeSettingsToggle');
const threeStage = document.getElementById('threeStage');
const threeStats = document.getElementById('threeStats');
const fileInput = document.getElementById('threeFileInput');
const exportButton = document.getElementById('exportSvgButton');
const exportFilenameInput = document.getElementById('exportFilename');

const DEFAULTS = {
  p: 16,
  q: 16,
  t: 0,
  mode: 'arram_boyle',
  arc_mode: 'closest',
  num_gaps: 2,
  size: 800,
  bounding_box_width_mm: 200,
  bounding_box_height_mm: 200,
  add_fill_pattern: false,
  draw_group_outline: true,
  red_outline: false,
  fill_pattern_spacing: 8,
  fill_pattern_angle: 0,
  fill_pattern_offset: 0,
  fill_pattern_type: 'lines',
  fill_pattern_rect_width: 2,
  fill_pattern_animation: 'radial_bloom',
  highlight_rim_width: 1.2,
  group_outline_width: 0.6,
  pattern_stroke_width: 0.5,
};

const workerSupported = typeof Worker !== 'undefined';
const renderWorkerURL = workerSupported ? new URL('./render_worker.js', import.meta.url) : null;
const DEFAULT_RENDER_TIMEOUT_MS = 30000;
const MIN_RENDER_TIMEOUT_MS = 5000;
const MAX_RENDER_TIMEOUT_MS = 300000;

const previewCanvas = document.createElement('canvas');
previewCanvas.id = 'spiralPreviewCanvas';
const previewContext = previewCanvas.getContext('2d');
if (svgPreview) {
  svgPreview.replaceChildren(previewCanvas);
  svgPreview.classList.remove('empty-state');
}

let activeView = '2d';
let threeApp = null;
let lastRender = null;
let renderToken = 0;
let activeWorker = null;
let activeTimeout = null;

class PerformanceMeter {
  constructor(target) {
    this.target = target;
    this.lastRenderMs = null;
    this.lastDrawMs = null;
    this.initialised = false;
  }

  start() {
    this.startedAt = performance.now();
    this.lastDrawMs = null;
    this.report('Starting render…');
  }

  markDraw(durationMs) {
    this.lastDrawMs = durationMs;
  }

  finish(renderDurationMs) {
    this.lastRenderMs = renderDurationMs;
    const renderText = `${renderDurationMs.toFixed(1)} ms`; 
    const drawText = this.lastDrawMs !== null ? ` | draw ${this.lastDrawMs.toFixed(1)} ms` : '';
    this.report(`render ${renderText}${drawText}`);
    this.initialised = true;
  }

  report(text) {
    if (!this.target) return;
    const display = this.initialised ? text : `warmup: ${text}`;
    this.target.textContent = display;
  }
}

const perfMeter = new PerformanceMeter(statPerformance);

function sanitiseFileName(name) {
  return name.replace(/[\\/:*?"<>|]+/g, '-');
}

function getExportFileName() {
  if (!exportFilenameInput) {
    return 'doyle-spiral.svg';
  }
  const raw = exportFilenameInput.value.trim() || 'doyle-spiral';
  const safe = sanitiseFileName(raw) || 'doyle-spiral';
  return safe.toLowerCase().endsWith('.svg') ? safe : `${safe}.svg`;
}

function updateExportAvailability(available) {
  if (exportButton) {
    exportButton.disabled = !available;
  }
}

function getRenderTimeoutMs() {
  const secondsRaw = renderTimeoutInput ? Number(renderTimeoutInput.value) : Number.NaN;
  const seconds = Number.isFinite(secondsRaw)
    ? secondsRaw
    : DEFAULT_RENDER_TIMEOUT_MS / 1000;
  const clampedSeconds = Math.min(Math.max(seconds, MIN_RENDER_TIMEOUT_MS / 1000), MAX_RENDER_TIMEOUT_MS / 1000);
  return clampedSeconds * 1000;
}

function updateTValue() {
  tValue.textContent = parseFloat(tRange.value).toFixed(2);
}

function toggleFillSettings() {
  fillSettings.hidden = !fillToggle.checked;
  updatePatternTypeVisibility();
}

function setStatus(message, state = 'idle') {
  statusEl.textContent = message;
  statusEl.classList.remove('loading', 'error');
  if (state !== 'idle') {
    statusEl.classList.add(state);
  }
}

function updatePatternTypeVisibility() {
  if (!fillPatternTypeSelect || !fillRectWidthGroup) {
    return;
  }
  const showRectangles = fillPatternTypeSelect.value === 'rectangles';
  fillRectWidthGroup.hidden = !showRectangles;
}

function hasGeometry(geometry) {
  return Boolean(geometry && Array.isArray(geometry.arcgroups));
}

function collectParams() {
  const formData = new FormData(form);
  const raw = { ...DEFAULTS };
  for (const [key, value] of formData.entries()) {
    raw[key] = value;
  }
  raw.add_fill_pattern = fillToggle.checked;
  raw.draw_group_outline = outlineToggle.checked;
  raw.red_outline = redToggle.checked;
  const params = normaliseParams(raw);
  params.mode = raw.mode || params.mode;
  return params;
}

function debounce(fn, delay) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

function pulseSettingsButton() {
  if (!threeSettingsToggle) {
    return;
  }
  threeSettingsToggle.classList.remove('pulse');
  void threeSettingsToggle.offsetWidth;
  threeSettingsToggle.classList.add('pulse');
  setTimeout(() => threeSettingsToggle.classList.remove('pulse'), 1200);
}

function ensureThreeApp() {
  if (threeApp) {
    return threeApp;
  }
  const canvas = document.getElementById('threeCanvas');
  const rotationSpeed = document.getElementById('threeRotationSpeed');
  const rotationSpeedValue = document.getElementById('threeRotationSpeedValue');
  const pulseSpeed = document.getElementById('threePulseSpeed');
  const pulseSpeedValue = document.getElementById('threePulseSpeedValue');
  const metalness = document.getElementById('threeMetalness');
  const metalnessValue = document.getElementById('threeMetalnessValue');
  const roughness = document.getElementById('threeRoughness');
  const roughnessValue = document.getElementById('threeRoughnessValue');
  const manualRotation = document.getElementById('threeManualRotation');
  const manualRotationValue = document.getElementById('threeManualRotationValue');
  const reloadGeometry = document.getElementById('threeReloadGeometry');
  const loadJson = document.getElementById('threeLoadJson');
  const resetCamera = document.getElementById('threeResetCamera');
  const statArcGroups3d = document.getElementById('threeStatArcGroups');
  const statPolygons3d = document.getElementById('threeStatPolygons');
  const statParameters3d = document.getElementById('threeStatParameters');

  threeApp = createThreeViewer({
    canvas,
    statusElement: threeStatus,
    stats: {
      container: threeStats,
      arcGroups: statArcGroups3d,
      polygons: statPolygons3d,
      parameters: statParameters3d,
    },
    controls: {
      rotationSpeed,
      rotationSpeedValue,
      manualRotation,
      manualRotationValue,
      pulseSpeed,
      pulseSpeedValue,
      metalness,
      metalnessValue,
      roughness,
      roughnessValue,
      reloadButton: reloadGeometry,
      loadJsonButton: loadJson,
      resetCameraButton: resetCamera,
      fileInput,
    },
    geometryFetcher: async params => {
      const result = renderPreview({ ...params, mode: 'arram_boyle' }, 'arram_boyle');
      if (!result.geometry || !Array.isArray(result.geometry.arcgroups)) {
        throw new Error('Geometry generation failed');
      }
      return {
        geometry: result.geometry,
        label: `p=${params.p}, q=${params.q}, t=${Number(params.t).toFixed(2)}`,
      };
    },
    getParams: collectParams,
  });
  return threeApp;
}

function updateStats(geometry) {
  if (hasGeometry(geometry)) {
    const arcGroups = geometry.arcgroups.length;
    const polygons = geometry.arcgroups.reduce((sum, group) => sum + (group.arc_count || 0), 0);
    statArcGroups.textContent = arcGroups;
    statPolygons.textContent = polygons;
    statsBlock.hidden = false;
  } else {
    statsBlock.hidden = true;
  }
}

function drawPreviewToCanvas(geometry, params) {
  if (!previewCanvas || !previewContext) {
    return 0;
  }
  const start = performance.now();
  const boundsWidth = params.bounding_box_width_mm || DEFAULTS.bounding_box_width_mm;
  const boundsHeight = params.bounding_box_height_mm || boundsWidth;
  const clientWidth = svgPreview.clientWidth || boundsWidth;
  const clientHeight = svgPreview.clientHeight || boundsHeight;
  const dpr = window.devicePixelRatio || 1;
  previewCanvas.width = clientWidth * dpr;
  previewCanvas.height = clientHeight * dpr;
  previewCanvas.style.width = `${clientWidth}px`;
  previewCanvas.style.height = `${clientHeight}px`;

  previewContext.save();
  previewContext.scale(dpr, dpr);
  previewContext.clearRect(0, 0, clientWidth, clientHeight);
  previewContext.translate(clientWidth / 2, clientHeight / 2);
  const scale = 0.9 * Math.min(clientWidth / boundsWidth, clientHeight / boundsHeight);
  previewContext.scale(scale, scale);
  previewContext.lineWidth = Math.max(0.4 / scale, 0.4);
  previewContext.strokeStyle = '#0f172a';
  previewContext.fillStyle = 'rgba(37, 99, 235, 0.1)';

  if (!hasGeometry(geometry)) {
    previewContext.restore();
    return performance.now() - start;
  }

  for (const group of geometry.arcgroups) {
    const outline = group.outline || [];
    if (outline.length < 2) continue;
    previewContext.beginPath();
    const [firstX, firstY] = outline[0];
    previewContext.moveTo(firstX, firstY);
    for (let i = 1; i < outline.length; i += 1) {
      const [x, y] = outline[i];
      previewContext.lineTo(x, y);
    }
    previewContext.closePath();
    previewContext.stroke();
  }

  previewContext.restore();
  return performance.now() - start;
}

function handleRenderFailure(message) {
  svgPreview?.classList.add('empty-state');
  setStatus(message || 'Unexpected error', 'error');
  lastRender = null;
  updateExportAvailability(false);
}

function applyPreviewResult(result, renderDuration) {
  const geometry = hasGeometry(result.geometry) ? result.geometry : null;
  if (!geometry) {
    throw new Error('No geometry returned');
  }
  svgPreview.classList.remove('empty-state');
  const drawDuration = drawPreviewToCanvas(geometry, result.params || collectParams());
  perfMeter.markDraw(drawDuration);
  perfMeter.finish(renderDuration);

  const params = result.params || collectParams();
  lastRender = { params, geometry, mode: result.mode || params.mode, svgString: null };
  statMode.textContent = lastRender.mode === 'arram_boyle' ? 'Arram-Boyle' : 'Classic Doyle';
  updateStats(geometry);
  setStatus('Preview updated.');
  updateExportAvailability(true);

  if (threeApp) {
    threeApp.useGeometryFromPayload(params, geometry);
  }
}

function cancelActiveWorker() {
  if (activeWorker) {
    activeWorker.terminate();
    activeWorker = null;
  }
  if (activeTimeout) {
    clearTimeout(activeTimeout);
    activeTimeout = null;
  }
}

function startPreviewRender(showLoading = true) {
  const params = collectParams();
  renderToken += 1;
  const requestId = renderToken;
  cancelActiveWorker();
  const timeoutMs = getRenderTimeoutMs();
  perfMeter.start();

  if (showLoading) {
    setStatus('Rendering preview…', 'loading');
  } else {
    setStatus('Updating preview…', 'loading');
  }

  if (workerSupported && renderWorkerURL) {
    const worker = new Worker(renderWorkerURL, { type: 'module' });
    activeWorker = worker;
    activeTimeout = setTimeout(() => {
      if (activeWorker === worker) {
        worker.terminate();
        activeWorker = null;
      }
      handleRenderFailure('Render cancelled after exceeding the timeout. Reduce detail or extend the limit.');
    }, timeoutMs);

    worker.onmessage = event => {
      const data = event.data || {};
      if (data.requestId !== requestId) {
        return;
      }
      cancelActiveWorker();
      try {
        applyPreviewResult(data, data.duration || 0);
      } catch (error) {
        console.error(error);
        handleRenderFailure(error.message || 'Unexpected error');
      }
    };

    worker.onerror = event => {
      cancelActiveWorker();
      console.error(event?.error || event?.message);
      handleRenderFailure('Render failed');
    };

    worker.postMessage({ type: 'preview', requestId, params });
    return;
  }

  setTimeout(() => {
    try {
      const startedAt = performance.now();
      const result = renderPreview(params);
      const renderDuration = performance.now() - startedAt;
      applyPreviewResult(result, renderDuration);
    } catch (error) {
      console.error(error);
      handleRenderFailure(error.message || 'Unexpected error');
    }
  }, 0);
}

async function downloadCurrentSvg() {
  const params = lastRender?.params || collectParams();
  if (!params) {
    setStatus('Render the spiral before downloading.', 'error');
    return;
  }
  setStatus('Preparing SVG export…', 'loading');
  const requestId = ++renderToken;
  cancelActiveWorker();
  const timeoutMs = getRenderTimeoutMs();

  const handleExportResult = svgString => {
    const blob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const filename = getExportFileName();
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    setStatus(`SVG downloaded as ${filename}.`);
  };

  if (workerSupported && renderWorkerURL) {
    const worker = new Worker(renderWorkerURL, { type: 'module' });
    activeWorker = worker;
    activeTimeout = setTimeout(() => {
      if (activeWorker === worker) {
        worker.terminate();
        activeWorker = null;
      }
      handleRenderFailure('SVG export timed out.');
    }, timeoutMs);

    worker.onmessage = event => {
      const data = event.data || {};
      if (data.requestId !== requestId) {
        return;
      }
      cancelActiveWorker();
      if (data.svgString) {
        handleExportResult(data.svgString);
      } else {
        handleRenderFailure('Export failed');
      }
    };

    worker.onerror = event => {
      cancelActiveWorker();
      console.error(event?.error || event?.message);
      handleRenderFailure('Export failed');
    };

    worker.postMessage({ type: 'export', requestId, params });
    return;
  }

  try {
    const result = renderSpiral(params);
    if (!result.svgString) {
      throw new Error('Export failed');
    }
    handleExportResult(result.svgString);
  } catch (error) {
    console.error(error);
    handleRenderFailure(error.message || 'Export failed');
  }
}

const debouncedRender = debounce(() => startPreviewRender(false), 150);

form.addEventListener('input', event => {
  if (event.target.name === 't') {
    updateTValue();
  }
  if (event.target === fillToggle) {
    toggleFillSettings();
  }
  if (event.target === fillPatternTypeSelect) {
    updatePatternTypeVisibility();
  }
  debouncedRender();
  if (threeApp) {
    threeApp.queueGeometryUpdate(collectParams());
  }
});

form.addEventListener('submit', event => {
  event.preventDefault();
  startPreviewRender(true);
  if (threeApp) {
    threeApp.queueGeometryUpdate(collectParams(), true);
  }
});

viewButtons.forEach(button => {
  button.addEventListener('click', () => {
    const view = button.dataset.view;
    if (view === activeView) {
      return;
    }
    activeView = view;
    viewButtons.forEach(btn => {
      const isActive = btn.dataset.view === view;
      btn.classList.toggle('active', isActive);
      btn.setAttribute('aria-pressed', String(isActive));
    });

    const show3d = view === '3d';
    view2d.hidden = show3d;
    view3d.hidden = !show3d;
    updateStats(lastRender ? lastRender.geometry : null);

    if (show3d) {
      pulseSettingsButton();
      const app = ensureThreeApp();
      if (app) {
        const params = collectParams();
        if (lastRender && hasGeometry(lastRender.geometry)) {
          app.useGeometryFromPayload(params, lastRender.geometry);
        } else {
          app.queueGeometryUpdate(params, true);
        }
      }
    }
  });
});

if (threeSettingsToggle) {
  threeSettingsToggle.addEventListener('click', () => {
    const collapsed = threeStage.classList.toggle('collapsed');
    threeSettingsToggle.textContent = collapsed ? 'Show 3D settings' : 'Hide 3D settings';
    threeSettingsToggle.setAttribute('aria-expanded', String(!collapsed));
  });
}

if (exportButton) {
  exportButton.addEventListener('click', downloadCurrentSvg);
}

if (fillPatternTypeSelect) {
  fillPatternTypeSelect.addEventListener('change', updatePatternTypeVisibility);
}

updateExportAvailability(false);
toggleFillSettings();
updateTValue();
perfMeter.report('waiting for first render…');
startPreviewRender(true);
