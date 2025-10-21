import { renderSpiral, normaliseParams } from './doyle_spiral_engine.js';
import { createThreeViewer } from './three_viewer.js';
import {
  ANIMATION_PRESETS,
  buildArcGroupMetadata,
  colorForFrame,
  framesToAngleMap,
  generatePresetFrames,
} from './animation_presets.js';

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
const outlineToggle = document.getElementById('toggleOutline');
const redToggle = document.getElementById('toggleRed');
const viewButtons = Array.from(document.querySelectorAll('[data-view]'));
const view2d = document.getElementById('view2d');
const viewAnimate = document.getElementById('viewAnimate');
const view3d = document.getElementById('view3d');
const animateSvgPreview = document.getElementById('animateSvgPreview');
const animateFramesContainer = document.getElementById('animateFrames');
const animateAddFrameButton = document.getElementById('animateAddFrame');
const animateRemoveFrameButton = document.getElementById('animateRemoveFrame');
const animateClearFramesButton = document.getElementById('animateClearFrames');
const animateApplyButton = document.getElementById('animateApply');
const animatePresetSelect = document.getElementById('animatePreset');
const animateApplyPresetButton = document.getElementById('animateApplyPreset');
const animateStatus = document.getElementById('animateStatus');
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
};

let activeView = '2d';
let lastRender = null;
let threeApp = null;
let arcGroupMeta = [];
let arcGroupMetaById = new Map();
let animationFrames = [];
let frameAssignments = new Map();
let selectedFrameIndex = 0;
let animateSvgElement = null;

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

function setStatus(message, state = 'idle') {
  statusEl.textContent = message;
  statusEl.classList.remove('loading', 'error');
  if (state !== 'idle') {
    statusEl.classList.add(state);
  }
}

function setAnimateStatus(message, state = 'idle') {
  if (!animateStatus) {
    return;
  }
  animateStatus.textContent = message;
  animateStatus.classList.remove('loading', 'error');
  if (state === 'loading') {
    animateStatus.classList.add('loading');
  } else if (state === 'error') {
    animateStatus.classList.add('error');
  }
}

function populatePresetOptions() {
  if (!animatePresetSelect) {
    return;
  }
  animatePresetSelect.replaceChildren();
  const fragment = document.createDocumentFragment();
  ANIMATION_PRESETS.forEach((preset, index) => {
    const option = document.createElement('option');
    option.value = preset.id;
    option.textContent = preset.name;
    option.title = preset.description;
    if (index === 0) {
      option.selected = true;
    }
    fragment.appendChild(option);
  });
  animatePresetSelect.appendChild(fragment);
}

function computeDefaultFrameCount(meta = arcGroupMeta) {
  const count = Array.isArray(meta) ? meta.length : 0;
  if (!count) {
    return 1;
  }
  const approx = Math.round(Math.sqrt(count));
  return Math.max(1, Math.min(10, approx || 1));
}

function rebuildAssignmentsFromFrames() {
  frameAssignments = new Map();
  animationFrames.forEach((frame, frameIdx) => {
    frame.forEach(groupId => {
      frameAssignments.set(groupId, frameIdx);
    });
  });
}

function persistAnimationState() {
  if (!lastRender) {
    return;
  }
  lastRender.animation = {
    frames: animationFrames.map(frame => frame.slice()),
  };
}

function formatArcGroupLabel(meta) {
  if (!meta) {
    return 'Arc group';
  }
  const ringLabel = meta.ringIndex !== null && meta.ringIndex !== undefined ? `Ring ${meta.ringIndex + 1}` : 'Ring –';
  const shortName = meta.name ? meta.name.replace(/^circle_/, '#') : `#${meta.id}`;
  return `${ringLabel} • ${shortName}`;
}

