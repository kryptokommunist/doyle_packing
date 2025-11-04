import { renderSpiral, normaliseParams } from './doyle_spiral_engine.js';
import { ANIMATION_PRESETS } from './animation_presets.js';
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
const outlineToggle = document.getElementById('toggleOutline');
const redToggle = document.getElementById('toggleRed');
const viewButtons = Array.from(document.querySelectorAll('[data-view]'));
const view2d = document.getElementById('view2d');
const view3d = document.getElementById('view3d');
const viewAnimate = document.getElementById('viewAnimate');
const threeStatus = document.getElementById('threeStatus');
const threeSettingsToggle = document.getElementById('threeSettingsToggle');
const threeStage = document.getElementById('threeStage');
const threeStats = document.getElementById('threeStats');
const fileInput = document.getElementById('threeFileInput');
const exportButton = document.getElementById('exportSvgButton');
const exportFilenameInput = document.getElementById('exportFilename');
const animateSvgPreview = document.getElementById('animateSvgPreview');
const animateHint = document.getElementById('animateHint');
const animationPresetSelect = document.getElementById('animationPresetSelect');
const applyPresetButton = document.getElementById('applyPresetButton');
const clearPresetButton = document.getElementById('clearPresetButton');
const animationFramesContainer = document.getElementById('animationFrames');
const addFrameButton = document.getElementById('addFrameButton');
const removeFrameButton = document.getElementById('removeFrameButton');
const clearFramesButton = document.getElementById('clearFramesButton');
const runAnimationButton = document.getElementById('runAnimationButton');

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
let currentSvgElement = null;
let animateSvgElement = null;
let animationEnabled = false;

const animationState = {
  frames: [{ id: 1, groups: [] }],
  nextFrameId: 2,
  activeFrame: 0,
  assigned: new Map(),
  presetId: 'none',
  presetAngles: {},
  arcGroups: new Map(),
};

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

function computeFrameAngles() {
  const total = Math.max(animationState.frames.length, 1);
  const step = 180 / total;
  return animationState.frames.map((_, index) => index * step);
}

function computeFrameColor(frameIndex) {
  const base = { r: 250, g: 204, b: 21 };
  const darken = Math.min(0.9, 0.25 * frameIndex);
  const factor = Math.max(0.1, 1 - darken);
  const r = Math.round(base.r * factor);
  const g = Math.round(base.g * factor);
  const b = Math.round(base.b * factor);
  return `rgb(${r}, ${g}, ${b})`;
}

function formatGroupLabel(meta) {
  if (!meta) {
    return 'Arc group';
  }
  const ringLabel = meta.ringIndex !== undefined && meta.ringIndex !== null
    ? `Ring ${Number(meta.ringIndex) + 1}`
    : 'Ring –';
  const name = meta.name ? meta.name.replace('circle_', 'Circle ') : `Group ${meta.id}`;
  return `${ringLabel} • ${name}`;
}

function highlightFrame(index) {
  if (!animationFramesContainer) {
    return;
  }
  const frame = animationFramesContainer.querySelector(`.frame-column[data-index="${index}"]`);
  if (!frame) {
    return;
  }
  frame.classList.remove('flash');
  void frame.offsetWidth;
  frame.classList.add('flash');
  setTimeout(() => frame.classList.remove('flash'), 600);
}

function updateAnimateHint() {
  if (!animateHint) {
    return;
  }
  if (!animationEnabled) {
    animateHint.textContent = 'Animation controls become available after rendering the Arram-Boyle SVG.';
    return;
  }
  const angles = computeFrameAngles();
  const angle = angles[animationState.activeFrame] || 0;
  animateHint.textContent = `Active frame: ${animationState.activeFrame + 1} • ${angle.toFixed(1)}°`;
}

function toggleAnimationControls(enabled) {
  const controls = [
    animationPresetSelect,
    applyPresetButton,
    clearPresetButton,
    addFrameButton,
    removeFrameButton,
    clearFramesButton,
    runAnimationButton,
  ];
  controls.forEach(control => {
    if (!control) {
      return;
    }
    control.disabled = !enabled;
  });
  if (animationFramesContainer) {
    animationFramesContainer.classList.toggle('disabled', !enabled);
  }
  updateAnimateHint();
}

