import { renderSpiral, normaliseParams, buildPatternAnimationContext, buildContinuousPathsFromArcs } from './doyle_spiral_engine.js';
import { createThreeViewer } from './three_viewer.js';
import { generateDXF, generateSingleGroupDXF } from './dxf_export.js';
import { zipSync, strToU8 } from 'https://cdn.jsdelivr.net/npm/fflate@0.8.2/esm/browser.js';
import { getBreakdownRings, generateBreakdownSVG, countWorkpieces, getOuterBoundsRequired, centreOutline } from './breakdown.js';

const form = document.getElementById('controlsForm');
const statusEl = document.getElementById('statusMessage');
const svgPreview = document.getElementById('svgPreview');
const statsBlock = document.getElementById('stats');
const statArcGroups = document.getElementById('statArcGroups');
const statPolygons = document.getElementById('statPolygons');
const statMode = document.getElementById('statMode');
const tRange = document.getElementById('inputT');
const tValue = document.getElementById('tValue');
const renderTimeoutInput = document.getElementById('renderTimeoutSeconds');
const fillToggle = document.getElementById('togglePattern');
const fillSettings = document.getElementById('fillSettings');
const fillPatternTypeSelect = document.getElementById('fillPatternType');
const fillRectWidthGroup = document.getElementById('rectWidthGroup');
const outlineToggle = document.getElementById('toggleOutline');
const redToggle = document.getElementById('toggleRed');
const symmetricToggle = document.getElementById('toggleSymmetric');
const symmetricHint = document.getElementById('symmetricHint');
const viewButtons = Array.from(document.querySelectorAll('[data-view]'));
const view2d = document.getElementById('view2d');
const view3d = document.getElementById('view3d');
const viewAnimator = document.getElementById('viewAnimator');
const animatorFrames = document.getElementById('animatorFrames');
const animatorSvgPreview = document.getElementById('animatorSvgPreview');
const animatorFramePreview = document.getElementById('animatorFramePreview');
const animatorTabs = document.querySelectorAll('.animator-tab');
const addFrameBtn = document.getElementById('addFrameBtn');
const clearFramesBtn = document.getElementById('clearFramesBtn');
const loadAnimationBtn = document.getElementById('loadAnimationBtn');
const seedCountEl = document.getElementById('seedCount');
const threeStatus = document.getElementById('threeStatus');
const threeSettingsToggle = document.getElementById('threeSettingsToggle');
const threeStage = document.getElementById('threeStage');
const threeStats = document.getElementById('threeStats');
const fileInput = document.getElementById('threeFileInput');
const exportButton = document.getElementById('exportSvgButton');
const exportDxfButton = document.getElementById('exportDxfButton');
const exportFilenameInput = document.getElementById('exportFilename');
const breakdownModeCheckbox = document.getElementById('breakdownMode');
const breakdownSettings = document.getElementById('breakdownSettings');
const workpieceWidthInput = document.getElementById('workpieceWidth');
const workpieceHeightInput = document.getElementById('workpieceHeight');
const breakdownRingCountEl = document.getElementById('breakdownRingCount');

