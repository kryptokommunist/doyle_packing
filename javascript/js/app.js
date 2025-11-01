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
const animationPanel = document.getElementById('animationPanel');
const animationStatus = document.getElementById('animationStatus');
const animationHexHost = document.getElementById('animationHexHost');
const animationFramesContainer = document.getElementById('animationFrames');
const addAnimationFrameButton = document.getElementById('addAnimationFrame');
const selectAllArcgroupsButton = document.getElementById('selectAllArcgroups');
const clearArcgroupSelectionButton = document.getElementById('clearArcgroupSelection');
const applyRadialSelectionButton = document.getElementById('applyRadialSelection');
const radialRepeatInput = document.getElementById('radialRepeat');
const radialWidthInput = document.getElementById('radialWidth');
const runAnimationButton = document.getElementById('runAnimation');
const selectionStatsElement = document.getElementById('selectionStats');

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
  fill_pattern_type: 'lines',
  fill_pattern_rect_width: 2,
};

let activeView = '2d';
let lastRender = null;
let threeApp = null;
const workerSupported = typeof Worker !== 'undefined';
const renderWorkerURL = workerSupported ? new URL('./render_worker.js', import.meta.url) : null;
let renderWorkerHandle = null;
let currentRenderToken = 0;
const svgParser = typeof DOMParser !== 'undefined' ? new DOMParser() : null;
const SVG_NS = 'http://www.w3.org/2000/svg';

let selectionState = new Map();
let overlayElements = new Map();
let arcgroupMetadata = { byId: new Map(), rings: new Map() };
let frameIdCounter = 0;
let animationFrames = [];
let selectedFrameId = null;
let hexDiagram = null;
let animationTimer = null;
let animationRunning = false;
let baseRenderSnapshot = null;
let baseLineAngles = new Map();
let animationOverridesActive = false;
let currentFrameActive = new Set();
let currentAnimationFrameIndex = 0;

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

function setAnimationStatus(message, state = 'idle') {
  if (!animationStatus) {
    return;
  }
  animationStatus.textContent = message;
  animationStatus.classList.remove('loading', 'error');
  if (state !== 'idle') {
    animationStatus.classList.add(state);
  }
}

function computeCentroid(outline) {
  if (!Array.isArray(outline) || !outline.length) {
    return { x: 0, y: 0 };
  }
  let sumX = 0;
  let sumY = 0;
  let count = 0;
  for (const point of outline) {
    if (!Array.isArray(point) || point.length < 2) {
      continue;
    }
    const x = Number(point[0]) || 0;
    const y = Number(point[1]) || 0;
    sumX += x;
    sumY += y;
    count += 1;
  }
  if (!count) {
    return { x: 0, y: 0 };
  }
  return { x: sumX / count, y: sumY / count };
}

function pathDataFromOutline(outline) {
  if (!Array.isArray(outline) || !outline.length) {
    return '';
  }
  const commands = [];
  outline.forEach((point, index) => {
    if (!Array.isArray(point) || point.length < 2) {
      return;
    }
    const x = Number(point[0]) || 0;
    const y = Number(point[1]) || 0;
    commands.push(`${index === 0 ? 'M' : 'L'}${x.toFixed(4)},${y.toFixed(4)}`);
  });
  commands.push('Z');
  return commands.join(' ');
}

function createHexPoints(cx, cy, radius) {
  const points = [];
  for (let i = 0; i < 6; i += 1) {
    const angle = (Math.PI / 180) * (60 * i - 30);
    const x = cx + radius * Math.cos(angle);
    const y = cy + radius * Math.sin(angle);
    points.push(`${x.toFixed(2)},${y.toFixed(2)}`);
  }
  return points.join(' ');
}