function applyFrameStyles() {
  const svgs = [currentSvgElement, animateSvgElement];
  svgs.forEach(svg => {
    if (!svg) {
      return;
    }
    svg.querySelectorAll('.arc-group').forEach(groupEl => {
      groupEl.classList.remove('is-assigned', 'is-active-frame');
      groupEl.style.removeProperty('--frame-color');
      groupEl.removeAttribute('data-frame-index');
      groupEl.removeAttribute('data-frame-angle');
      const hit = groupEl.querySelector('.arc-group-hit');
      if (hit) {
        hit.setAttribute('fill-opacity', '0');
      }
    });
  });

  const frameAngles = computeFrameAngles();
  animationState.frames.forEach((frame, index) => {
    frame.groups.forEach(groupId => {
      const color = computeFrameColor(index);
      const angleValue = frameAngles[index] || 0;
      svgs.forEach(svg => {
        if (!svg) {
          return;
        }
        const element = svg.querySelector(`[data-arc-group-id="${groupId}"]`);
        if (!element) {
          return;
        }
        element.classList.add('is-assigned');
        if (index === animationState.activeFrame) {
          element.classList.add('is-active-frame');
        }
        element.style.setProperty('--frame-color', color);
        element.setAttribute('data-frame-index', index);
        element.setAttribute('data-frame-angle', angleValue.toFixed(2));
        const hit = element.querySelector('.arc-group-hit');
        if (hit) {
          hit.setAttribute('fill-opacity', index === animationState.activeFrame ? '0.15' : '0.08');
        }
      });
    });
  });
}

function rebuildFramesUI() {
  if (!animationFramesContainer) {
    return;
  }
  animationFramesContainer.innerHTML = '';
  const angles = computeFrameAngles();
  animationState.frames.forEach((frame, index) => {
    const column = document.createElement('div');
    column.className = 'frame-column';
    column.dataset.index = index;
    if (index === animationState.activeFrame) {
      column.classList.add('active');
    }

    const body = document.createElement('div');
    body.className = 'frame-body';
    if (frame.groups.length) {
      frame.groups.forEach(groupId => {
        const meta = animationState.arcGroups.get(groupId);
        const tag = document.createElement('span');
        tag.className = 'frame-tag';
        tag.style.backgroundColor = computeFrameColor(index);
        const label = document.createElement('span');
        label.textContent = formatGroupLabel({ ...meta, id: groupId });
        const removeButton = document.createElement('button');
        removeButton.type = 'button';
        removeButton.className = 'frame-remove';
        removeButton.setAttribute('aria-label', 'Remove arc group from frame');
        removeButton.textContent = '×';
        removeButton.addEventListener('click', event => {
          event.stopPropagation();
          removeGroupFromFrame(index, groupId);
        });
        tag.append(label, removeButton);
        body.appendChild(tag);
      });
    } else {
      const placeholder = document.createElement('div');
      placeholder.className = 'frame-placeholder';
      placeholder.textContent = 'Click arc groups to add';
      body.appendChild(placeholder);
    }

    const footer = document.createElement('div');
    footer.className = 'frame-number';
    footer.textContent = `Frame ${index + 1} · ${(angles[index] || 0).toFixed(1)}°`;

    column.append(body, footer);
    column.addEventListener('click', () => setActiveFrame(index));
    animationFramesContainer.appendChild(column);
  });
  updateAnimateHint();
  applyFrameStyles();
}

function setActiveFrame(index) {
  if (!animationState.frames[index]) {
    return;
  }
  animationState.activeFrame = index;
  rebuildFramesUI();
}

function triggerGroupPulse(groupId) {
  const svgs = [animateSvgElement, currentSvgElement];
  svgs.forEach(svg => {
    if (!svg) {
      return;
    }
    const element = svg.querySelector(`[data-arc-group-id="${groupId}"]`);
    if (!element) {
      return;
    }
    element.classList.remove('is-pulsing');
    void element.offsetWidth;
    element.classList.add('is-pulsing');
    setTimeout(() => element.classList.remove('is-pulsing'), 1200);
  });
}

function assignGroupToFrame(frameIndex, groupIdRaw) {
  const frame = animationState.frames[frameIndex];
  if (!frame) {
    return false;
  }
  const groupId = String(groupIdRaw);
  if (animationState.assigned.has(groupId)) {
    const existingIndex = animationState.assigned.get(groupId);
    setStatus(`Arc group is already assigned to Frame ${existingIndex + 1}.`, 'error');
    highlightFrame(existingIndex);
    triggerGroupPulse(groupId);
    return false;
  }
  frame.groups.push(groupId);
  animationState.assigned.set(groupId, frameIndex);
  rebuildFramesUI();
  triggerGroupPulse(groupId);
  setStatus(`Arc group added to Frame ${frameIndex + 1}.`);
  return true;
}

function removeGroupFromFrame(frameIndex, groupIdRaw) {
  const frame = animationState.frames[frameIndex];
  if (!frame) {
    return;
  }
  const groupId = String(groupIdRaw);
  frame.groups = frame.groups.filter(id => id !== groupId);
  animationState.assigned.delete(groupId);
  rebuildFramesUI();
  setStatus(`Removed arc group from Frame ${frameIndex + 1}.`);
}