function renderAnimationFrames() {
  if (!animateFramesContainer) {
    return;
  }
  if (!animationFrames.length) {
    animationFrames = [[]];
  }
  selectedFrameIndex = Math.min(Math.max(selectedFrameIndex, 0), animationFrames.length - 1);
  animateFramesContainer.replaceChildren();
  animationFrames.forEach((frame, index) => {
    const frameEl = document.createElement('div');
    frameEl.classList.add('animate-frame');
    frameEl.dataset.frameIndex = String(index);
    if (index === selectedFrameIndex) {
      frameEl.classList.add('selected');
    }
    const items = document.createElement('div');
    items.classList.add('frame-items');
    if (frame.length) {
      frame.forEach(groupId => {
        const badge = document.createElement('button');
        badge.type = 'button';
        badge.classList.add('frame-badge');
        badge.dataset.groupId = String(groupId);
        badge.dataset.frameIndex = String(index);
        const meta = arcGroupMetaById.get(groupId);
        const label = document.createElement('span');
        label.textContent = formatArcGroupLabel(meta);
        badge.style.backgroundColor = colorForFrame(index);
        badge.style.color = '#0f172a';
        const remove = document.createElement('span');
        remove.classList.add('remove');
        remove.textContent = '✕';
        badge.append(label, remove);
        items.appendChild(badge);
      });
    } else {
      const empty = document.createElement('div');
      empty.classList.add('frame-empty');
      empty.textContent = 'No groups';
      items.appendChild(empty);
    }
    const label = document.createElement('div');
    label.classList.add('frame-label');
    label.textContent = `Frame ${index + 1}`;
    frameEl.append(items, label);
    animateFramesContainer.appendChild(frameEl);
  });
  persistAnimationState();
}

function updateArcGroupStyling() {
  const shapes = document.querySelectorAll('.arcgroup-shape[data-arc-group-id]');
  shapes.forEach(element => {
    const groupId = Number(element.getAttribute('data-arc-group-id'));
    if (!Number.isFinite(groupId)) {
      return;
    }
    const frameIndex = frameAssignments.get(groupId);
    if (frameIndex !== undefined) {
      const color = colorForFrame(frameIndex);
      element.setAttribute('data-frame-index', String(frameIndex));
      element.style.fill = color;
      element.style.stroke = color;
      element.style.strokeOpacity = '0.9';
      element.style.fillOpacity = '0.32';
    } else {
      element.removeAttribute('data-frame-index');
      element.style.fill = 'transparent';
      element.style.stroke = 'transparent';
      element.style.strokeOpacity = '';
      element.style.fillOpacity = '';
    }
  });

  const hitAreas = document.querySelectorAll('.arcgroup-hitarea[data-arc-group-id]');
  hitAreas.forEach(element => {
    const groupId = Number(element.getAttribute('data-arc-group-id'));
    if (!Number.isFinite(groupId)) {
      return;
    }
    const frameIndex = frameAssignments.get(groupId);
    if (frameIndex !== undefined) {
      element.setAttribute('data-frame-index', String(frameIndex));
    } else {
      element.removeAttribute('data-frame-index');
    }
  });

  if (lastRender) {
    lastRender.svgString = null;
  }
}

function applyAssignmentsToSvg(assignments) {
  if (!assignments) {
    return;
  }
  document.querySelectorAll('[data-arc-group-id]').forEach(element => {
    const groupId = Number(element.getAttribute('data-arc-group-id'));
    if (!Number.isFinite(groupId)) {
      return;
    }
    if (assignments.has(groupId)) {
      const angle = assignments.get(groupId);
      element.setAttribute('data-line-angle', String(angle));
    }
  });
}

function triggerArcPulse(groupId) {
  const selector = `.arcgroup-shape[data-arc-group-id="${groupId}"]`;
  document.querySelectorAll(selector).forEach(element => {
    element.classList.remove('is-pulsing');
    void element.getBoundingClientRect();
    element.classList.add('is-pulsing');
    window.setTimeout(() => element.classList.remove('is-pulsing'), 900);
  });
}

function setSelectedFrame(index) {
  if (!animationFrames.length) {
    return;
  }
  const clamped = Math.min(Math.max(index, 0), animationFrames.length - 1);
  selectedFrameIndex = clamped;
  renderAnimationFrames();
}