function buildHexDiagram() {
  if (!animationHexHost) {
    return;
  }
  animationHexHost.innerHTML = '';
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '-80 -80 160 160');
  svg.setAttribute('class', 'hex-diagram');
  const radius = 20;
  const offsetX = Math.sqrt(3) * radius;
  const offsetY = 1.5 * radius;
  const cells = [
    { node: 'center', cx: 0, cy: 0 },
    { node: '0', cx: offsetX, cy: 0 },
    { node: '1', cx: offsetX / 2, cy: offsetY },
    { node: '2', cx: -offsetX / 2, cy: offsetY },
    { node: '3', cx: -offsetX, cy: 0 },
    { node: '4', cx: -offsetX / 2, cy: -offsetY },
    { node: '5', cx: offsetX / 2, cy: -offsetY },
  ];
  cells.forEach(cell => {
    const polygon = document.createElementNS(SVG_NS, 'polygon');
    polygon.setAttribute('points', createHexPoints(cell.cx, cell.cy, radius));
    polygon.dataset.node = cell.node;
    polygon.addEventListener('click', handleHexCellClick);
    svg.appendChild(polygon);
  });
  animationHexHost.appendChild(svg);
  hexDiagram = svg;
  updateHexDiagram();
}

function updateHexDiagram() {
  if (!hexDiagram) {
    return;
  }
  const frame = getSelectedFrame();
  hexDiagram.querySelectorAll('polygon').forEach(polygon => {
    polygon.classList.remove('is-active', 'is-high');
    if (!frame) {
      return;
    }
    const node = polygon.dataset.node || '';
    if (node === 'center') {
      if (frame.centerActive) {
        polygon.classList.add('is-high');
      }
      return;
    }
    const idx = Number(node);
    if (Number.isInteger(idx) && frame.neighbours[idx]) {
      polygon.classList.add('is-active');
    }
  });
}

function createFrame({ centerActive = false, neighbours = null, duration = 600 } = {}) {
  const baseNeighbours = Array.isArray(neighbours) ? neighbours.slice(0, 6) : [];
  while (baseNeighbours.length < 6) {
    baseNeighbours.push(false);
  }
  frameIdCounter += 1;
  return {
    id: frameIdCounter,
    centerActive: Boolean(centerActive),
    neighbours: baseNeighbours.map(value => Boolean(value)),
    duration: Math.max(50, Number(duration) || 600),
  };
}

function getSelectedFrame() {
  if (!selectedFrameId) {
    return null;
  }
  return animationFrames.find(frame => frame.id === selectedFrameId) || null;
}

function renderFrameList() {
  if (!animationFramesContainer) {
    return;
  }
  animationFramesContainer.innerHTML = '';
  animationFrames.forEach((frame, index) => {
    const card = document.createElement('div');
    card.className = 'frame-card';
    card.dataset.frameId = String(frame.id);
    if (frame.id === selectedFrameId) {
      card.classList.add('active');
    }

    const header = document.createElement('header');
    const title = document.createElement('h4');
    title.textContent = `Frame ${index + 1}`;
    header.appendChild(title);
    const removeButton = document.createElement('button');
    removeButton.type = 'button';
    removeButton.className = 'secondary';
    removeButton.dataset.action = 'remove-frame';
    removeButton.dataset.frameId = String(frame.id);
    removeButton.textContent = 'Remove';
    removeButton.disabled = animationFrames.length <= 1;
    header.appendChild(removeButton);
    card.appendChild(header);

    const meta = document.createElement('div');
    meta.className = 'frame-meta';

    const centerLabel = document.createElement('label');
    const centerToggle = document.createElement('input');
    centerToggle.type = 'checkbox';
    centerToggle.className = 'frame-center-toggle';
    centerToggle.dataset.frameId = String(frame.id);
    centerToggle.checked = frame.centerActive;
    centerLabel.appendChild(centerToggle);
    centerLabel.appendChild(document.createTextNode('Center active'));
    meta.appendChild(centerLabel);

    const neighbourGrid = document.createElement('div');
    neighbourGrid.className = 'neighbor-toggle-grid';
    frame.neighbours.forEach((value, idx) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'neighbor-toggle';
      if (value) {
        btn.classList.add('active');
      }
      btn.dataset.frameId = String(frame.id);
      btn.dataset.neighbourIndex = String(idx);
      btn.textContent = `N${idx + 1}`;
      neighbourGrid.appendChild(btn);
    });
    meta.appendChild(neighbourGrid);

    const durationLabel = document.createElement('label');
    durationLabel.textContent = 'Duration (ms)';
    const durationInput = document.createElement('input');
    durationInput.type = 'number';
    durationInput.min = '50';
    durationInput.step = '10';
    durationInput.value = String(frame.duration);
    durationInput.dataset.frameId = String(frame.id);
    durationInput.className = 'frame-duration';
    durationLabel.appendChild(durationInput);
    meta.appendChild(durationLabel);

    card.appendChild(meta);
    animationFramesContainer.appendChild(card);
  });
}