function addFrame() {
  const id = animationState.nextFrameId++;
  animationState.frames.push({ id, groups: [] });
  animationState.activeFrame = animationState.frames.length - 1;
  rebuildFramesUI();
  setStatus(`Frame ${animationState.activeFrame + 1} created.`);
}

function removeLastFrame() {
  if (animationState.frames.length <= 1) {
    setStatus('At least one frame is required.', 'error');
    return;
  }
  const removed = animationState.frames.pop();
  removed.groups.forEach(groupId => animationState.assigned.delete(groupId));
  animationState.activeFrame = Math.min(animationState.activeFrame, animationState.frames.length - 1);
  rebuildFramesUI();
  setStatus(`Removed the last frame.`);
}

function clearFrames() {
  animationState.frames = [{ id: 1, groups: [] }];
  animationState.nextFrameId = 2;
  animationState.activeFrame = 0;
  animationState.assigned.clear();
  rebuildFramesUI();
  setStatus('Frames cleared. Frame 1 is ready for assignments.');
}

function syncAnimationStateWithGeometry(geometry) {
  const map = new Map();
  if (geometry && Array.isArray(geometry.arcgroups)) {
    geometry.arcgroups.forEach(group => {
      const id = String(group.id);
      map.set(id, {
        id,
        name: group.name,
        ringIndex: group.ring_index,
        lineAngle: group.line_angle,
        outline: group.outline || [],
      });
    });
  }
  animationState.arcGroups = map;
  const validIds = new Set(map.keys());
  animationState.frames.forEach(frame => {
    frame.groups = frame.groups.filter(id => validIds.has(id));
  });
  animationState.assigned = new Map(
    Array.from(animationState.assigned.entries()).filter(([id]) => validIds.has(id)),
  );
  Object.keys(animationState.presetAngles).forEach(key => {
    if (!validIds.has(key)) {
      delete animationState.presetAngles[key];
    }
  });
  if (!animationState.frames.length) {
    animationState.frames = [{ id: animationState.nextFrameId++, groups: [] }];
    animationState.activeFrame = 0;
  }
  if (animationState.activeFrame >= animationState.frames.length) {
    animationState.activeFrame = animationState.frames.length - 1;
  }
  rebuildFramesUI();
}

function updateAnimateSvg(svgElement) {
  if (!animateSvgPreview) {
    return;
  }
  animateSvgPreview.innerHTML = '';
  if (!animationEnabled || !svgElement) {
    animateSvgPreview.classList.add('empty-state');
    animateSvgPreview.textContent = animationEnabled
      ? 'Generate the spiral to start assigning frames.'
      : 'Switch to Arram-Boyle mode to enable animation.';
    animateSvgElement = null;
    return;
  }
  animateSvgPreview.classList.remove('empty-state');
  const clone = svgElement.cloneNode(true);
  clone.setAttribute('width', '100%');
  clone.setAttribute('height', '100%');
  animateSvgElement = clone;
  animateSvgPreview.appendChild(clone);
  attachAnimateSvgEvents();
}

function attachAnimateSvgEvents() {
  if (!animateSvgElement) {
    return;
  }
  animateSvgElement.addEventListener('click', handleArcGroupClick);
}

function handleArcGroupClick(event) {
  if (!animationEnabled) {
    return;
  }
  const target = event.target.closest('[data-arc-group-id]');
  if (!target) {
    return;
  }
  const groupId = target.getAttribute('data-arc-group-id');
  if (!groupId) {
    return;
  }
  assignGroupToFrame(animationState.activeFrame, groupId);
}

function getActiveLineAngleMap() {
  const overrides = { ...animationState.presetAngles };
  const frameAngles = computeFrameAngles();
  animationState.frames.forEach((frame, index) => {
    const angle = frameAngles[index] || 0;
    frame.groups.forEach(groupId => {
      overrides[groupId] = angle;
    });
  });
  return overrides;
}

function populateAnimationPresets() {
  if (!animationPresetSelect) {
    return;
  }
  animationPresetSelect.innerHTML = '';
  ANIMATION_PRESETS.forEach(preset => {
    const option = document.createElement('option');
    option.value = preset.id;
    option.textContent = preset.label;
    animationPresetSelect.appendChild(option);
  });
  animationPresetSelect.value = animationState.presetId;
}

