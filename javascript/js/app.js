import { renderSpiral, normaliseParams } from './doyle_spiral_engine.js';
import { createThreeViewer } from './three_viewer.js';

const form = document.getElementById('controlsForm');
const statusEl = document.getElementById('statusMessage');
const svgPreview = document.getElementById('svgPreview');
const statsBlock = document.getElementById('stats');
const statArcGroups = document.getElementById('statArcGroups');
const statPolygons = document.getElementById('statPolygons');
const statMode = document.getElementById('statMode');
const tRange = document.getElementById('inputT');
const tValue = document.getElementById('tValue');
const fillToggle = document.getElementById('togglePattern');
const fillSettings = document.getElementById('fillSettings');
const fillPatternStyleSelect = document.getElementById('fillPatternStyle');
const fillRectWidthGroup = document.getElementById('fillRectWidthGroup');
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
  add_fill_pattern: false,
  draw_group_outline: true,
  red_outline: false,
  fill_pattern_spacing: 5,
  fill_pattern_angle: 0,
  fill_pattern_offset: 0,
  fill_pattern_style: 'lines',
  fill_pattern_rect_width: 3,
};

let activeView = '2d';
let lastRender = null;
let threeApp = null;
const workerSupported = typeof Worker !== 'undefined';
const renderWorkerURL = workerSupported ? new URL('./render_worker.js', import.meta.url) : null;
let renderWorkerHandle = null;
let currentRenderToken = 0;
const svgParser = typeof DOMParser !== 'undefined' ? new DOMParser() : null;

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

function downloadCurrentSvg() {
  if (!lastRender) {
    setStatus('Render the spiral before downloading.', 'error');
    return;
  }

  let svgContent = lastRender.svgString || '';
  if (!svgContent) {
    const svgElement = svgPreview.querySelector('svg');
    if (svgElement) {
      svgContent = new XMLSerializer().serializeToString(svgElement);
    }
  }

  if (!svgContent) {
    setStatus('Unable to access the rendered SVG for download.', 'error');
    return;
  }

  const blob = new Blob([svgContent], { type: 'image/svg+xml;charset=utf-8' });
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
}

function hasGeometry(geometry) {
  return Boolean(geometry && Array.isArray(geometry.arcgroups));
}

function updateTValue() {
  tValue.textContent = parseFloat(tRange.value).toFixed(2);
}

function toggleFillSettings() {
  fillSettings.hidden = !fillToggle.checked;
}

function updatePatternStyleSettings() {
  if (!fillRectWidthGroup) {
    return;
  }
  const style = fillPatternStyleSelect ? String(fillPatternStyleSelect.value || '').toLowerCase() : 'lines';
  fillRectWidthGroup.hidden = style !== 'rectangles';
}

function setStatus(message, state = 'idle') {
  statusEl.textContent = message;
  statusEl.classList.remove('loading', 'error');
  if (state !== 'idle') {
    statusEl.classList.add(state);
  }
}

function terminateRenderWorker() {
  if (renderWorkerHandle) {
    renderWorkerHandle.terminate();
    renderWorkerHandle = null;
  }
}