function selectFrame(frameId) {
  if (!Number.isInteger(frameId)) {
    return;
  }
  if (!animationFrames.some(frame => frame.id === frameId)) {
    return;
  }
  selectedFrameId = frameId;
  renderFrameList();
  updateHexDiagram();
}

function addNewFrame() {
  const template = getSelectedFrame() || animationFrames[animationFrames.length - 1] || null;
  const frame = createFrame({
    centerActive: template ? template.centerActive : false,
    neighbours: template ? template.neighbours : Array(6).fill(false),
    duration: template ? template.duration : 600,
  });
  animationFrames.push(frame);
  selectedFrameId = frame.id;
  renderFrameList();
  updateHexDiagram();
  stopAnimationLoop();
}

function removeFrame(frameId) {
  if (animationFrames.length <= 1) {
    return;
  }
  const index = animationFrames.findIndex(frame => frame.id === frameId);
  if (index === -1) {
    return;
  }
  animationFrames.splice(index, 1);
  if (selectedFrameId === frameId) {
    const fallback = animationFrames[Math.max(0, index - 1)] || animationFrames[0] || null;
    selectedFrameId = fallback ? fallback.id : null;
  }
  renderFrameList();
  updateHexDiagram();
  stopAnimationLoop();
}

function handleFrameListClick(event) {
  const target = event.target;
  if (!target) {
    return;
  }
  if (target.dataset.action === 'remove-frame') {
    const frameId = Number(target.dataset.frameId);
    if (Number.isInteger(frameId)) {
      removeFrame(frameId);
    }
    return;
  }
  if (target.classList.contains('neighbor-toggle')) {
    const frameId = Number(target.dataset.frameId);
    const neighbourIndex = Number(target.dataset.neighbourIndex);
    const frame = animationFrames.find(item => item.id === frameId);
    if (frame && Number.isInteger(neighbourIndex) && neighbourIndex >= 0 && neighbourIndex < frame.neighbours.length) {
      frame.neighbours[neighbourIndex] = !frame.neighbours[neighbourIndex];
      selectedFrameId = frameId;
      stopAnimationLoop();
      renderFrameList();
      updateHexDiagram();
    }
    return;
  }
  const card = target.closest('.frame-card');
  if (card) {
    const frameId = Number(card.dataset.frameId);
    if (Number.isInteger(frameId) && frameId !== selectedFrameId) {
      selectFrame(frameId);
    }
  }
}

function handleFrameListInput(event) {
  const target = event.target;
  if (!target) {
    return;
  }
  const frameId = Number(target.dataset.frameId);
  const frame = animationFrames.find(item => item.id === frameId);
  if (!frame) {
    return;
  }
  if (target.classList.contains('frame-duration')) {
    const value = Math.max(50, Number(target.value) || 600);
    frame.duration = value;
  } else if (target.classList.contains('frame-center-toggle')) {
    frame.centerActive = target.checked;
  }
  selectedFrameId = frameId;
  stopAnimationLoop();
  renderFrameList();
  updateHexDiagram();
}

function handleHexCellClick(event) {
  event.preventDefault();
  const target = event.currentTarget;
  if (!target) {
    return;
  }
  const frame = getSelectedFrame();
  if (!frame) {
    return;
  }
  const node = target.dataset.node || '';
  stopAnimationLoop();
  if (node === 'center') {
    frame.centerActive = !frame.centerActive;
  } else {
    const index = Number(node);
    if (Number.isInteger(index) && index >= 0 && index < frame.neighbours.length) {
      frame.neighbours[index] = !frame.neighbours[index];
    }
  }
  renderFrameList();
  updateHexDiagram();
}