function assignArcToFrame(groupId, frameIndex) {
  if (!Number.isFinite(groupId) || frameIndex < 0 || frameIndex >= animationFrames.length) {
    return false;
  }
  if (frameAssignments.has(groupId)) {
    return false;
  }
  animationFrames[frameIndex].push(groupId);
  frameAssignments.set(groupId, frameIndex);
  renderAnimationFrames();
  updateArcGroupStyling();
  return true;
}

function removeArcFromFrame(groupId, frameIndex) {
  if (frameIndex < 0 || frameIndex >= animationFrames.length) {
    return;
  }
  const frame = animationFrames[frameIndex];
  const idx = frame.indexOf(groupId);
  if (idx !== -1) {
    frame.splice(idx, 1);
  }
  frameAssignments.delete(groupId);
  renderAnimationFrames();
  updateArcGroupStyling();
}

function initialiseAnimationState(meta = [], preservedFrames = null) {
  arcGroupMeta = Array.isArray(meta) ? meta : [];
  arcGroupMetaById = new Map(arcGroupMeta.map(entry => [entry.id, entry]));
  animationFrames = [];
  if (preservedFrames && preservedFrames.length) {
    const validIds = new Set(arcGroupMeta.map(entry => entry.id));
    preservedFrames.forEach(frame => {
      const filtered = frame.filter(id => validIds.has(id));
      animationFrames.push(filtered);
    });
  }
  if (!animationFrames.length) {
    const defaultCount = computeDefaultFrameCount(arcGroupMeta);
    animationFrames = Array.from({ length: defaultCount }, () => []);
  }
  selectedFrameIndex = 0;
  rebuildAssignmentsFromFrames();
  renderAnimationFrames();
  updateArcGroupStyling();
  if (arcGroupMeta.length) {
    setAnimateStatus('Select a frame, then click cells in the spiral to assign them.');
  } else {
    setAnimateStatus('Animation is available once Arram-Boyle geometry is generated.');
  }
}

function addFrame() {
  animationFrames.push([]);
  selectedFrameIndex = animationFrames.length - 1;
  rebuildAssignmentsFromFrames();
  renderAnimationFrames();
  updateArcGroupStyling();
  setAnimateStatus(`Frame ${selectedFrameIndex + 1} added.`);
}

function removeLastFrame() {
  if (animationFrames.length <= 1) {
    setAnimateStatus('At least one frame is required.', 'error');
    return;
  }
  const removed = animationFrames.pop();
  removed.forEach(groupId => frameAssignments.delete(groupId));
  selectedFrameIndex = Math.min(selectedFrameIndex, animationFrames.length - 1);
  renderAnimationFrames();
  updateArcGroupStyling();
  setAnimateStatus('Removed the last frame.');
}

function clearFrames() {
  animationFrames = animationFrames.map(() => []);
  frameAssignments = new Map();
  selectedFrameIndex = 0;
  renderAnimationFrames();
  updateArcGroupStyling();
  setAnimateStatus('All frame assignments cleared.');
}

function applyPreset(presetId) {
  if (!arcGroupMeta.length) {
    setAnimateStatus('Generate a spiral before loading presets.', 'error');
    return;
  }
  const frames = generatePresetFrames(presetId, arcGroupMeta);
  if (!frames.length) {
    setAnimateStatus('Preset did not return any frames.', 'error');
    return;
  }
  animationFrames = frames.map(frame => frame.slice());
  selectedFrameIndex = 0;
  rebuildAssignmentsFromFrames();
  renderAnimationFrames();
  updateArcGroupStyling();
  setAnimateStatus(`Preset applied with ${animationFrames.length} frames.`);
}

function handleArcSelection(groupId) {
  if (!Number.isFinite(groupId)) {
    return;
  }
  if (!animationFrames.length) {
    setAnimateStatus('Add a frame before assigning cells.', 'error');
    return;
  }
  if (!arcGroupMetaById.has(groupId)) {
    setAnimateStatus('Selected element is not part of the current geometry.', 'error');
    return;
  }
  const existing = frameAssignments.get(groupId);
  if (existing !== undefined) {
    setSelectedFrame(existing);
    const label = formatArcGroupLabel(arcGroupMetaById.get(groupId));
    setAnimateStatus(`${label} is already in frame ${existing + 1}.`);
    return;
  }
  const frameIndex = Math.min(Math.max(selectedFrameIndex, 0), animationFrames.length - 1);
  const assigned = assignArcToFrame(groupId, frameIndex);
  if (assigned) {
    const label = formatArcGroupLabel(arcGroupMetaById.get(groupId));
    setAnimateStatus(`${label} added to frame ${frameIndex + 1}.`);
  }
}