function applySelectedPreset() {
  if (!animationPresetSelect) {
    return;
  }
  const presetId = animationPresetSelect.value;
  const preset = ANIMATION_PRESETS.find(item => item.id === presetId);
  if (!preset) {
    setStatus('Select a preset to apply.', 'error');
    return;
  }
  if (!animationState.arcGroups.size) {
    setStatus('Generate the Arram-Boyle geometry before applying presets.', 'error');
    return;
  }
  const mapping = preset.compute ? preset.compute(Array.from(animationState.arcGroups.values())) : {};
  animationState.presetId = presetId;
  animationState.presetAngles = mapping || {};
  setStatus(`${preset.label} preset applied.`);
  renderCurrentSpiral(true);
}

function clearPresetOverrides() {
  animationState.presetId = 'none';
  animationState.presetAngles = {};
  if (animationPresetSelect) {
    animationPresetSelect.value = 'none';
  }
  setStatus('Preset overrides cleared.');
  renderCurrentSpiral(true);
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
      const result = renderSpiral(
        { ...params, mode: 'arram_boyle' },
        'arram_boyle',
        { groupLineAngles: getActiveLineAngleMap() },
      );
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
  currentSvgElement = svgElement;
  updateAnimateSvg(svgElement);
}

async function renderCurrentSpiral(showLoading = true) {
  const params = collectParams();
  const overrides = getActiveLineAngleMap();
  if (showLoading) {
    setStatus('Rendering spiral…', 'loading');
  }
  try {
    const result = renderSpiral(params, null, { groupLineAngles: overrides });
    const geometry = hasGeometry(result.geometry) ? result.geometry : null;
    animationEnabled = params.mode === 'arram_boyle' && Boolean(geometry);
    showSVG(result.svg);

    lastRender = {
      params,
      geometry,
      mode: params.mode,
      svgString: result.svgString,
      overrides,
    };

    updateStats(geometry);
    statMode.textContent = params.mode === 'arram_boyle' ? 'Arram-Boyle' : 'Classic Doyle';
    toggleAnimationControls(animationEnabled);
    syncAnimationStateWithGeometry(geometry);
    setStatus('Spiral updated. Switch views to explore it in 3D.');
    updateExportAvailability(true);

    if (threeApp) {
      if (geometry) {
        threeApp.useGeometryFromPayload(params, geometry);
      } else {
        threeApp.queueGeometryUpdate(params, true);
      }
    }
  } catch (error) {
    console.error(error);
    svgPreview.innerHTML = '<div class="empty-state">Unable to render spiral.</div>';
    svgPreview.classList.add('empty-state');
    currentSvgElement = null;
    updateAnimateSvg(null);
    animationEnabled = false;
    toggleAnimationControls(false);
    syncAnimationStateWithGeometry(null);
    setStatus(error.message || 'Unexpected error', 'error');
    lastRender = null;
    updateExportAvailability(false);
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

    const viewMap = {
      '2d': view2d,
      '3d': view3d,
      animate: viewAnimate,
    };
    Object.entries(viewMap).forEach(([key, element]) => {
      if (!element) {
        return;
      }
      element.hidden = key !== view;
    });
    updateStats(lastRender ? lastRender.geometry : null);

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
    } else if (view === 'animate') {
      updateAnimateSvg(currentSvgElement);
      applyFrameStyles();
      updateAnimateHint();
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

if (applyPresetButton) {
  applyPresetButton.addEventListener('click', applySelectedPreset);
}

if (clearPresetButton) {
  clearPresetButton.addEventListener('click', clearPresetOverrides);
}

if (animationPresetSelect) {
  animationPresetSelect.addEventListener('change', () => {
    animationState.presetId = animationPresetSelect.value;
  });
}

if (addFrameButton) {
  addFrameButton.addEventListener('click', addFrame);
}

if (removeFrameButton) {
  removeFrameButton.addEventListener('click', removeLastFrame);
}

if (clearFramesButton) {
  clearFramesButton.addEventListener('click', clearFrames);
}

if (runAnimationButton) {
  runAnimationButton.addEventListener('click', async () => {
    if (!animationEnabled) {
      setStatus('Render the Arram-Boyle SVG before running the animation.', 'error');
      return;
    }
    const overrides = getActiveLineAngleMap();
    if (!Object.keys(overrides).length) {
      setStatus('Assign arc groups to frames or apply a preset before animating.', 'error');
      return;
    }
    await renderCurrentSpiral(true);
    const button3d = viewButtons.find(btn => btn.dataset.view === '3d');
    if (button3d) {
      button3d.click();
    }
  });
}

populateAnimationPresets();
rebuildFramesUI();
toggleAnimationControls(false);
updateAnimateSvg(null);

updateExportAvailability(false);
toggleFillSettings();
updateTValue();
renderCurrentSpiral(true);