function computeArcgroupMetadata(geometry) {
  const metadata = { byId: new Map(), rings: new Map() };
  if (!geometry || !Array.isArray(geometry.arcgroups)) {
    return metadata;
  }
  const ringBuckets = new Map();
  geometry.arcgroups.forEach(group => {
    const outline = Array.isArray(group.outline) ? group.outline : [];
    const centroid = computeCentroid(outline);
    const angle = Math.atan2(centroid.y, centroid.x);
    const ringIndex = Number.isFinite(group.ring_index) ? group.ring_index : 0;
    const entry = {
      id: group.id,
      ringIndex,
      centroid,
      angle,
      neighbours: Array.isArray(group.neighbours) ? group.neighbours.map(Number) : [],
      angularIndex: 0,
      lineAngle: Number.isFinite(group.line_angle) ? Number(group.line_angle) : 0,
      baseLineAngle: Number.isFinite(group.base_line_angle)
        ? Number(group.base_line_angle)
        : (Number.isFinite(group.line_angle) ? Number(group.line_angle) : 0),
    };
    metadata.byId.set(group.id, entry);
    if (!ringBuckets.has(ringIndex)) {
      ringBuckets.set(ringIndex, []);
    }
    ringBuckets.get(ringIndex).push(entry);
  });
  ringBuckets.forEach((entries, ringIndex) => {
    entries.sort((a, b) => a.angle - b.angle);
    entries.forEach((entry, index) => {
      entry.angularIndex = index;
    });
    metadata.rings.set(ringIndex, entries.map(entry => entry.id));
  });
  return metadata;
}

function clearOverlayLayer(svgElement) {
  if (!svgElement) {
    return;
  }
  const existing = svgElement.querySelector('[data-interaction-layer]');
  if (existing) {
    existing.remove();
  }
}

function handleArcgroupClick(event) {
  event.preventDefault();
  const target = event.currentTarget;
  if (!target) {
    return;
  }
  const id = Number(target.dataset.arcgroupId);
  if (!Number.isFinite(id)) {
    return;
  }
  cycleSelectionState(id);
}

function prepareSvgInteractions(svgElement, geometry, options = {}) {
  const {
    preserveAnimation = false,
    suppressStatus = false,
    activeFrameSet = null,
  } = options;
  overlayElements.forEach(element => {
    element.removeEventListener('click', handleArcgroupClick);
  });
  overlayElements = new Map();
  clearOverlayLayer(svgElement);
  if (activeFrameSet instanceof Set) {
    currentFrameActive = new Set(activeFrameSet);
  } else if (!preserveAnimation) {
    currentFrameActive = new Set();
  }

  if (!svgElement || !geometry || !Array.isArray(geometry.arcgroups) || !geometry.arcgroups.length) {
    arcgroupMetadata = { byId: new Map(), rings: new Map() };
    selectionState = new Map();
    updateSelectionHighlights(currentFrameActive);
    updateSelectionStats();
    pushSelectionStateToViewer();
    pushFrameActiveToViewer(currentFrameActive);
    if (!suppressStatus) {
      setAnimationStatus('Animation controls require Arram-Boyle arcgroups.', 'error');
    }
    setOverlayInteractivity(false);
    return;
  }

  if (!preserveAnimation) {
    stopAnimationLoop({ restoreBase: false });
  }
  arcgroupMetadata = computeArcgroupMetadata(geometry);
  const nextSelection = new Map();
  arcgroupMetadata.byId.forEach((_, id) => {
    if (selectionState.has(id)) {
      nextSelection.set(id, selectionState.get(id));
    }
  });
  selectionState = nextSelection;

  if (currentFrameActive.size) {
    const filtered = new Set();
    currentFrameActive.forEach(id => {
      if (arcgroupMetadata.byId.has(id)) {
        filtered.add(id);
      }
    });
    currentFrameActive = filtered;
  }

  const layer = document.createElementNS(SVG_NS, 'g');
  layer.setAttribute('data-interaction-layer', 'true');

  geometry.arcgroups.forEach(group => {
    const id = Number(group.id);
    if (!Number.isFinite(id)) {
      return;
    }
    const pathData = pathDataFromOutline(group.outline || []);
    if (!pathData) {
      return;
    }
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', pathData);
    path.setAttribute('fill', 'transparent');
    path.setAttribute('stroke', 'transparent');
    path.setAttribute('class', 'arcgroup-hit');
    path.dataset.arcgroupId = String(id);
    path.addEventListener('click', handleArcgroupClick);
    layer.appendChild(path);
    overlayElements.set(id, path);
  });

  svgElement.appendChild(layer);
  setOverlayInteractivity(activeView === 'animation');
  updateSelectionHighlights(currentFrameActive);
  updateSelectionStats();
  pushSelectionStateToViewer();
  pushFrameActiveToViewer(currentFrameActive);
  if (!suppressStatus) {
    setAnimationStatus(selectionState.size ? 'Ready to animate.' : 'Select arcgroups to begin.');
  }
}