function onAnimateSvgClick(event) {
  if (activeView !== 'animate') {
    return;
  }
  const target = event.target.closest('[data-arc-group-id]');
  if (!target) {
    return;
  }
  const groupId = Number(target.getAttribute('data-arc-group-id'));
  if (!Number.isFinite(groupId)) {
    return;
  }
  triggerArcPulse(groupId);
  handleArcSelection(groupId);
}

function onAnimateFramesClick(event) {
  const badge = event.target.closest('.frame-badge');
  if (badge) {
    const groupId = Number(badge.dataset.groupId);
    const frameIndex = Number(badge.dataset.frameIndex);
    if (Number.isFinite(groupId) && Number.isFinite(frameIndex)) {
      removeArcFromFrame(groupId, frameIndex);
      setAnimateStatus(`Removed from frame ${frameIndex + 1}.`);
    }
    return;
  }
  const frameEl = event.target.closest('.animate-frame');
  if (frameEl && frameEl.dataset.frameIndex !== undefined) {
    const index = Number(frameEl.dataset.frameIndex);
    if (Number.isFinite(index)) {
      setSelectedFrame(index);
      setAnimateStatus(`Frame ${index + 1} selected.`);
    }
  }
}

function attachArcListeners(svg) {
  if (animateSvgElement) {
    animateSvgElement.removeEventListener('click', onAnimateSvgClick);
  }
  animateSvgElement = svg;
  if (animateSvgElement) {
    animateSvgElement.addEventListener('click', onAnimateSvgClick);
  }
}

function switchView(view) {
  if (view === activeView) {
    return;
  }
  activeView = view;
  viewButtons.forEach(button => {
    const isActive = button.dataset.view === view;
    button.classList.toggle('active', isActive);
    button.setAttribute('aria-pressed', String(isActive));
  });
  const show3d = view === '3d';
  const showAnimate = view === 'animate';

  view2d.hidden = show3d || showAnimate;
  if (viewAnimate) {
    viewAnimate.hidden = !showAnimate;
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
  } else if (showAnimate) {
    updateArcGroupStyling();
  }
}