function materializeSvg(result) {
  if (result && result.svg) {
    return result.svg;
  }
  if (!result || !result.svgString || !svgParser) {
    return null;
  }
  const doc = svgParser.parseFromString(result.svgString, 'image/svg+xml');
  const element = doc.documentElement;
  if (!element || element.nodeName.toLowerCase() !== 'svg') {
    return null;
  }
  return document.importNode(element, true);
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
  // Preserve mode exactly as selected (normaliseParams already handles but ensure string)
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
  void threeSettingsToggle.offsetWidth; // trigger reflow
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
      const result = renderSpiral({ ...params, mode: 'arram_boyle' }, 'arram_boyle');
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

function showSVG(svgElement) {
  svgElement.setAttribute('width', '100%');
  svgElement.setAttribute('height', '100%');
  svgElement.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  svgPreview.replaceChildren(svgElement);
  svgPreview.classList.remove('empty-state');
}

function handleRenderSuccess(result) {
  const svgElement = materializeSvg(result);
  if (!svgElement) {
    throw new Error('Renderer produced no SVG content');
  }
  try {
    const result = renderSpiral(params);
    showSVG(svgElement);

    const params = result.params || collectParams();
    const geometry = hasGeometry(result.geometry) ? result.geometry : null;
    const mode = (result.mode || params?.mode || DEFAULTS.mode);

    lastRender = { params, geometry, mode };

    updateStats(geometry);
    statMode.textContent = mode === 'arram_boyle' ? 'Arram-Boyle' : 'Classic Doyle';
    setStatus('Spiral updated. Switch views to explore it in 3D.');
    updateExportAvailability(true);

    if (threeApp) {
      if (geometry) {
        threeApp.useGeometryFromPayload(params, geometry);
      } else {
        threeApp.queueGeometryUpdate(params, true);
      }
  } catch (error) {
    console.error(error);
    svgPreview.innerHTML = '<div class="empty-state">Unable to render spiral.</div>';
    svgPreview.classList.add('empty-state');
    setStatus(error.message || 'Unexpected error', 'error');
    lastRender = null;
    updateExportAvailability(false);
  }
}

function handleRenderFailure(message) {
  svgPreview.innerHTML = '<div class="empty-state">Unable to render spiral.</div>';
  svgPreview.classList.add('empty-state');
  setStatus(message || 'Unexpected error', 'error');
}

function startRenderJob(params, showLoading) {
  const token = ++currentRenderToken;
  const statusMessage = showLoading ? 'Rendering spiral…' : 'Updating spiral…';
  setStatus(statusMessage, 'loading');

  if (workerSupported && renderWorkerURL && svgParser) {
    terminateRenderWorker();
    const worker = new Worker(renderWorkerURL, { type: 'module' });
    renderWorkerHandle = worker;

    worker.onmessage = event => {
      const data = event.data || {};
      if (data.requestId !== token) {
        return;
      }
      if (renderWorkerHandle === worker) {
        worker.terminate();
        renderWorkerHandle = null;
      }
      if (data.type === 'result') {
        try {
          handleRenderSuccess(data);
        } catch (error) {
          console.error(error);
          handleRenderFailure(error.message || 'Unexpected error');
        }
      } else if (data.type === 'error') {
        const message = data.message || 'Render failed';
        console.error(message);
        handleRenderFailure(message);
      }
    };

    worker.onerror = event => {
      const message = event?.message || 'Render failed';
      if (renderWorkerHandle === worker) {
        worker.terminate();
        renderWorkerHandle = null;
      }
      console.error(event?.error || message);
      handleRenderFailure(message);
    };

    worker.postMessage({ type: 'render', requestId: token, params });
    return;
  }

  setTimeout(() => {
    try {
      const result = renderSpiral(params);
      handleRenderSuccess(result);
    } catch (error) {
      console.error(error);
      handleRenderFailure(error.message || 'Unexpected error');
    }
  }, 0);
}

function renderCurrentSpiral(showLoading = true) {
  const params = collectParams();
  startRenderJob(params, showLoading);
}

const debouncedRender = debounce(() => renderCurrentSpiral(false), 200);

form.addEventListener('input', event => {
  if (event.target.name === 't') {
    updateTValue();
  }
  if (event.target === fillToggle) {
    toggleFillSettings();
  }
  if (event.target === fillPatternStyleSelect) {
    updatePatternStyleSettings();
  }
  debouncedRender();
  if (threeApp) {
    threeApp.queueGeometryUpdate(collectParams());
  }
});

if (fillPatternStyleSelect) {
  fillPatternStyleSelect.addEventListener('change', updatePatternStyleSettings);
}

form.addEventListener('submit', event => {
  event.preventDefault();
  renderCurrentSpiral(true);
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

updateExportAvailability(false);
toggleFillSettings();
updatePatternStyleSettings();
updateTValue();
renderCurrentSpiral(true);