function updateSelectionHighlights(activeSet = currentFrameActive) {
  overlayElements.forEach((element, id) => {
    element.classList.remove('state-selected', 'state-active', 'frame-active');
    const state = selectionState.get(id);
    if (state === 'selected' || state === 'active') {
      element.classList.add('state-selected');
    }
    if (state === 'active') {
      element.classList.add('state-active');
    }
    if (activeSet && activeSet.has(id)) {
      element.classList.add('frame-active');
    }
  });
}

function setOverlayInteractivity(enabled) {
  overlayElements.forEach(element => {
    element.style.pointerEvents = enabled ? 'auto' : 'none';
  });
}

function updateSelectionStats() {
  if (!selectionStatsElement) {
    return;
  }
  const totalSelected = Array.from(selectionState.values()).filter(value => value === 'selected' || value === 'active').length;
  const totalActive = Array.from(selectionState.values()).filter(value => value === 'active').length;
  if (!lastRender || !hasGeometry(lastRender.geometry)) {
    selectionStatsElement.textContent = 'No arcgroups available.';
    return;
  }
  if (!totalSelected) {
    selectionStatsElement.textContent = 'No arcgroups selected.';
    return;
  }
  let message = `${totalSelected} arcgroup${totalSelected === 1 ? '' : 's'} selected`;
  if (totalActive) {
    message += `, ${totalActive} high`;
  }
  selectionStatsElement.textContent = `${message}.`;
}

function cycleSelectionState(groupId) {
  if (!Number.isInteger(groupId)) {
    return;
  }
  const current = selectionState.get(groupId) || 'none';
  let next;
  if (current === 'none') {
    next = 'selected';
  } else if (current === 'selected') {
    next = 'active';
  } else {
    next = 'none';
  }
  if (next === 'none') {
    selectionState.delete(groupId);
  } else {
    selectionState.set(groupId, next);
  }
  stopAnimationLoop();
  updateSelectionHighlights();
  updateSelectionStats();
  pushSelectionStateToViewer();
  setAnimationStatus(selectionState.size ? 'Ready to animate.' : 'Select arcgroups to begin.');
}

function selectAllArcgroups() {
  if (!arcgroupMetadata || !arcgroupMetadata.byId.size) {
    return;
  }
  arcgroupMetadata.byId.forEach((_, id) => {
    const current = selectionState.get(id);
    if (current !== 'active') {
      selectionState.set(id, 'selected');
    }
  });
  stopAnimationLoop();
  updateSelectionHighlights();
  updateSelectionStats();
  pushSelectionStateToViewer();
  setAnimationStatus('All arcgroups selected.', 'idle');
}

function clearArcgroupSelection() {
  if (!selectionState.size) {
    return;
  }
  selectionState.clear();
  stopAnimationLoop();
  updateSelectionHighlights();
  updateSelectionStats();
  pushSelectionStateToViewer();
  setAnimationStatus('Selection cleared.', 'idle');
}