const DEFAULTS = {
  p: 16,
  q: 16,
  t: 0,
  mode: 'arram_boyle',
  arc_mode: 'closest',
  num_gaps: 2,
  size: 800,
  bounding_box_width_mm: 250,
  bounding_box_height_mm: 250,
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

let activeView = '2d';
let lastRender = null;
let animationFrames = []; // Array of frame definitions for cellular automaton
let selectedSeeds = new Set(); // Set of group IDs selected as initial seeds
let animatorContext = null; // Cached pattern animation context for animator
let threeApp = null;
const workerSupported = typeof Worker !== 'undefined';
const renderWorkerURL = workerSupported ? new URL('./render_worker.js', import.meta.url) : null;
let renderWorkerHandle = null;
let currentRenderToken = 0;
let activeRenderJob = null;
const svgParser = typeof DOMParser !== 'undefined' ? new DOMParser() : null;
const DEFAULT_RENDER_TIMEOUT_MS = 30000;
const MIN_RENDER_TIMEOUT_MS = 5000;
const MAX_RENDER_TIMEOUT_MS = 300000;

function sanitiseFileName(name) {
  return name.replace(/[\\/:*?"<>|]+/g, '-');
}

function updateBreakdownMode() {
  const isBreakdown = breakdownModeCheckbox?.checked;
  if (breakdownSettings) breakdownSettings.hidden = !isBreakdown;
  if (exportButton)    exportButton.textContent    = isBreakdown ? 'Breakdown SVG' : 'Download SVG';
  if (exportDxfButton) exportDxfButton.textContent = isBreakdown ? 'Breakdown DXF' : 'Download DXF';
}

/**
 * Returns the highlight rim paths (arcs[2] and arcs[3]) for a single arc group.
 * These are the outer boundary arcs of each cell, used for laser-cut reference.
 * For the outermost ring, also includes the outer_* closure arcs.
 */
function getHighlightRimForGroup(group, arcGroups, isOutermost) {
  // Ring 0 (center piece) has no highlight rim
  if (!Number.isFinite(group.ringIndex) || group.ringIndex <= 0) return [];
  const highlightArcs = group.arcs.filter((_, i) => i === 2 || i === 3);
  const paths = buildContinuousPathsFromArcs(highlightArcs);
  if (isOutermost) {
    for (const [key, g] of arcGroups.entries()) {
      if (!key.startsWith('outer_')) continue;
      paths.push(...buildContinuousPathsFromArcs(g.arcs));
    }
  }
  return paths;
}

function updateBreakdownRingCount(count) {
  if (breakdownRingCountEl) {
    breakdownRingCountEl.textContent = count !== null ? `${count} workpiece${count === 1 ? '' : 's'}` : '';
  }
}

function getOverflowGroups(arcGroups, fittingRings) {
  const fittingIndices = new Set(fittingRings.map(r => r.ringIndex));
  const result = [];
  for (const [key, group] of arcGroups.entries()) {
    if (!key.startsWith('circle_')) continue;
    const r = group.ringIndex;
    if (r === null || r === undefined || r < 0) continue;
    if (fittingIndices.has(r)) continue;
    result.push(group);
  }
  return result;
}

async function downloadBreakdownZip(format) {
  if (!lastRender) {
    setStatus('Render the spiral before exporting.', 'error');
    return;
  }

  const params = lastRender.params || collectParams();
  let engine = lastRender.engine;
  let scaleFactor = lastRender.scaleFactor;

  if (!engine || !engine.arcGroups || !engine.arcGroups.size) {
    const result = renderSpiral({ ...params, mode: 'arram_boyle' }, 'arram_boyle');
    if (!result || !result.engine || !result.engine.arcGroups) {
      setStatus('Breakdown export failed: could not generate geometry.', 'error');
      return;
    }
    engine = result.engine;
    scaleFactor = result.scaleFactor;
  }

  const wpW = Number(workpieceWidthInput?.value) || 100;
  const wpH = Number(workpieceHeightInput?.value) || 100;

  const outerRequired = getOuterBoundsRequired(engine.arcGroups, scaleFactor ?? 1);
  if (outerRequired && (wpW < outerRequired.w || wpH < outerRequired.h)) {
    const needW = Math.ceil(outerRequired.w);
    const needH = Math.ceil(outerRequired.h);
    setStatus(`Workpiece box too small for outermost boundary. Minimum required: ${needW} × ${needH} mm.`, 'error');
    return;
  }

  const rings = getBreakdownRings(engine.arcGroups, scaleFactor ?? 1, wpW, wpH);

  if (!rings.length) {
    setStatus('No rings fit within the workpiece bounding box.', 'error');
    updateBreakdownRingCount(0);
    return;
  }

  const base = sanitiseFileName(exportFilenameInput?.value.trim() || 'doyle-spiral') || 'doyle-spiral';
  const zipFiles = {};
  const withPattern = Boolean(params.add_fill_pattern);
  const withHighlight = true; // always show cut boundary in breakdown exports

  // --- Beyond-box rings: one file per arc group, centred in workpiece box ---
  // Compute these first so we know the exact ring IDs exported individually.
  const overflowGroups = getOverflowGroups(engine.arcGroups, rings);
  const overflowRingIds = new Set(overflowGroups.map(g => g.ringIndex));
  for (const g of overflowGroups) {
    const gOutline = g.getClosedOutline();
    if (!gOutline || gOutline.length < 2) continue;
    const cx = gOutline.reduce((s, p) => s + p.re, 0) / gOutline.length;
    const cy = gOutline.reduce((s, p) => s + p.im, 0) / gOutline.length;
    const gOutlineCentred = centreOutline(gOutline);
    const highlightPaths = [gOutlineCentred];
    const rawPatSegs = withPattern && typeof g._getPatternSegments === 'function'
      ? (g._getPatternSegments((params.fill_pattern_spacing ?? 8) / (scaleFactor ?? 1), g.primaryPatternAngle ?? params.fill_pattern_angle, (params.fill_pattern_offset ?? 0) / (scaleFactor ?? 1)) ?? [])
      : [];
    const patLines = rawPatSegs.map(([p1, p2]) => ({
      p1: { re: p1.re - cx, im: p1.im - cy },
      p2: { re: p2.re - cx, im: p2.im - cy },
    }));
    const fname = `${base}_ring_${g.ringIndex}_group_${g.id}.${format}`;
    zipFiles[fname] = strToU8(
      format === 'svg'
        ? generateBreakdownSVG([gOutlineCentred], highlightPaths, scaleFactor ?? 1, wpW, wpH, patLines)
        : generateSingleGroupDXF([gOutlineCentred], highlightPaths, scaleFactor ?? 1, wpW, wpH)
    );
  }

  // --- Workpiece file: all groups whose ring fits in the workpiece box ---
  const fittingRingIds = new Set(rings.map(r => r.ringIndex));
  const fittingOutlines = [];
  const fittingHighlightPaths = [];
  const fittingPatternLines = [];

  // Workpiece highlight rim = arcs[2,3] of the first overflow ring
  // (same role as the outer_* closure arcs for the spiral's absolute outermost ring)
  const firstOverflowRingIndex = overflowGroups.length > 0
    ? Math.min(...overflowGroups.map(g => g.ringIndex))
    : -1;
  if (firstOverflowRingIndex >= 0) {
    for (const [key, g] of engine.arcGroups.entries()) {
      if (!key.startsWith('circle_') || g.ringIndex !== firstOverflowRingIndex) continue;
      fittingHighlightPaths.push(...buildContinuousPathsFromArcs(g.arcs.filter((_, i) => i === 2 || i === 3)));
    }
  }

  for (const [key, g] of engine.arcGroups.entries()) {
    if (!key.startsWith('circle_')) continue;
    if (!fittingRingIds.has(g.ringIndex)) continue;
    const gOutline = g.getClosedOutline();
    if (!gOutline || gOutline.length < 2) continue;
    fittingOutlines.push(gOutline);
    if (withPattern && typeof g._getPatternSegments === 'function') {
      const segs = g._getPatternSegments((params.fill_pattern_spacing ?? 8) / (scaleFactor ?? 1), g.primaryPatternAngle ?? params.fill_pattern_angle, (params.fill_pattern_offset ?? 0) / (scaleFactor ?? 1)) ?? [];
      fittingPatternLines.push(...segs.map(([p1, p2]) => ({ p1, p2 })));
    }
  }

  if (fittingOutlines.length > 0) {
    const fname = `${base}_workpiece.${format}`;
    zipFiles[fname] = strToU8(
      format === 'svg'
        ? generateBreakdownSVG(fittingOutlines, fittingHighlightPaths, scaleFactor ?? 1, wpW, wpH, fittingPatternLines)
        : generateSingleGroupDXF(fittingOutlines, fittingHighlightPaths, scaleFactor ?? 1, wpW, wpH)
    );
  }

  const totalPieceCount = countWorkpieces(engine.arcGroups, rings, withPattern);
  const fileCount = Object.keys(zipFiles).length;
  const zipped = zipSync(zipFiles);
  const blob = new Blob([zipped], { type: 'application/zip' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${base}_breakdown.zip`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
  setStatus(`Exported ${fileCount} workpiece file${fileCount === 1 ? '' : 's'} in ${base}_breakdown.zip.`);
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
  if (exportDxfButton) {
    exportDxfButton.disabled = !available;
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

function downloadCurrentSvg() {
  if (breakdownModeCheckbox?.checked) {
    downloadBreakdownZip('svg');
    return;
  }

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

function downloadCurrentDxf() {
  if (breakdownModeCheckbox?.checked) {
    downloadBreakdownZip('dxf');
    return;
  }

  if (!lastRender) {
    setStatus('Render the spiral before downloading.', 'error');
    return;
  }

  const params = lastRender.params || collectParams();

  // The engine object isn't available when rendered via worker — re-run in main thread.
  let engine = lastRender.engine;
  let scaleFactor = lastRender.scaleFactor;

  if (!engine || !engine.arcGroups || !engine.arcGroups.size) {
    const result = renderSpiral({ ...params, mode: 'arram_boyle' }, 'arram_boyle');
    if (!result || !result.engine || !result.engine.arcGroups) {
      setStatus('DXF export failed: could not generate geometry.', 'error');
      return;
    }
    engine = result.engine;
    scaleFactor = result.scaleFactor;
  }

  const bbW = params.bounding_box_width_mm || DEFAULTS.bounding_box_width_mm;
  const bbH = params.bounding_box_height_mm || DEFAULTS.bounding_box_height_mm;

  const dxfContent = generateDXF(engine.arcGroups, scaleFactor ?? 1, bbW, bbH, {
    drawGroupOutline: params.draw_group_outline !== false,
    redOutline: Boolean(params.red_outline),
  });

  const raw = exportFilenameInput ? exportFilenameInput.value.trim() || 'doyle-spiral' : 'doyle-spiral';
  const safe = sanitiseFileName(raw) || 'doyle-spiral';
  const filename = safe.toLowerCase().endsWith('.dxf') ? safe : `${safe}.dxf`;

  const blob = new Blob([dxfContent], { type: 'application/dxf' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
  setStatus(`DXF downloaded as ${filename}.`);
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

function terminateRenderWorker() {
  if (renderWorkerHandle) {
    renderWorkerHandle.terminate();
    renderWorkerHandle = null;
  }
}

function cancelActiveRenderJob() {
  if (activeRenderJob?.type === 'timeout' && activeRenderJob.id) {
    clearTimeout(activeRenderJob.id);
  }
  if (activeRenderJob?.type === 'worker') {
    terminateRenderWorker();
  }
  if (activeRenderJob?.timeoutId) {
    clearTimeout(activeRenderJob.timeoutId);
  }
  activeRenderJob = null;
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
  raw.use_symmetric = symmetricToggle?.checked ?? true;
  if (breakdownModeCheckbox?.checked) {
    raw.red_outline = true;
    if (lastRender?.engine?.arcGroups && lastRender?.scaleFactor != null) {
      const wpW = Number(workpieceWidthInput?.value) || 100;
      const wpH = Number(workpieceHeightInput?.value) || 100;
      const fittingRings = getBreakdownRings(lastRender.engine.arcGroups, lastRender.scaleFactor, wpW, wpH);
      if (fittingRings.length > 0) {
        const lastFitting = fittingRings[fittingRings.length - 1].ringIndex;
        raw.red_outline_min_ring = lastFitting + 1;
      } else {
        raw.red_outline_min_ring = 0;
      }
    }
  }
  const params = normaliseParams(raw);
  // Preserve mode exactly as selected (normaliseParams already handles but ensure string)
  params.mode = raw.mode || params.mode;
  return params;
}

function updateSymmetricHint() {
  if (!symmetricHint || !symmetricToggle) return;
  const formData = new FormData(form);
  const p = Number(formData.get('p'));
  const q = Number(formData.get('q'));
  const isSymmetric = p === q && symmetricToggle.checked;
  symmetricHint.style.display = isSymmetric ? 'block' : 'none';
}

function debounce(fn, delay) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

function updatePatternTypeVisibility() {
  if (!fillPatternTypeSelect || !fillRectWidthGroup) {
    return;
  }
  const showRectangles = fillPatternTypeSelect.value === 'rectangles';
  fillRectWidthGroup.hidden = !showRectangles;
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

  showSVG(svgElement);

  const params = result.params || collectParams();
  const geometry = hasGeometry(result.geometry) ? result.geometry : null;
  const mode = result.mode || params?.mode || DEFAULTS.mode;
  const svgString = typeof result.svgString === 'string' && result.svgString.trim().length
    ? result.svgString
    : new XMLSerializer().serializeToString(svgElement);

  lastRender = { params, geometry, mode, svgString };

  updateStats(geometry);
  statMode.textContent = mode === 'arram_boyle' ? 'Arram-Boyle' : 'Classic Doyle';
  setStatus('Spiral updated. Switch views to explore it in 3D.');
  updateExportAvailability(true);

  // Update breakdown workpiece count when breakdown mode is active
  if (breakdownModeCheckbox?.checked) {
    // Engine is not available from worker results; compute synchronously for count
    try {
      const res = renderSpiral({ ...params, mode: 'arram_boyle' }, 'arram_boyle');
      if (res?.engine?.arcGroups) {
        const wpW = Number(workpieceWidthInput?.value) || 100;
        const wpH = Number(workpieceHeightInput?.value) || 100;
        lastRender.engine = res.engine;
        lastRender.scaleFactor = res.scaleFactor;
        const outerRequired = getOuterBoundsRequired(res.engine.arcGroups, res.scaleFactor ?? 1);
        if (outerRequired && (wpW < outerRequired.w || wpH < outerRequired.h)) {
          const needW = Math.ceil(outerRequired.w);
          const needH = Math.ceil(outerRequired.h);
          setStatus(`Workpiece box too small for outermost boundary. Minimum required: ${needW} × ${needH} mm.`, 'error');
          updateBreakdownRingCount(null);
        } else {
          const rings = getBreakdownRings(res.engine.arcGroups, res.scaleFactor ?? 1, wpW, wpH);
          updateBreakdownRingCount(countWorkpieces(res.engine.arcGroups, rings, Boolean(lastRender.params?.add_fill_pattern)));
        }
      }
    } catch (_) {
      updateBreakdownRingCount(null);
    }
  } else {
    updateBreakdownRingCount(null);
  }

  if (threeApp) {
    if (geometry) {
      threeApp.useGeometryFromPayload(params, geometry);
    } else {
      threeApp.queueGeometryUpdate(params, true);
    }
  }
}

function handleRenderFailure(message) {
  svgPreview.innerHTML = '<div class="empty-state">Unable to render spiral.</div>';
  svgPreview.classList.add('empty-state');
  setStatus(message || 'Unexpected error', 'error');
  lastRender = null;
  updateExportAvailability(false);
}

function startRenderJob(params, showLoading) {
  const token = ++currentRenderToken;
  const statusMessage = showLoading ? 'Rendering spiral…' : 'Updating spiral…';
  setStatus(statusMessage, 'loading');

  cancelActiveRenderJob();

  const renderTimeoutMs = getRenderTimeoutMs();

  if (workerSupported && renderWorkerURL && svgParser) {
    const worker = new Worker(renderWorkerURL, { type: 'module' });
    renderWorkerHandle = worker;
    const watchdogId = setTimeout(() => {
      if (activeRenderJob?.handle === worker) {
        terminateRenderWorker();
        activeRenderJob = null;
        const timeoutSeconds = Math.round(renderTimeoutMs / 100) / 10;
        const suggestions = [];
        if (params.p > 32) suggestions.push(`reduce p from ${params.p} to ${Math.floor(params.p / 2)}`);
        if (params.q > 32) suggestions.push(`reduce q from ${params.q} to ${Math.floor(params.q / 2)}`);
        if (params.max_d > 5000) suggestions.push(`reduce max_d from ${params.max_d} to ${Math.floor(params.max_d / 2)}`);
        const suggestionText = suggestions.length > 0
          ? ` Try: ${suggestions.join(', ')}.`
          : ' Try reducing p, q, or max_d parameters.';
        handleRenderFailure(
          `Render cancelled for exceeding the ${timeoutSeconds}s time limit.${suggestionText} ` +
          `Or increase timeout in Advanced settings.`
        );
      }
    }, renderTimeoutMs);
    activeRenderJob = { type: 'worker', requestId: token, handle: worker, timeoutId: watchdogId };

    worker.onmessage = event => {
      const data = event.data || {};
      if (data.requestId !== token) {
        return;
      }
      if (renderWorkerHandle === worker) {
        worker.terminate();
        renderWorkerHandle = null;
      }
      if (activeRenderJob?.handle === worker) {
        if (activeRenderJob.timeoutId) {
          clearTimeout(activeRenderJob.timeoutId);
        }
        activeRenderJob = null;
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
      if (activeRenderJob?.handle === worker) {
        if (activeRenderJob.timeoutId) {
          clearTimeout(activeRenderJob.timeoutId);
        }
        activeRenderJob = null;
      }
      console.error(event?.error || message);
      handleRenderFailure(message);
    };

    worker.postMessage({ type: 'render', requestId: token, params });
    return;
  }

  const timeoutId = setTimeout(() => {
    if (token !== currentRenderToken) {
      return;
    }
    activeRenderJob = null;
    try {
      const result = renderSpiral(params);
      handleRenderSuccess(result);
    } catch (error) {
      console.error(error);
      handleRenderFailure(error.message || 'Unexpected error');
    }
  }, 0);
  activeRenderJob = { type: 'timeout', requestId: token, id: timeoutId };
}

function renderCurrentSpiral(showLoading = true) {
  const params = collectParams();
  startRenderJob(params, showLoading);
}

const debouncedRender = debounce(() => renderCurrentSpiral(false), 200);

// Synchronize p and q inputs when symmetric mode is enabled
function syncPQ(sourceInput, targetInput) {
  if (symmetricToggle && symmetricToggle.checked) {
    targetInput.value = sourceInput.value;
    updateSymmetricHint();
  }
}

// Get p and q inputs for synchronization
const inputP = document.getElementById('inputP');
const inputQ = document.getElementById('inputQ');

// Add individual listeners for p/q synchronization
if (inputP && inputQ) {
  inputP.addEventListener('input', () => syncPQ(inputP, inputQ));
  inputQ.addEventListener('input', () => syncPQ(inputQ, inputP));
}

// When symmetric toggle changes, sync values immediately
if (symmetricToggle && inputP && inputQ) {
  symmetricToggle.addEventListener('change', () => {
    if (symmetricToggle.checked && inputP.value !== inputQ.value) {
      inputQ.value = inputP.value;
      updateSymmetricHint();
      debouncedRender();
    }
  });
}

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
  if (event.target.name === 'p' || event.target.name === 'q' || event.target === symmetricToggle) {
    updateSymmetricHint();
  }
  debouncedRender();
  if (threeApp) {
    threeApp.queueGeometryUpdate(collectParams());
  }
});

form.addEventListener('submit', event => {
  event.preventDefault();
  renderCurrentSpiral(true);
  if (threeApp) {
    threeApp.queueGeometryUpdate(collectParams(), true);
  }
});

// Breakdown mode toggle
if (breakdownModeCheckbox) {
  breakdownModeCheckbox.addEventListener('change', () => {
    updateBreakdownMode();
    debouncedRender();
  });
}
// Re-render when workpiece dimensions change while breakdown mode is active
[workpieceWidthInput, workpieceHeightInput].forEach(el => {
  el?.addEventListener('change', () => {
    if (breakdownModeCheckbox?.checked) debouncedRender();
  });
});
// Init breakdown mode UI state
updateBreakdownMode();

function switchToView(view) {
  if (view === activeView) {
    return;
  }
  activeView = view;
  viewButtons.forEach(btn => {
    const isActive = btn.dataset.view === view;
    btn.classList.toggle('active', isActive);
    btn.setAttribute('aria-pressed', String(isActive));
  });

  view2d.hidden = view !== '2d';
  view3d.hidden = view !== '3d';
  if (viewAnimator) {
    viewAnimator.hidden = view !== 'animator';
  }

  // Hide stats when showing animator
  if (statsBlock) {
    statsBlock.hidden = view === 'animator' || !lastRender?.geometry;
  }

  if (view === '3d') {
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
}

viewButtons.forEach(button => {
  button.addEventListener('click', () => {
    switchToView(button.dataset.view);
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

if (exportDxfButton) {
  exportDxfButton.addEventListener('click', downloadCurrentDxf);
}

if (fillPatternTypeSelect) {
  fillPatternTypeSelect.addEventListener('change', updatePatternTypeVisibility);
}

updateExportAvailability(false);
toggleFillSettings();
updateTValue();
updateSymmetricHint();
renderCurrentSpiral(true);

// ============================================================
// Cellular Automaton Animator
// ============================================================

function createHoneycombHTML(prefix) {
  return `
    <div class="cell-honeycomb">
      <button type="button" class="cell-btn" data-cell="${prefix}-n0" title="Outer">O</button>
      <button type="button" class="cell-btn" data-cell="${prefix}-n1" title="Outer">O</button>
      <button type="button" class="cell-btn" data-cell="${prefix}-n5" title="Left">L</button>
      <button type="button" class="cell-btn" data-cell="${prefix}-center" title="Center">C</button>
      <button type="button" class="cell-btn" data-cell="${prefix}-n2" title="Right">R</button>
      <button type="button" class="cell-btn" data-cell="${prefix}-n4" title="Inner">I</button>
      <button type="button" class="cell-btn" data-cell="${prefix}-n3" title="Inner">I</button>
    </div>
  `;
}

let ruleIdCounter = 0;

function createRuleElement() {
  const ruleId = `rule-${ruleIdCounter++}`;
  const div = document.createElement('div');
  div.className = 'rule-item';
  div.draggable = true;
  div.dataset.ruleId = ruleId;
  div.innerHTML = `
    <div class="rule-item-header">
      <button type="button" class="rule-action-btn duplicate-rule" title="Duplicate">⧉</button>
      <button type="button" class="rule-action-btn remove-rule" title="Remove">×</button>
    </div>
    <div class="rule-container">
      <div class="rule-section">
        <span class="rule-section-label">If</span>
        ${createHoneycombHTML('input')}
      </div>
      <span class="rule-arrow">→</span>
      <div class="rule-section">
        <span class="rule-section-label">Then</span>
        ${createHoneycombHTML('output')}
      </div>
    </div>
  `;
  return div;
}

function createFrameElement(index) {
  const div = document.createElement('div');
  div.className = 'animator-frame';
  div.dataset.frameIndex = index;
  div.innerHTML = `
    <div class="frame-header">
      <span>Frame ${index + 1}</span>
      <div class="frame-header-actions">
        <button type="button" class="frame-action-btn add-rule-btn" title="Add rule">+ Rule</button>
        <button type="button" class="frame-action-btn remove-frame" title="Remove frame">×</button>
      </div>
    </div>
    <div class="frame-rules"></div>
  `;
  // Add one rule by default
  const rulesContainer = div.querySelector('.frame-rules');
  rulesContainer.appendChild(createRuleElement());
  return div;
}

function duplicateRule(ruleElement) {
  const newRule = createRuleElement();
  // Copy the state of all cell buttons
  const originalBtns = ruleElement.querySelectorAll('.cell-btn');
  const newBtns = newRule.querySelectorAll('.cell-btn');
  originalBtns.forEach((btn, idx) => {
    if (btn.classList.contains('active')) {
      newBtns[idx].classList.add('active');
    }
  });
  return newRule;
}

function renumberFrames() {
  if (!animatorFrames) return;
  const frames = animatorFrames.querySelectorAll('.animator-frame');
  frames.forEach((frame, idx) => {
    frame.dataset.frameIndex = idx;
    const header = frame.querySelector('.frame-header > span');
    if (header) {
      header.textContent = `Frame ${idx + 1}`;
    }
  });
}

function addFrame() {
  if (!animatorFrames) return;
  const index = animatorFrames.querySelectorAll('.animator-frame').length;
  const frameEl = createFrameElement(index);
  animatorFrames.appendChild(frameEl);
}

function removeFrame(frameEl) {
  if (!frameEl || !animatorFrames) return;
  frameEl.remove();
  renumberFrames();
}

function clearAllFrames() {
  if (!animatorFrames) return;
  animatorFrames.innerHTML = '';
  ruleIdCounter = 0; // Reset rule counter
}

function setCellState(ruleElement, prefix, center, neighbors) {
  // Set the state of cells in a rule element
  const centerBtn = ruleElement.querySelector(`[data-cell="${prefix}-center"]`);
  if (centerBtn) {
    centerBtn.classList.toggle('active', center);
  }
  neighbors.forEach((isOn, idx) => {
    const btn = ruleElement.querySelector(`[data-cell="${prefix}-n${idx}"]`);
    if (btn) {
      btn.classList.toggle('active', isOn);
    }
  });
}

function loadExampleAnimation() {
  // Clear existing frames
  clearAllFrames();

  // Propagating wave pattern: cells turn ON then OFF, creating a moving wavefront
  // Since neighbors are unordered, we light ALL neighbors to ensure proper propagation

  // Single frame rule: ON cell turns OFF and lights ALL its neighbors
  // This creates an expanding ring/wave that propagates outward from center
  // With ~10-15 rings, this should generate 10-15+ iterations as wave reaches edge
  const frame1 = createFrameElement(0);
  const rule1 = frame1.querySelector('.rule-item');
  if (rule1) {
    // Input: center must be ON (no neighbor requirements)
    setCellState(rule1, 'input', true, [false, false, false, false, false, false]);
    // Output: center turns OFF, ALL neighbors turn ON
    // This creates a propagating wavefront
    setCellState(rule1, 'output', false, [true, true, true, true, true, true]);
  }
  animatorFrames.appendChild(frame1);

  renumberFrames();
}

function collectCellState(ruleElement, prefix) {
  const centerBtn = ruleElement.querySelector(`[data-cell="${prefix}-center"]`);
  const center = centerBtn ? centerBtn.classList.contains('active') : false;
  const neighbors = [0,1,2,3,4,5].map(i => {
    const btn = ruleElement.querySelector(`[data-cell="${prefix}-n${i}"]`);
    return btn ? btn.classList.contains('active') : false;
  });
  return { center, neighbors };
}

function collectFramesAndRules() {
  if (!animatorFrames) return [];
  const frames = [];
  animatorFrames.querySelectorAll('.animator-frame').forEach(frameEl => {
    const rules = [];
    frameEl.querySelectorAll('.rule-item').forEach(ruleEl => {
      const input = collectCellState(ruleEl, 'input');
      const output = collectCellState(ruleEl, 'output');
      rules.push({ input, output });
    });
    if (rules.length > 0) {
      frames.push({ rules });
    }
  });
  return frames;
}

function matchesRule(currentState, ruleInput) {
  // Check if current state matches the rule's input pattern
  // Only check cells that are marked as "must be ON" in the input
  if (ruleInput.center && !currentState.center) return false;
  for (let i = 0; i < 6; i++) {
    if (ruleInput.neighbors[i] && !currentState.neighbors[i]) return false;
  }
  return true;
}

function runCellularAnimation(context, frames, seedIds) {
  // Map: groupId -> boolean (is cell ON)
  let currentState = new Map();
  let nextState = new Map();

  // Initialize all cells to OFF
  context.metaList.forEach(meta => {
    currentState.set(meta.id, false);
    nextState.set(meta.id, false);
  });

  // Track activation angles for rendering (accumulate over iterations)
  const activationAngles = new Map();
  context.metaList.forEach(meta => activationAngles.set(meta.id, []));

  // Seed: turn on selected cells (only if they exist in context)
  let seedsApplied = 0;
  if (seedIds && seedIds.size > 0) {
    seedIds.forEach(id => {
      if (currentState.has(id)) {
        currentState.set(id, true);
        seedsApplied++;
      }
    });
  }

  // Fall back to center ring if no valid seeds
  if (seedsApplied === 0) {
    context.metaList
      .filter(m => m.ringIndex === context.minRing)
      .forEach(m => {
        currentState.set(m.id, true);
        seedsApplied++;
      });
  }

  // Add initial angle to seeds
  for (const [id, isOn] of currentState) {
    if (isOn && activationAngles.has(id)) {
      activationAngles.get(id).push(0);
    }
  }

  let changed = true;
  let iteration = 0;
  const maxIterations = MAX_ANIMATION_FRAMES; // Limit iterations

  while (changed && iteration < maxIterations) {
    changed = false;

    // Get current frame (cycle through frames)
    const frame = frames[iteration % frames.length];
    const rules = frame.rules;

    // Reset next state - cells turn OFF unless a rule lights them up
    context.metaList.forEach(meta => nextState.set(meta.id, false));

    for (const meta of context.metaList) {
      // Get current state of this cell and its neighbors
      const neighbors = Array.from(meta.neighbors).slice(0, 6);
      const cellState = {
        center: currentState.get(meta.id),
        neighbors: neighbors.map(n => n ? currentState.get(n.id) : false)
      };

      // Check each rule in this frame
      for (const rule of rules) {
        if (matchesRule(cellState, rule.input)) {
          // Apply output pattern
          if (rule.output.center) {
            nextState.set(meta.id, true);
            // Add angle if newly lit or need more angles
            const angles = activationAngles.get(meta.id);
            if (angles.length < 4) {
              const newAngle = (iteration * 22.5 + angles.length * 45) % 180;
              if (!angles.some(a => Math.abs(a - newAngle) < 10)) {
                angles.push(newAngle);
              }
            }
          }

          // Light up neighbors according to output pattern
          rule.output.neighbors.forEach((shouldLight, nIdx) => {
            if (shouldLight && neighbors[nIdx]) {
              const neighborId = neighbors[nIdx].id;
              nextState.set(neighborId, true);
              // Add angle to neighbor
              const nAngles = activationAngles.get(neighborId);
              if (nAngles.length < 4) {
                const newAngle = (iteration * 15 + nIdx * 30) % 180;
                if (!nAngles.some(a => Math.abs(a - newAngle) < 10)) {
                  nAngles.push(newAngle);
                }
              }
            }
          });
        }
      }
    }

    // Check if state changed
    for (const meta of context.metaList) {
      if (currentState.get(meta.id) !== nextState.get(meta.id)) {
        changed = true;
        break;
      }
    }

    // Swap states
    [currentState, nextState] = [nextState, currentState];
    iteration++;
  }

  // Convert final state to activations map (empty array = OFF, array with angles = ON)
  const activations = new Map();
  context.metaList.forEach(meta => {
    const isOn = currentState.get(meta.id);
    const angles = activationAngles.get(meta.id);
    activations.set(meta.id, isOn && angles.length > 0 ? angles : []);
  });

  return activations;
}

function loadAnimation() {
  const frames = collectFramesAndRules();

  if (!frames.length) {
    setStatus('Add at least one frame with rules', 'error');
    return;
  }

  // Check if any rule has at least one input condition
  const hasValidRule = frames.some(f =>
    f.rules.some(r => r.input.center || r.input.neighbors.some(n => n))
  );
  if (!hasValidRule) {
    setStatus('Add at least one input condition to a rule', 'error');
    return;
  }

  // Ensure we have a render first
  if (!lastRender || !lastRender.geometry) {
    setStatus('Rendering spiral first...', 'loading');
    renderCurrentSpiral(true);
  }

  // Need the engine to have arcGroups populated - do a fresh render
  const params = collectParams();
  params.add_fill_pattern = true; // Force pattern fill
  const result = renderSpiral(params);

  if (!result || !result.engine || !result.engine.arcGroups) {
    setStatus('Failed to generate geometry for animation', 'error');
    return;
  }

  // Build context and run CA with user-selected seeds
  const context = buildPatternAnimationContext(result.engine.arcGroups);
  const activations = runCellularAnimation(context, frames, selectedSeeds);

  // Apply activations to arc groups - empty array means OFF (no pattern)
  for (const [groupId, angles] of activations) {
    const meta = context.metaList.find(m => m.id === groupId);
    if (meta && meta.group) {
      if (angles.length > 0) {
        meta.group.patternAngles = angles;
        meta.group.primaryPatternAngle = angles[0];
      } else {
        // Cell is OFF - no pattern
        meta.group.patternAngles = [];
        meta.group.primaryPatternAngle = null;
      }
    }
  }

  // Ensure pattern fill is enabled
  if (!fillToggle.checked) {
    fillToggle.checked = true;
    toggleFillSettings();
  }

  // Re-render with updated angles - the engine already has them set
  const svgResult = result.engine.render('arram_boyle', {
    size: params.size,
    debugGroups: false,
    addFillPattern: true,
    fillPatternSpacing: params.fill_pattern_spacing,
    fillPatternAngle: params.fill_pattern_angle,
    fillPatternAnimation: params.fill_pattern_animation,
    redOutline: params.red_outline,
    drawGroupOutline: params.draw_group_outline,
    fillPatternOffset: params.fill_pattern_offset,
    fillPatternType: params.fill_pattern_type,
    fillPatternRectWidth: params.fill_pattern_rect_width,
    highlightRimWidth: params.highlight_rim_width,
    groupOutlineWidth: params.group_outline_width,
    patternStrokeWidth: params.pattern_stroke_width,
    boundingBoxWidth: params.bounding_box_width_mm,
    boundingBoxHeight: params.bounding_box_height_mm,
    lengthUnits: 'mm',
    useSymmetric: params.use_symmetric,
  });

  if (svgResult && svgResult.svg) {
    // Show in animator preview
    const svgClone = svgResult.svg.cloneNode(true);
    svgClone.setAttribute('width', '100%');
    svgClone.setAttribute('height', '100%');
    svgClone.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    if (animatorSvgPreview) {
      animatorSvgPreview.replaceChildren(svgClone);
      animatorSvgPreview.classList.remove('empty-state');
    }

    // Also update main 2D preview
    showSVG(svgResult.svg);
    lastRender = {
      params,
      geometry: svgResult.geometry,
      mode: 'arram_boyle',
      svgString: svgResult.svgString,
      engine: result.engine,
    };
    updateStats(svgResult.geometry);
    statMode.textContent = 'Arram-Boyle';
    setStatus('Animation loaded successfully.');
    updateExportAvailability(true);

    // Update 3D viewer if it exists
    if (threeApp && svgResult.geometry) {
      threeApp.useGeometryFromPayload(params, svgResult.geometry);
    }
  }
}

// Drag and drop state
let draggedRule = null;

// Animator event listeners
if (animatorFrames) {
  // Click handlers
  animatorFrames.addEventListener('click', event => {
    // Handle remove frame button
    const removeFrameBtn = event.target.closest('.remove-frame');
    if (removeFrameBtn) {
      const frame = removeFrameBtn.closest('.animator-frame');
      removeFrame(frame);
      return;
    }

    // Handle add rule button
    const addRuleBtn = event.target.closest('.add-rule-btn');
    if (addRuleBtn) {
      const frame = addRuleBtn.closest('.animator-frame');
      const rulesContainer = frame.querySelector('.frame-rules');
      rulesContainer.appendChild(createRuleElement());
      return;
    }

    // Handle remove rule button
    const removeRuleBtn = event.target.closest('.remove-rule');
    if (removeRuleBtn) {
      const rule = removeRuleBtn.closest('.rule-item');
      rule.remove();
      return;
    }

    // Handle duplicate rule button
    const duplicateBtn = event.target.closest('.duplicate-rule');
    if (duplicateBtn) {
      const rule = duplicateBtn.closest('.rule-item');
      const newRule = duplicateRule(rule);
      rule.parentNode.insertBefore(newRule, rule.nextSibling);
      return;
    }

    // Handle cell button toggle
    const cellBtn = event.target.closest('.cell-btn');
    if (cellBtn) {
      cellBtn.classList.toggle('active');
    }
  });

  // Drag start
  animatorFrames.addEventListener('dragstart', event => {
    const rule = event.target.closest('.rule-item');
    if (rule) {
      draggedRule = rule;
      rule.classList.add('dragging');
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', rule.dataset.ruleId);
    }
  });

  // Drag end
  animatorFrames.addEventListener('dragend', event => {
    if (draggedRule) {
      draggedRule.classList.remove('dragging');
      draggedRule = null;
    }
    // Remove all drag-over highlights
    animatorFrames.querySelectorAll('.drag-over').forEach(el => {
      el.classList.remove('drag-over');
    });
  });

  // Drag over
  animatorFrames.addEventListener('dragover', event => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';

    const rulesContainer = event.target.closest('.frame-rules');
    if (rulesContainer) {
      rulesContainer.classList.add('drag-over');
    }
  });

  // Drag leave
  animatorFrames.addEventListener('dragleave', event => {
    const rulesContainer = event.target.closest('.frame-rules');
    if (rulesContainer && !rulesContainer.contains(event.relatedTarget)) {
      rulesContainer.classList.remove('drag-over');
    }
  });

  // Drop
  animatorFrames.addEventListener('drop', event => {
    event.preventDefault();
    const rulesContainer = event.target.closest('.frame-rules');

    if (rulesContainer && draggedRule) {
      rulesContainer.classList.remove('drag-over');

      // Find drop position
      const ruleItems = Array.from(rulesContainer.querySelectorAll('.rule-item:not(.dragging)'));
      const dropY = event.clientY;

      let insertBefore = null;
      for (const item of ruleItems) {
        const rect = item.getBoundingClientRect();
        if (dropY < rect.top + rect.height / 2) {
          insertBefore = item;
          break;
        }
      }

      if (insertBefore) {
        rulesContainer.insertBefore(draggedRule, insertBefore);
      } else {
        rulesContainer.appendChild(draggedRule);
      }
    }
  });
}

if (addFrameBtn) {
  addFrameBtn.addEventListener('click', addFrame);
}

if (clearFramesBtn) {
  clearFramesBtn.addEventListener('click', clearAllFrames);
}

if (loadAnimationBtn) {
  loadAnimationBtn.addEventListener('click', loadAnimation);
}

// ============================================================
// Seed Selection for Animator
// ============================================================

function updateSeedCount() {
  if (seedCountEl) {
    seedCountEl.textContent = `${selectedSeeds.size} selected`;
  }
}

function toggleSeedSelection(groupId) {
  if (selectedSeeds.has(groupId)) {
    selectedSeeds.delete(groupId);
  } else {
    selectedSeeds.add(groupId);
  }
  updateSeedCount();
  updateSvgSeedHighlights();
}

function updateSvgSeedHighlights() {
  if (!animatorSvgPreview) return;
  const markers = animatorSvgPreview.querySelectorAll('.cell-marker');
  markers.forEach(marker => {
    const groupId = marker.dataset.groupId;
    if (groupId && selectedSeeds.has(groupId)) {
      marker.classList.add('selected');
    } else {
      marker.classList.remove('selected');
    }
  });
}

function createCellOverlay(context, svgEl, scaleFactor) {
  // Get the viewBox of the main SVG to match coordinates
  const viewBox = svgEl.getAttribute('viewBox');
  if (!viewBox) return null;

  const [vbX, vbY, vbWidth, vbHeight] = viewBox.split(/\s+/).map(Number);

  // Create overlay SVG
  const overlay = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  overlay.setAttribute('viewBox', viewBox);
  overlay.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  overlay.classList.add('cell-overlay-svg');

  // Calculate marker size based on viewBox
  const markerRadius = Math.min(vbWidth, vbHeight) * 0.025;

  // Create a marker for each cell at its centroid
  // Apply the same scale factor used by the SVG rendering
  context.metaList.forEach(meta => {
    // Scale centroid coordinates to match SVG coordinate space
    const cx = meta.centroid.x * scaleFactor;
    const cy = meta.centroid.y * scaleFactor;

    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.classList.add('cell-marker');
    g.dataset.groupId = meta.id;

    const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    circle.setAttribute('cx', cx);
    circle.setAttribute('cy', cy);
    circle.setAttribute('r', markerRadius);

    const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    text.setAttribute('x', cx);
    text.setAttribute('y', cy);
    text.setAttribute('text-anchor', 'middle');
    text.setAttribute('dominant-baseline', 'central');
    text.setAttribute('font-size', markerRadius * 0.9);
    text.textContent = meta.ringIndex;

    g.appendChild(circle);
    g.appendChild(text);
    overlay.appendChild(g);
  });

  return overlay;
}

function makeAnimatorSvgInteractive() {
  if (!animatorSvgPreview) return;

  // Render a fresh SVG for the animator
  const params = collectParams();
  const result = renderSpiral(params);

  if (!result || !result.engine || !result.engine.arcGroups) {
    return;
  }

  // Cache the context for later use
  animatorContext = buildPatternAnimationContext(result.engine.arcGroups);

  // Clear existing content
  animatorSvgPreview.innerHTML = '';

  // Render SVG without fill pattern to show just outlines
  const svgResult = result.engine.render('arram_boyle', {
    size: params.size,
    debugGroups: false,
    addFillPattern: false,
    drawGroupOutline: true,
    boundingBoxWidth: params.bounding_box_width_mm,
    boundingBoxHeight: params.bounding_box_height_mm,
    lengthUnits: 'mm',
  });

  if (!svgResult || !svgResult.svg) {
    return;
  }

  const svgClone = svgResult.svg.cloneNode(true);
  svgClone.setAttribute('width', '100%');
  svgClone.setAttribute('height', '100%');
  svgClone.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  animatorSvgPreview.appendChild(svgClone);
  animatorSvgPreview.classList.remove('empty-state');

  // Get the scale factor from the render result
  const scaleFactor = svgResult.scaleFactor || 1;

  // Create and add the cell overlay with the correct scale factor
  if (animatorContext) {
    const overlay = createCellOverlay(animatorContext, svgClone, scaleFactor);
    if (overlay) {
      const overlayContainer = document.createElement('div');
      overlayContainer.className = 'cell-overlay';
      overlayContainer.appendChild(overlay);
      animatorSvgPreview.appendChild(overlayContainer);
    }
  }

  updateSvgSeedHighlights();
}

function selectSeedsByPreset(preset) {
  if (!animatorContext) {
    makeAnimatorSvgInteractive();
  }

  if (!animatorContext) return;

  selectedSeeds.clear();

  if (preset === 'center') {
    animatorContext.metaList
      .filter(m => m.ringIndex === animatorContext.minRing)
      .forEach(m => selectedSeeds.add(m.id));
  } else if (preset === 'outer') {
    animatorContext.metaList
      .filter(m => m.ringIndex === animatorContext.maxRing)
      .forEach(m => selectedSeeds.add(m.id));
  } else if (preset === 'all') {
    animatorContext.metaList.forEach(m => selectedSeeds.add(m.id));
  }
  // 'clear' just clears, which we already did

  updateSeedCount();
  updateSvgSeedHighlights();
}

function refreshAnimatorPreview() {
  // Clear existing overlay
  if (animatorSvgPreview) {
    const existingOverlay = animatorSvgPreview.querySelector('.cell-overlay');
    if (existingOverlay) existingOverlay.remove();
    const existingSvg = animatorSvgPreview.querySelector('svg');
    if (existingSvg) existingSvg.remove();
  }
  animatorContext = null;
  makeAnimatorSvgInteractive();
}

// Handle clicks on animator SVG for seed selection
if (animatorSvgPreview) {
  animatorSvgPreview.addEventListener('click', event => {
    const marker = event.target.closest('.cell-marker');
    if (marker && marker.dataset.groupId) {
      toggleSeedSelection(marker.dataset.groupId);
    }
  });
}

// Handle preset buttons
document.querySelectorAll('.preset-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const preset = btn.dataset.preset;
    selectSeedsByPreset(preset);
  });
});

// Handle refresh button
const refreshAnimatorBtn = document.getElementById('refreshAnimatorBtn');
if (refreshAnimatorBtn) {
  refreshAnimatorBtn.addEventListener('click', refreshAnimatorPreview);
}

// Initialize animator SVG when switching to animator view
let animatorInitialized = false;
const originalSwitchToView = switchToView;
switchToView = function(view) {
  originalSwitchToView(view);
  if (view === 'animator') {
    // Give a small delay for the view to be visible, then make SVG interactive
    setTimeout(() => {
      makeAnimatorSvgInteractive();

      // Load example animation on first visit
      if (!animatorInitialized) {
        animatorInitialized = true;
        loadExampleAnimation();
        // Select center ring as initial seeds
        selectSeedsByPreset('center');
      }
    }, 100);
  }
};

// ============================================================
// Animator Preview Tabs
// ============================================================

let activeAnimatorTab = 'svg';

function switchAnimatorTab(tabName) {
  if (activeAnimatorTab === tabName) return;
  activeAnimatorTab = tabName;

  // Update tab buttons
  animatorTabs.forEach(tab => {
    tab.classList.toggle('active', tab.dataset.animatorView === tabName);
  });

  // Show/hide views
  if (animatorSvgPreview) {
    animatorSvgPreview.hidden = tabName !== 'svg';
  }
  if (animatorFramePreview) {
    animatorFramePreview.hidden = tabName !== 'frames';
    if (tabName === 'frames') {
      renderFramePreviews();
    }
  }
}

// Handle animator tab clicks
animatorTabs.forEach(tab => {
  tab.addEventListener('click', () => {
    switchAnimatorTab(tab.dataset.animatorView);
  });
});

// ============================================================
// Frame Preview Rendering
// ============================================================

const MAX_ANIMATION_FRAMES = 1000;

function simulateCAIterations(context, frames, seedIds, maxIterations = 50) {
  // Cap maxIterations at the global limit
  maxIterations = Math.min(maxIterations, MAX_ANIMATION_FRAMES);
  // Simulate CA and return snapshots at each iteration
  // Returns array of Maps, one for each iteration's state
  const snapshots = [];
  let currentState = new Map();
  let nextState = new Map();

  // Initialize all cells to OFF
  context.metaList.forEach(meta => {
    currentState.set(meta.id, false);
    nextState.set(meta.id, false);
  });

  // Seed: turn on selected cells
  let seedsApplied = 0;
  if (seedIds && seedIds.size > 0) {
    seedIds.forEach(id => {
      if (currentState.has(id)) {
        currentState.set(id, true);
        seedsApplied++;
      }
    });
  }

  // Fall back to center ring if no seeds were applied
  if (seedsApplied === 0) {
    context.metaList
      .filter(m => m.ringIndex === context.minRing)
      .forEach(m => {
        currentState.set(m.id, true);
        seedsApplied++;
      });
  }

  // Save initial state as first snapshot
  snapshots.push(new Map(currentState));

  // Count initial active
  let initialActive = 0;
  for (const [id, isOn] of currentState) {
    if (isOn) initialActive++;
  }
  console.log(`[CA Sim] Initial state: ${initialActive} seed cells active`);

  if (frames.length === 0) return snapshots;

  let changed = true;
  let iteration = 0;

  // Run CA and capture state at each iteration
  while (changed && iteration < maxIterations) {
    changed = false;

    // Cycle through the frames
    const frame = frames[iteration % frames.length];
    const rules = frame.rules;

    // Reset next state - cells turn OFF unless a rule lights them up
    context.metaList.forEach(meta => nextState.set(meta.id, false));

    for (const meta of context.metaList) {
      const neighbors = Array.from(meta.neighbors).slice(0, 6);
      const cellState = {
        center: currentState.get(meta.id),
        neighbors: neighbors.map(n => n ? currentState.get(n.id) : false)
      };

      for (const rule of rules) {
        if (matchesRule(cellState, rule.input)) {
          if (rule.output.center) {
            nextState.set(meta.id, true);
          }
          rule.output.neighbors.forEach((shouldLight, nIdx) => {
            if (shouldLight && neighbors[nIdx]) {
              nextState.set(neighbors[nIdx].id, true);
            }
          });
        }
      }
    }

    // Check if state changed
    for (const meta of context.metaList) {
      if (currentState.get(meta.id) !== nextState.get(meta.id)) {
        changed = true;
        break;
      }
    }

    // Swap states
    [currentState, nextState] = [nextState, currentState];

    // Count active cells
    let activeCount = 0;
    for (const [id, isOn] of currentState) {
      if (isOn) activeCount++;
    }

    // Save snapshot of this iteration
    snapshots.push(new Map(currentState));
    iteration++;

    console.log(`[CA Sim] Iteration ${iteration}: ${activeCount} active cells, changed=${changed}`);
  }

  console.log(`[CA Sim] Stopped after ${iteration} iterations. Changed=${changed}`);
  return snapshots;
}

function renderFramePreviewSvg(activatedIds, params) {
  // Ensure we have valid spiral parameters
  const safeParams = {
    ...params,
    p: params.p || 16,
    q: params.q || 16,
    debug_groups: false,
    add_fill_pattern: false,
    draw_group_outline: true,
    size: params.size || 200, // Smaller size for previews
  };

  // Render a minimal spiral without debug colors - we'll add our own colors
  const result = renderSpiral(safeParams);

  if (!result || !result.svg || !result.engine) return null;

  // Create a fresh SVG with custom coloring based on activation
  const svgEl = result.svg;
  const width = svgEl.getAttribute('width');
  const height = svgEl.getAttribute('height');
  const viewBox = svgEl.getAttribute('viewBox');

  // Create new SVG element
  const newSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  newSvg.setAttribute('width', width);
  newSvg.setAttribute('height', height);
  if (viewBox) newSvg.setAttribute('viewBox', viewBox);
  newSvg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');

  // Render each group with the appropriate color
  for (const [key, group] of result.engine.arcGroups.entries()) {
    if (key.startsWith('outer_')) continue;

    const isActivated = activatedIds.has(key);
    const fillColor = isActivated ? '#D4AF37' : '#E2E8F0'; // Golden or light gray
    const fillOpacity = isActivated ? 0.85 : 0.3;
    const strokeColor = isActivated ? '#8B6914' : '#94A3B8';
    const strokeWidth = isActivated ? 1.2 : 0.4;

    // Get the group outline path
    const outline = group.getOutline();
    if (!outline || outline.length === 0) continue;

    // Build path data from outline
    let pathData = '';
    for (const segment of outline) {
      if (segment.type === 'arc') {
        const { start, end, radius, largeArc, sweep } = segment;
        if (pathData === '') {
          pathData = `M ${start.x} ${start.y}`;
        }
        pathData += ` A ${radius} ${radius} 0 ${largeArc ? 1 : 0} ${sweep ? 1 : 0} ${end.x} ${end.y}`;
      } else if (segment.type === 'line') {
        const { start, end } = segment;
        if (pathData === '') {
          pathData = `M ${start.x} ${start.y}`;
        }
        pathData += ` L ${end.x} ${end.y}`;
      }
    }
    if (pathData) {
      pathData += ' Z';
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', pathData);
      path.setAttribute('fill', fillColor);
      path.setAttribute('fill-opacity', fillOpacity.toString());
      path.setAttribute('stroke', strokeColor);
      path.setAttribute('stroke-width', strokeWidth.toString());
      newSvg.appendChild(path);
    }
  }

  return { svg: newSvg };
}

function renderFramePreviews() {
  if (!animatorFramePreview) return;

  const scrollContainer = animatorFramePreview.querySelector('.frame-preview-scroll');
  if (!scrollContainer) return;

  // Clear existing previews
  scrollContainer.innerHTML = '';

  const frames = collectFramesAndRules();
  if (!frames.length) {
    scrollContainer.innerHTML = '<div class="empty-state" style="padding: 2rem; color: var(--text-muted);">Add frames to see preview</div>';
    return;
  }

  const params = collectParams();

  // Render a reference spiral to get the context
  const result = renderSpiral(params);
  if (!result || !result.engine || !result.engine.arcGroups) {
    scrollContainer.innerHTML = '<div class="empty-state" style="padding: 2rem; color: var(--text-muted);">Failed to generate geometry</div>';
    return;
  }

  const context = buildPatternAnimationContext(result.engine.arcGroups);

  // Build a set of valid IDs from this context
  const validIds = new Set(context.metaList.map(m => m.id));

  // Determine initial seeds - use selectedSeeds if they match this context, otherwise use center ring
  const seedsForSimulation = new Set();
  let usedSelectedSeeds = false;

  if (selectedSeeds.size > 0) {
    for (const id of selectedSeeds) {
      if (validIds.has(id)) {
        seedsForSimulation.add(id);
        usedSelectedSeeds = true;
      }
    }
  }

  // Fall back to center ring if no valid seeds found
  if (!usedSelectedSeeds || seedsForSimulation.size === 0) {
    context.metaList
      .filter(m => m.ringIndex === context.minRing)
      .forEach(m => seedsForSimulation.add(m.id));
  }

  // Run CA simulation and get snapshots at each iteration
  console.log(`[Frame Preview] Starting CA simulation with ${frames.length} rule frames, ${seedsForSimulation.size} seeds`);
  frames.forEach((f, i) => {
    console.log(`[Frame Preview] Frame ${i}: ${f.rules.length} rules`);
    f.rules.forEach((r, j) => {
      console.log(`  Rule ${j}: input.center=${r.input.center}, input.neighbors=${r.input.neighbors}, output.center=${r.output.center}, output.neighbors=${r.output.neighbors}`);
    });
  });

  const snapshots = simulateCAIterations(context, frames, seedsForSimulation, 100);
  console.log(`[Frame Preview] Generated ${snapshots.length} iteration snapshots from ${frames.length} rule frames`);

  // Show frame count in the UI for testing
  const countDisplay = document.createElement('div');
  countDisplay.style.cssText = 'position:fixed;top:10px;right:10px;background:black;color:lime;padding:10px;z-index:9999;font-family:monospace;';
  countDisplay.textContent = `Frames: ${snapshots.length}`;
  document.body.appendChild(countDisplay);
  setTimeout(() => countDisplay.remove(), 5000);

  // Render each iteration as a frame preview
  snapshots.forEach((stateMap, iterationIndex) => {
    const frameItem = document.createElement('div');
    frameItem.className = 'frame-preview-item';

    // Convert Map to Set of activated IDs
    const activatedIds = new Set();
    for (const [id, isOn] of stateMap) {
      if (isOn) activatedIds.add(id);
    }

    const frameSvg = renderFramePreviewSvg(activatedIds, params);

    // Show which rule frame is being applied at this iteration
    const ruleFrameIndex = iterationIndex > 0 ? ((iterationIndex - 1) % frames.length) + 1 : 0;
    const label = iterationIndex === 0 ? 'Initial' : `Iter ${iterationIndex}`;
    const ruleInfo = iterationIndex === 0 ? 'Seeds' : `Rule ${ruleFrameIndex}`;

    frameItem.innerHTML = `
      <div class="frame-preview-header">${label}</div>
      <div class="frame-preview-svg"></div>
      <div class="frame-preview-info">${activatedIds.size} cells | ${ruleInfo}</div>
    `;

    if (frameSvg && frameSvg.svg) {
      const svgClone = frameSvg.svg.cloneNode(true);
      svgClone.setAttribute('preserveAspectRatio', 'xMidYMid meet');
      frameItem.querySelector('.frame-preview-svg').appendChild(svgClone);
    }

    scrollContainer.appendChild(frameItem);
  });
}

// ============================================================
// Bulk Export
// ============================================================
const bulkStartBtn      = document.getElementById('bulkStartBtn');
const bulkCancelBtn     = document.getElementById('bulkCancelBtn');
const bulkPMin          = document.getElementById('bulkPMin');
const bulkPMax          = document.getElementById('bulkPMax');
const bulkQMin          = document.getElementById('bulkQMin');
const bulkQMax          = document.getElementById('bulkQMax');
const bulkDiagonal      = document.getElementById('bulkDiagonal');
const bulkExportSvg     = document.getElementById('bulkExportSvg');
const bulkExportDxf     = document.getElementById('bulkExportDxf');
const bulkProgress      = document.getElementById('bulkProgress');
const bulkProgressLabel = document.getElementById('bulkProgressLabel');
const bulkProgressCount = document.getElementById('bulkProgressCount');
const bulkProgressBar   = document.getElementById('bulkProgressBar');
const bulkLogEl         = document.getElementById('bulkLog');
const bulkQRangeRow     = document.getElementById('bulkQRangeRow');

let bulkCancelled = false;

function bulkLogLine(msg) {
  const d = document.createElement('div');
  d.textContent = msg;
  bulkLogEl.appendChild(d);
  bulkLogEl.scrollTop = bulkLogEl.scrollHeight;
}

function updateBulkProgress(done, total, text) {
  bulkProgressLabel.textContent = text;
  bulkProgressCount.textContent = `${done} / ${total}`;
  bulkProgressBar.style.width = total > 0 ? `${Math.round(done / total * 100)}%` : '0%';
}

function buildPairList() {
  const pMin = Math.max(2, Math.min(128, Number(bulkPMin.value) || 2));
  const pMax = Math.max(pMin, Math.min(128, Number(bulkPMax.value) || 16));
  if (bulkDiagonal.checked) {
    return Array.from({ length: pMax - pMin + 1 }, (_, i) => ({ p: pMin + i, q: pMin + i }));
  }
  const qMin = Math.max(2, Math.min(256, Number(bulkQMin.value) || 2));
  const qMax = Math.max(qMin, Math.min(256, Number(bulkQMax.value) || 16));
  const pairs = [];
  for (let p = pMin; p <= pMax; p++)
    for (let q = qMin; q <= qMax; q++)
      pairs.push({ p, q });
  return pairs;
}

function bulkYield() { return new Promise(r => setTimeout(r, 0)); }

async function runBulkExport() {
  const pairs = buildPairList();
  if (!pairs.length) { bulkLogLine('Nothing to export — check your range.'); return; }
  const wantSvg = bulkExportSvg.checked;
  const wantDxf = bulkExportDxf.checked;
  if (!wantSvg && !wantDxf) { bulkLogLine('Select at least one format.'); return; }

  const baseParams = collectParams();

  bulkCancelled = false;
  bulkStartBtn.hidden = true;
  bulkCancelBtn.hidden = false;
  bulkCancelBtn.disabled = false;
  bulkCancelBtn.textContent = 'Cancel';
  bulkProgress.hidden = false;
  bulkLogEl.innerHTML = '';
  updateBulkProgress(0, pairs.length, `Starting — ${pairs.length} spiral(s)…`);

  const zip = new JSZip(); // eslint-disable-line no-undef
  let added = 0;

  for (let i = 0; i < pairs.length; i++) {
    if (bulkCancelled) { bulkLogLine(`Cancelled after ${i} / ${pairs.length}.`); break; }
    const { p, q } = pairs[i];
    const label = `p=${p}, q=${q}`;
    updateBulkProgress(i, pairs.length, `Rendering ${label}…`);
    bulkLogLine(`${label}…`);

    let result;
    try { result = renderSpiral({ ...baseParams, p, q }); }
    catch (err) { bulkLogLine(`  ERROR: ${err.message}`); await bulkYield(); continue; }

    const name = `doyle_p${p}_q${q}`;
    const hasGroups = (result.engine?.arcGroups?.size ?? 0) > 0;
    if (!hasGroups) {
      bulkLogLine(`  SKIPPED — no geometry produced`);
      await bulkYield();
      continue;
    }

    if (wantSvg && result.svgString) {
      zip.file(`${name}.svg`, result.svgString);
      bulkLogLine(`  + ${name}.svg`);
      added++;
    }
    if (wantDxf) {
      const { bounding_box_width_mm: bbW, bounding_box_height_mm: bbH,
              draw_group_outline, red_outline } = baseParams;
      const dxf = generateDXF(result.engine.arcGroups, result.scaleFactor ?? 1, bbW, bbH,
        { drawGroupOutline: draw_group_outline !== false, redOutline: Boolean(red_outline) });
      zip.file(`${name}.dxf`, dxf);
      bulkLogLine(`  + ${name}.dxf`);
      added++;
    }

    updateBulkProgress(i + 1, pairs.length, `${i + 1} / ${pairs.length} rendered`);
    await bulkYield();
  }

  if (bulkCancelled) {
    bulkStartBtn.hidden = false;
    bulkCancelBtn.hidden = true;
    return;
  }

  if (added === 0) {
    bulkLogLine('Nothing to zip — all pairs were skipped.');
    bulkStartBtn.hidden = false;
    bulkCancelBtn.hidden = true;
    return;
  }

  updateBulkProgress(pairs.length, pairs.length, 'Generating zip…');
  bulkLogLine(`Generating zip with ${added} file(s)…`);

  const zipBlob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } });
  const url = URL.createObjectURL(zipBlob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'doyle_bulk_export.zip';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  updateBulkProgress(pairs.length, pairs.length, `Done — ${added} file(s) in zip.`);
  bulkLogLine(`↓ doyle_bulk_export.zip (${added} file(s))`);

  bulkStartBtn.hidden = false;
  bulkCancelBtn.hidden = true;
}

bulkStartBtn?.addEventListener('click', runBulkExport);
bulkCancelBtn?.addEventListener('click', () => {
  bulkCancelled = true;
  bulkCancelBtn.disabled = true;
  bulkCancelBtn.textContent = 'Cancelling…';
});
bulkDiagonal?.addEventListener('change', () => {
  if (bulkQRangeRow) bulkQRangeRow.hidden = bulkDiagonal.checked;
});