function applyAnimationFromFrames() {
  if (!lastRender || !hasGeometry(lastRender.geometry)) {
    setAnimateStatus('Animation requires Arram-Boyle geometry.', 'error');
    return;
  }
  if (!animationFrames.length) {
    setAnimateStatus('Define at least one frame before animating.', 'error');
    return;
  }
  const { assignments, step, totalFrames } = framesToAngleMap(animationFrames, { span: 180, baseAngle: 0 });
  if (!assignments.size) {
    setAnimateStatus('Assign arc groups to frames before animating.', 'error');
    return;
  }
  const updatedGeometry = JSON.parse(JSON.stringify(lastRender.geometry));
  updatedGeometry.arcgroups = updatedGeometry.arcgroups.map(group => {
    const angle = assignments.get(group.id);
    if (angle !== undefined) {
      return { ...group, line_angle: angle };
    }
    return group;
  });
  lastRender.geometry = updatedGeometry;
  lastRender.animation = {
    frames: animationFrames.map(frame => frame.slice()),
    angleStep: step,
    totalFrames,
  };
  applyAssignmentsToSvg(assignments);
  updateArcGroupStyling();
  setAnimateStatus(`Animation ready: ${assignments.size} groups across ${totalFrames} frames.`);
  const app = ensureThreeApp();
  if (app) {
    app.useGeometryFromPayload(lastRender.params, updatedGeometry);
  }
  switchView('3d');
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

function showSVG(svgElement, container) {
  if (!svgElement || !container) {
    return;
  }
  svgElement.setAttribute('width', '100%');
  svgElement.setAttribute('height', '100%');
  svgElement.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  container.replaceChildren(svgElement);
  container.classList.remove('empty-state');
}

async function renderCurrentSpiral(showLoading = true) {
  const params = collectParams();
  if (showLoading) {
    setStatus('Rendering spiral…', 'loading');
  }
  const previousAnimation = lastRender && lastRender.animation ? lastRender.animation : null;
  try {
    const result = renderSpiral(params);
    const svgFor2d = result.svg.cloneNode(true);
    showSVG(svgFor2d, svgPreview);
    const geometry = hasGeometry(result.geometry) ? result.geometry : null;
    lastRender = { params, geometry, mode: params.mode, svgString: result.svgString };
    if (previousAnimation && previousAnimation.frames) {
      lastRender.animation = {
        frames: previousAnimation.frames.map(frame => frame.slice()),
      };
    }
    if (animateSvgPreview) {
      if (geometry) {
        const svgForAnimate = result.svg.cloneNode(true);
        showSVG(svgForAnimate, animateSvgPreview);
        attachArcListeners(svgForAnimate);
      } else {
        animateSvgPreview.textContent = 'Animation is available once Arram-Boyle geometry is generated.';
        attachArcListeners(null);
      }
    }
    if (geometry) {
      const meta = buildArcGroupMetadata(geometry);
      const preservedFrames = previousAnimation ? previousAnimation.frames : null;
      initialiseAnimationState(meta, preservedFrames);
    } else {
      initialiseAnimationState([], null);
    }
    updateStats(geometry);
    statMode.textContent = params.mode === 'arram_boyle' ? 'Arram-Boyle' : 'Classic Doyle';
    setStatus('Spiral updated. Switch views to explore it in 3D.');
    updateExportAvailability(true);

    if (threeApp) {
      if (geometry) {
        threeApp.useGeometryFromPayload(params, geometry);
      } else {
        threeApp.queueGeometryUpdate(params, true);
      }
    }
    updateArcGroupStyling();
  } catch (error) {
    console.error(error);
    svgPreview.innerHTML = '<div class="empty-state">Unable to render spiral.</div>';
    svgPreview.classList.add('empty-state');
    setStatus(error.message || 'Unexpected error', 'error');
    lastRender = null;
    updateExportAvailability(false);
    if (animateSvgPreview) {
      animateSvgPreview.textContent = 'Unable to render spiral.';
      attachArcListeners(null);
    }
    initialiseAnimationState([], null);
    setAnimateStatus('Unable to render spiral.', 'error');
  }
}

const debouncedRender = debounce(() => renderCurrentSpiral(false), 200);

form.addEventListener('input', event => {
  if (event.target.name === 't') {
    updateTValue();
  }
  if (event.target === fillToggle) {
    toggleFillSettings();
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

if (animateFramesContainer) {
  animateFramesContainer.addEventListener('click', onAnimateFramesClick);
}

viewButtons.forEach(button => {
  button.addEventListener('click', () => {
    const view = button.dataset.view;
    if (!view) {
      return;
    }
    switchView(view);
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

if (animateAddFrameButton) {
  animateAddFrameButton.addEventListener('click', addFrame);
}

if (animateRemoveFrameButton) {
  animateRemoveFrameButton.addEventListener('click', removeLastFrame);
}

if (animateClearFramesButton) {
  animateClearFramesButton.addEventListener('click', clearFrames);
}

if (animateApplyPresetButton) {
  animateApplyPresetButton.addEventListener('click', () => {
    const presetId = animatePresetSelect && animatePresetSelect.value
      ? animatePresetSelect.value
      : ANIMATION_PRESETS[0]?.id;
    if (presetId) {
      applyPreset(presetId);
    }
  });
}

if (animateApplyButton) {
  animateApplyButton.addEventListener('click', applyAnimationFromFrames);
}

updateExportAvailability(false);
toggleFillSettings();
updateTValue();
populatePresetOptions();
renderCurrentSpiral(true);