function applyRadialSelection() {
  if (!arcgroupMetadata || !arcgroupMetadata.byId.size) {
    return;
  }
  const repeatEvery = Math.max(1, Math.floor(Number(radialRepeatInput?.value) || 1));
  const width = Math.max(1, Math.floor(Number(radialWidthInput?.value) || 1));
  arcgroupMetadata.byId.forEach((meta, id) => {
    const angularIndex = Number.isFinite(meta.angularIndex) ? meta.angularIndex : 0;
    if (angularIndex % repeatEvery < width) {
      const current = selectionState.get(id);
      if (current !== 'active') {
        selectionState.set(id, 'selected');
      }
    }
  });
  stopAnimationLoop();
  updateSelectionHighlights();
  updateSelectionStats();
  pushSelectionStateToViewer();
  setAnimationStatus('Radial selection applied.', 'idle');
}

function pushSelectionStateToViewer() {
  if (!threeApp || typeof threeApp.setSelectionState !== 'function') {
    return;
  }
  const payload = {};
  selectionState.forEach((value, key) => {
    payload[key] = value;
  });
  threeApp.setSelectionState(payload);
}

function pushFrameActiveToViewer(activeSet) {
  if (!threeApp || typeof threeApp.applyFrameHighlight !== 'function') {
    return;
  }
  const payload = Array.from(activeSet || [], id => Number(id));
  threeApp.applyFrameHighlight(payload);
}

function computeActiveIdsForFrame(frame) {
  const active = new Set();
  selectionState.forEach((state, id) => {
    if (state === 'active') {
      active.add(id);
    }
  });
  if (!frame) {
    return active;
  }
  if (frame.centerActive) {
    selectionState.forEach((state, id) => {
      if (state === 'selected' || state === 'active') {
        active.add(id);
      }
    });
  }
  if (Array.isArray(frame.neighbours) && arcgroupMetadata && arcgroupMetadata.byId) {
    selectionState.forEach((state, id) => {
      if (state !== 'selected' && state !== 'active') {
        return;
      }
      const meta = arcgroupMetadata.byId.get(id);
      if (!meta || !Array.isArray(meta.neighbours)) {
        return;
      }
      frame.neighbours.forEach((flag, index) => {
        if (!flag) {
          return;
        }
        const neighbourId = meta.neighbours[index];
        if (Number.isFinite(neighbourId)) {
          active.add(neighbourId);
        }
      });
    });
  }
  return active;
}

function ensureViewerGeometrySync() {
  if (!lastRender || !hasGeometry(lastRender.geometry)) {
    return;
  }
  const viewer = ensureThreeApp();
  if (!viewer) {
    return;
  }
  if (typeof viewer.useGeometryFromPayload === 'function') {
    viewer.useGeometryFromPayload(lastRender.params || collectParams(), lastRender.geometry);
  }
  pushSelectionStateToViewer();
}

function stopAnimationLoop({ restoreBase = true } = {}) {
  if (animationTimer) {
    clearTimeout(animationTimer);
    animationTimer = null;
  }
  const wasRunning = animationRunning;
  animationRunning = false;
  if (runAnimationButton) {
    runAnimationButton.textContent = 'Animate sequence';
  }
  let restored = false;
  if (restoreBase && animationOverridesActive) {
    restoreBaseRenderWithActive(new Set());
    restored = true;
  }
  animationOverridesActive = false;
  if (threeApp && typeof threeApp.updateLineAngles === 'function') {
    threeApp.updateLineAngles(null, baseLineAngles);
  }
  currentFrameActive = new Set();
  if (!restored) {
    updateSelectionHighlights(currentFrameActive);
    pushFrameActiveToViewer(currentFrameActive);
  } else {
    pushFrameActiveToViewer(currentFrameActive);
  }
  const message = selectionState.size ? 'Ready to animate.' : 'Select arcgroups to begin.';
  if (wasRunning) {
    setAnimationStatus(selectionState.size ? 'Animation stopped.' : 'Select arcgroups to begin.');
  } else if (activeView === 'animation') {
    setAnimationStatus(message);
  }
}

function restoreBaseRenderWithActive(activeSet = new Set()) {
  if (!baseRenderSnapshot) {
    currentFrameActive = new Set(activeSet instanceof Set ? activeSet : []);
    updateSelectionHighlights(currentFrameActive);
    pushFrameActiveToViewer(currentFrameActive);
    return;
  }
  const frameSet = activeSet instanceof Set ? activeSet : new Set(activeSet || []);
  currentFrameActive = new Set(frameSet);
  handleRenderSuccess(baseRenderSnapshot, {
    isAnimation: true,
    activeFrameSet: currentFrameActive,
    lineAngleOverrides: null,
  });
}

function applyAnimationFrame(activeSet) {
  const nextSet = activeSet instanceof Set ? activeSet : new Set(activeSet || []);
  currentFrameActive = new Set(nextSet);

  const baseParams = baseRenderSnapshot?.params || lastRender?.params || collectParams();
  if (!baseParams) {
    updateSelectionHighlights(currentFrameActive);
    pushFrameActiveToViewer(currentFrameActive);
    return;
  }

  const shift = Number(baseParams.fill_pattern_angle ?? 0);
  const overrides = new Map();
  if (Math.abs(shift) > 1e-6) {
    currentFrameActive.forEach(id => {
      const baseAngle = baseLineAngles.get(id);
      if (Number.isFinite(baseAngle)) {
        overrides.set(id, baseAngle + shift);
      }
    });
  }

  if (threeApp && typeof threeApp.updateLineAngles === 'function') {
    threeApp.updateLineAngles(overrides.size ? overrides : null, baseLineAngles);
  }

  if (!baseParams.add_fill_pattern || overrides.size === 0) {
    if (animationOverridesActive) {
      restoreBaseRenderWithActive(currentFrameActive);
    } else {
      updateSelectionHighlights(currentFrameActive);
      pushFrameActiveToViewer(currentFrameActive);
    }
    animationOverridesActive = false;
    return;
  }

  const overridePayload = {};
  overrides.forEach((value, key) => {
    overridePayload[key] = value;
  });

  const params = { ...baseParams, line_angle_overrides: overridePayload };
  try {
    const result = renderSpiral(params);
    handleRenderSuccess({ ...result, params }, {
      isAnimation: true,
      activeFrameSet: currentFrameActive,
      lineAngleOverrides: overrides,
    });
    animationOverridesActive = true;
  } catch (error) {
    console.error('Animation render failed:', error);
    updateSelectionHighlights(currentFrameActive);
    pushFrameActiveToViewer(currentFrameActive);
  }
}

function scheduleNextAnimationFrame() {
  if (!animationRunning) {
    return;
  }
  const frame = animationFrames[currentAnimationFrameIndex] || animationFrames[0] || null;
  if (!frame) {
    stopAnimationLoop();
    return;
  }
  const activeSet = computeActiveIdsForFrame(frame);
  applyAnimationFrame(activeSet);
  const duration = Math.max(50, Number(frame.duration) || 600);
  animationTimer = setTimeout(() => {
    currentAnimationFrameIndex = (currentAnimationFrameIndex + 1) % animationFrames.length;
    scheduleNextAnimationFrame();
  }, duration);
}

function startAnimationLoop() {
  if (!animationFrames.length) {
    setAnimationStatus('Add at least one frame to animate.', 'error');
    return;
  }
  if (!selectionState.size) {
    setAnimationStatus('Select arcgroups before animating.', 'error');
    return;
  }
  if (!baseRenderSnapshot && lastRender) {
    baseRenderSnapshot = lastRender;
    baseLineAngles = new Map();
    if (lastRender.geometry && Array.isArray(lastRender.geometry.arcgroups)) {
      lastRender.geometry.arcgroups.forEach(group => {
        const id = Number(group.id);
        const baseAngle = Number(group.base_line_angle ?? group.line_angle ?? 0);
        if (Number.isFinite(id) && Number.isFinite(baseAngle)) {
          baseLineAngles.set(id, baseAngle);
        }
      });
    }
  }
  ensureViewerGeometrySync();
  animationRunning = true;
  currentAnimationFrameIndex = 0;
  runAnimationButton && (runAnimationButton.textContent = 'Stop animation');
  setAnimationStatus('Animation running…', 'loading');
  animationOverridesActive = false;
  scheduleNextAnimationFrame();
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

function handleRenderSuccess(result, options = {}) {
  const {
    isAnimation = false,
    activeFrameSet = null,
    lineAngleOverrides = null,
  } = options;
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
  if (!isAnimation) {
    baseRenderSnapshot = lastRender;
    baseLineAngles = new Map();
    if (geometry && Array.isArray(geometry.arcgroups)) {
      geometry.arcgroups.forEach(group => {
        const id = Number(group.id);
        const baseAngle = Number(group.base_line_angle ?? group.line_angle ?? 0);
        if (Number.isFinite(id) && Number.isFinite(baseAngle)) {
          baseLineAngles.set(id, baseAngle);
        }
      });
    }
  }

  const interactionOptions = {
    preserveAnimation: isAnimation,
    suppressStatus: isAnimation,
  };
  if (activeFrameSet instanceof Set) {
    interactionOptions.activeFrameSet = activeFrameSet;
  }
  prepareSvgInteractions(svgElement, geometry, interactionOptions);

  updateStats(geometry);
  statMode.textContent = mode === 'arram_boyle' ? 'Arram-Boyle' : 'Classic Doyle';
  if (!isAnimation) {
    setStatus('Spiral updated. Switch views to explore it in 3D.');
  }
  updateExportAvailability(true);

  if (threeApp) {
    if (geometry && !isAnimation) {
      threeApp.useGeometryFromPayload(params, geometry);
    } else if (!geometry && !isAnimation) {
      threeApp.queueGeometryUpdate(params, true);
    }
    if (typeof threeApp.updateLineAngles === 'function') {
      const overridesPayload = lineAngleOverrides || null;
      threeApp.updateLineAngles(overridesPayload, baseLineAngles);
    }
  }

  pushSelectionStateToViewer();
  pushFrameActiveToViewer(currentFrameActive);
}

function handleRenderFailure(message) {
  svgPreview.innerHTML = '<div class="empty-state">Unable to render spiral.</div>';
  svgPreview.classList.add('empty-state');
  setStatus(message || 'Unexpected error', 'error');
  lastRender = null;
  baseRenderSnapshot = null;
  baseLineAngles = new Map();
  animationOverridesActive = false;
  updateExportAvailability(false);
  prepareSvgInteractions(null, null);
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
  if (event.target === fillPatternTypeSelect) {
    updatePatternTypeVisibility();
  }
  stopAnimationLoop();
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
    const showAnimation = view === 'animation';
    const show2d = view === '2d' || showAnimation;
    view2d.hidden = !show2d;
    if (animationPanel) {
      animationPanel.hidden = !showAnimation;
    }
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
    } else if (showAnimation) {
      setAnimationStatus(selectionState.size ? 'Ready to animate.' : 'Select arcgroups to begin.');
      updateSelectionHighlights();
    }
    setOverlayInteractivity(showAnimation);
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

if (animationFramesContainer) {
  animationFramesContainer.addEventListener('click', handleFrameListClick);
  animationFramesContainer.addEventListener('input', handleFrameListInput);
}

if (addAnimationFrameButton) {
  addAnimationFrameButton.addEventListener('click', addNewFrame);
}

if (selectAllArcgroupsButton) {
  selectAllArcgroupsButton.addEventListener('click', selectAllArcgroups);
}

if (clearArcgroupSelectionButton) {
  clearArcgroupSelectionButton.addEventListener('click', clearArcgroupSelection);
}

if (applyRadialSelectionButton) {
  applyRadialSelectionButton.addEventListener('click', applyRadialSelection);
}

if (runAnimationButton) {
  runAnimationButton.addEventListener('click', () => {
    if (animationRunning) {
      stopAnimationLoop();
    } else {
      startAnimationLoop();
    }
  });
}

if (!animationFrames.length) {
  animationFrames = [
    createFrame({ centerActive: true }),
    createFrame({ centerActive: false }),
  ];
  selectedFrameId = animationFrames[0].id;
}

buildHexDiagram();
renderFrameList();
updateHexDiagram();
updateSelectionStats();
setAnimationStatus('Render the spiral to begin.');

updateExportAvailability(false);
toggleFillSettings();
updateTValue();
renderCurrentSpiral(true);
