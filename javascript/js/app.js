import { renderSpiral, normaliseParams } from './doyle_spiral_engine.js';
import { createThreeViewer } from './three_viewer.js';
import { ANIMATION_PRESETS, generatePresetFrames } from './animation_presets.js';

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
const svgWorkspace = document.getElementById('svgWorkspace');
const svg2dHost = document.getElementById('svg2dHost');
const svgAnimateHost = document.getElementById('svgAnimateHost');
const animationPresetSelect = document.getElementById('animationPreset');
const animationAddFrameButton = document.getElementById('animationAddFrame');
const animationClearButton = document.getElementById('animationClear');
const animationGenerateButton = document.getElementById('animationGenerate');
const animationStatus = document.getElementById('animationStatus');
const animationFrameSummary = document.getElementById('animationFrameSummary');
const animationFrameSlider = document.getElementById('animationFrameSlider');
const animationFrameScale = document.getElementById('animationFrameScale');
const animationFrameLabel = document.getElementById('animationFrameLabel');
const animationPlayButton = document.getElementById('animationPlay');
const animationPauseButton = document.getElementById('animationPause');
const animationPrevButton = document.getElementById('animationPrev');
const animationNextButton = document.getElementById('animationNext');
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

const SVG_NS = 'http://www.w3.org/2000/svg';

const overlayMap = new Map();
let frameIdCounter = 0;
let playbackHandle = null;

const PLAYBACK_INTERVAL_MS = 750;

const animationState = {
  frames: [],
  activeFrame: 0,
  assignments: new Map(),
  geometry: null,
  groupMap: new Map(),
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

function moveWorkspaceTo(host) {
  if (!host || !svgWorkspace) {
    return;
  }
  if (svgWorkspace.parentElement !== host) {
    host.appendChild(svgWorkspace);
  }
}

function setWorkspaceAnimateMode(enabled) {
  if (!svgWorkspace) {
    return;
  }
  svgWorkspace.classList.toggle('animate-mode', Boolean(enabled));
}

function updateAnimationStatus(message, state = 'idle') {
  if (!animationStatus) {
    return;
  }
  animationStatus.textContent = message;
  animationStatus.classList.remove('loading', 'error');
  if (state !== 'idle') {
    animationStatus.classList.add(state);
  }
}

function isPlaybackActive() {
  return playbackHandle !== null;
}

function updatePlaybackControls() {
  const frameCount = animationState.frames.length;
  const hasFrames = frameCount > 0;
  const hasMultiple = frameCount > 1;
  if (animationPlayButton) {
    animationPlayButton.disabled = !hasMultiple || isPlaybackActive();
  }
  if (animationPauseButton) {
    animationPauseButton.disabled = !isPlaybackActive();
  }
  if (animationPrevButton) {
    animationPrevButton.disabled = !hasMultiple;
  }
  if (animationNextButton) {
    animationNextButton.disabled = !hasMultiple;
  }
  if (animationFrameSlider) {
    animationFrameSlider.disabled = !hasFrames || frameCount <= 1;
  }
}

function stopAnimationPlayback(message) {
  if (!isPlaybackActive()) {
    return;
  }
  window.clearInterval(playbackHandle);
  playbackHandle = null;
  updatePlaybackControls();
  if (message) {
    updateAnimationStatus(message);
  }
}

function advanceFrame(step, notify = true) {
  const frameCount = animationState.frames.length;
  if (!frameCount) {
    return;
  }
  const nextIndex = (animationState.activeFrame + step + frameCount) % frameCount;
  setActiveFrame(nextIndex, notify);
}

function startAnimationPlayback() {
  if (isPlaybackActive() || animationState.frames.length <= 1) {
    return;
  }
  playbackHandle = window.setInterval(() => {
    advanceFrame(1, false);
  }, PLAYBACK_INTERVAL_MS);
  updatePlaybackControls();
  updateAnimationStatus('Playing animation preview…');
}

function flashArcGroup(groupId) {
  const element = overlayMap.get(String(groupId));
  if (!element) {
    return;
  }
  element.classList.remove('arc-flash');
  void element.getBoundingClientRect();
  element.classList.add('arc-flash');
  window.setTimeout(() => element.classList.remove('arc-flash'), 900);
}

function markArcGroupSelected(groupId, frameIndex) {
  const element = overlayMap.get(String(groupId));
  if (!element) {
    return;
  }
  element.classList.add('arc-assigned');
  element.dataset.assignedFrame = String(frameIndex);
  element.style.setProperty('--arc-highlight', '0');
}

function unmarkArcGroup(groupId) {
  const element = overlayMap.get(String(groupId));
  if (!element) {
    return;
  }
  element.classList.remove('arc-assigned');
  element.removeAttribute('data-assigned-frame');
  element.removeAttribute('data-highlight-state');
  element.style.setProperty('--arc-highlight', '0');
}

function refreshOverlayHighlights() {
  const activeIndex = animationState.activeFrame;
  overlayMap.forEach((element, groupId) => {
    const assignedFrame = animationState.assignments.get(groupId);
    if (assignedFrame == null) {
      element.classList.remove('arc-assigned');
      element.removeAttribute('data-assigned-frame');
      element.removeAttribute('data-highlight-state');
      element.style.setProperty('--arc-highlight', '0');
      return;
    }

    element.classList.add('arc-assigned');
    element.dataset.assignedFrame = String(assignedFrame);
    let highlight = 0.18;
    let state = 'upcoming';
    if (assignedFrame <= activeIndex) {
      const diff = activeIndex - assignedFrame;
      highlight = Math.pow(0.5, diff);
      state = diff === 0 ? 'active' : 'history';
    }
    const clamped = Math.max(0, Math.min(0.9, highlight));
    element.dataset.highlightState = state;
    element.style.setProperty('--arc-highlight', clamped.toFixed(3));
  });
}

function createFrame(initialGroups = []) {
  frameIdCounter += 1;
  return {
    id: frameIdCounter,
    groups: initialGroups.slice(),
    angle: null,
  };
}

function ensureFrameExists(index) {
  if (!Number.isInteger(index) || index < 0) {
    return;
  }
  while (animationState.frames.length <= index) {
    animationState.frames.push(createFrame());
  }
}

function resetAnimationState(geometry, preserveLength = false) {
  stopAnimationPlayback();
  const hasData = hasGeometry(geometry);
  animationState.geometry = hasData ? geometry : null;
  animationState.groupMap = new Map();
  animationState.assignments = new Map();
  frameIdCounter = 0;

  if (hasData) {
    geometry.arcgroups.forEach(group => {
      const id = String(group.id);
      animationState.groupMap.set(id, {
        id,
        ring: Number.isFinite(group.ring_index) ? group.ring_index : null,
        name: group.name || `Arc ${id}`,
        lineAngle: Number(group.line_angle) || 0,
        ref: group,
      });
    });
  }

  const frameCount = preserveLength
    ? Math.max(1, animationState.frames.length)
    : hasData
    ? 4
    : 1;
  animationState.frames = [];
  for (let idx = 0; idx < frameCount; idx += 1) {
    animationState.frames.push(createFrame());
  }
  animationState.activeFrame = 0;

  overlayMap.forEach(element => {
    element.classList.remove('arc-assigned', 'arc-flash');
    element.removeAttribute('data-assigned-frame');
    element.removeAttribute('data-highlight-state');
    element.style.setProperty('--arc-highlight', '0');
  });

  refreshOverlayHighlights();

  if (animationPresetSelect) {
    animationPresetSelect.value = 'manual';
    animationPresetSelect.disabled = !hasData;
  }
  if (animationGenerateButton) {
    animationGenerateButton.disabled = !hasData;
  }

  renderAnimationFrames();
  if (!hasData && !preserveLength) {
    updateAnimationStatus('Render a spiral to begin animating.');
  }
}

function getFrameContributions(frameIndex) {
  const contributions = [];
  if (!animationState.frames.length) {
    return contributions;
  }
  for (let sourceIdx = 0; sourceIdx <= frameIndex; sourceIdx += 1) {
    const frame = animationState.frames[sourceIdx];
    if (!frame || !frame.groups.length) {
      continue;
    }
    const diff = frameIndex - sourceIdx;
    const strength = Math.pow(0.5, diff);
    frame.groups.forEach(groupId => {
      contributions.push({
        groupId,
        sourceFrame: sourceIdx,
        strength,
        diff,
      });
    });
  }
  return contributions;
}

function renderAnimationFrames() {
  const frameCount = animationState.frames.length;

  if (frameCount === 0) {
    if (animationFrameSlider) {
      animationFrameSlider.min = 0;
      animationFrameSlider.max = 0;
      animationFrameSlider.value = 0;
      animationFrameSlider.disabled = true;
    }
    if (animationFrameScale) {
      animationFrameScale.replaceChildren();
    }
    if (animationFrameLabel) {
      animationFrameLabel.textContent = 'No frames';
    }
    if (animationFrameSummary) {
      animationFrameSummary.replaceChildren();
      const placeholder = document.createElement('div');
      placeholder.className = 'status';
      placeholder.textContent = 'Add frames or choose a preset to begin.';
      animationFrameSummary.appendChild(placeholder);
    }
    updatePlaybackControls();
    refreshOverlayHighlights();
    return;
  }

  if (animationState.activeFrame >= frameCount) {
    animationState.activeFrame = frameCount - 1;
  }
  if (animationState.activeFrame < 0) {
    animationState.activeFrame = 0;
  }

  const activeIndex = animationState.activeFrame;
  const activeFrame = animationState.frames[activeIndex];

  if (animationFrameSlider) {
    animationFrameSlider.min = 1;
    animationFrameSlider.max = frameCount;
    animationFrameSlider.step = 1;
    animationFrameSlider.value = activeIndex + 1;
    animationFrameSlider.disabled = frameCount <= 1;
  }

  if (animationFrameScale) {
    animationFrameScale.replaceChildren();
    for (let idx = 0; idx < frameCount; idx += 1) {
      const marker = document.createElement('span');
      marker.textContent = String(idx + 1);
      if (idx === activeIndex) {
        marker.classList.add('active');
      }
      animationFrameScale.appendChild(marker);
    }
  }

  if (animationFrameLabel) {
    animationFrameLabel.textContent = `Frame ${activeIndex + 1} of ${frameCount}`;
  }

  if (animationFrameSummary) {
    animationFrameSummary.replaceChildren();

    const header = document.createElement('div');
    header.className = 'frame-header';
    const label = document.createElement('span');
    label.textContent = `Frame ${activeIndex + 1}`;
    const count = document.createElement('span');
    count.textContent = `${activeFrame.groups.length} arc${activeFrame.groups.length === 1 ? '' : 's'}`;
    header.append(label, count);
    animationFrameSummary.appendChild(header);

    const groupsContainer = document.createElement('div');
    groupsContainer.className = 'frame-groups';
    const contributions = getFrameContributions(activeIndex);
    if (!contributions.length) {
      const placeholder = document.createElement('div');
      placeholder.className = 'status';
      placeholder.textContent = 'Click circles to add arcs to this frame.';
      groupsContainer.appendChild(placeholder);
    } else {
      const currentEntries = [];
      const previousByFrame = new Map();
      contributions.forEach(entry => {
        if (entry.sourceFrame === activeIndex) {
          currentEntries.push(entry);
        } else {
          if (!previousByFrame.has(entry.sourceFrame)) {
            previousByFrame.set(entry.sourceFrame, []);
          }
          previousByFrame.get(entry.sourceFrame).push(entry);
        }
      });
      const orderedEntries = currentEntries.slice();
      for (let idx = activeIndex - 1; idx >= 0; idx -= 1) {
        const bucket = previousByFrame.get(idx);
        if (bucket && bucket.length) {
          orderedEntries.push(...bucket);
        }
      }

      orderedEntries.forEach(entry => {
        const badge = document.createElement('span');
        badge.className = 'frame-group';
        const meta = animationState.groupMap.get(String(entry.groupId));
        const ringLabel = meta && Number.isInteger(meta.ring) ? `R${meta.ring + 1}` : 'R–';
        badge.textContent = `${ringLabel} • #${entry.groupId}`;
        badge.title = entry.sourceFrame === activeIndex
          ? 'Current frame'
          : `From frame ${entry.sourceFrame + 1}`;
        if (entry.sourceFrame !== activeIndex) {
          badge.classList.add('ghost');
          badge.style.opacity = entry.strength.toString();
        } else {
          badge.style.opacity = '1';
          const removeButton = document.createElement('button');
          removeButton.type = 'button';
          removeButton.setAttribute('aria-label', 'Remove arc from frame');
          removeButton.textContent = '×';
          removeButton.addEventListener('click', event => {
            event.stopPropagation();
            removeGroupFromFrame(entry.groupId, activeIndex);
          });
          badge.appendChild(removeButton);
        }
        groupsContainer.appendChild(badge);
      });
    }
    animationFrameSummary.appendChild(groupsContainer);

    const footer = document.createElement('div');
    footer.className = 'frame-footer';
    const angleLabel = document.createElement('span');
    angleLabel.textContent = 'Angle';
    const angleValue = document.createElement('span');
    angleValue.textContent = activeFrame.angle != null ? `${activeFrame.angle.toFixed(1)}°` : '—';
    footer.append(angleLabel, angleValue);
    animationFrameSummary.appendChild(footer);
  }

  updatePlaybackControls();
  refreshOverlayHighlights();
}

function setActiveFrame(index, notify = true) {
  if (!animationState.frames.length || index < 0 || index >= animationState.frames.length) {
    return;
  }
  animationState.activeFrame = index;
  renderAnimationFrames();
  if (notify) {
    updateAnimationStatus(`Frame ${index + 1} selected.`);
  }
}

function addFrame() {
  stopAnimationPlayback();
  animationState.frames.push(createFrame());
  setActiveFrame(animationState.frames.length - 1);
  updateAnimationStatus(`Frame ${animationState.activeFrame + 1} added.`);
}

function clearFrames() {
  resetAnimationState(animationState.geometry, false);
  updateAnimationStatus('Timeline cleared. Frames reset to default.');
}

function removeGroupFromFrame(groupId, frameIndex) {
  stopAnimationPlayback();
  const frame = animationState.frames[frameIndex];
  if (!frame) {
    return;
  }
  frame.groups = frame.groups.filter(id => id !== groupId);
  animationState.assignments.delete(groupId);
  unmarkArcGroup(groupId);
  renderAnimationFrames();
  updateAnimationStatus(`Removed arc from frame ${frameIndex + 1}.`);
}

function handleArcGroupClick(event) {
  if (activeView !== 'animate') {
    return;
  }
  if (!animationState.geometry) {
    updateAnimationStatus('Render the spiral before assigning frames.', 'error');
    return;
  }
  const target = event.currentTarget;
  const groupId = target.dataset.arcGroupId;
  if (!groupId) {
    return;
  }
  stopAnimationPlayback();
  if (animationState.assignments.has(groupId)) {
    const assignedFrame = animationState.assignments.get(groupId);
    if (assignedFrame === animationState.activeFrame) {
      removeGroupFromFrame(groupId, assignedFrame);
    } else {
      updateAnimationStatus(
        `Arc already assigned to frame ${assignedFrame + 1}. Select that frame to edit.`,
        'error',
      );
      flashArcGroup(groupId);
    }
    return;
  }
  ensureFrameExists(animationState.activeFrame);
  animationState.frames[animationState.activeFrame].groups.push(groupId);
  animationState.assignments.set(groupId, animationState.activeFrame);
  markArcGroupSelected(groupId, animationState.activeFrame);
  flashArcGroup(groupId);
  renderAnimationFrames();
  updateAnimationStatus(`Arc added to frame ${animationState.activeFrame + 1}.`);
}

function buildArcGroupOverlay(svgElement, geometry) {
  overlayMap.clear();
  if (!svgElement) {
    return;
  }
  const existing = svgElement.querySelector('.arcgroup-overlay');
  if (existing) {
    existing.remove();
  }
  if (!hasGeometry(geometry)) {
    return;
  }
  const overlay = document.createElementNS(SVG_NS, 'g');
  overlay.classList.add('arcgroup-overlay');
  svgElement.appendChild(overlay);
  geometry.arcgroups.forEach(group => {
    if (!Array.isArray(group.outline) || !group.outline.length) {
      return;
    }
    const polygon = document.createElementNS(SVG_NS, 'polygon');
    const points = group.outline
      .map(point => {
        const x = Number(point[0]) || 0;
        const y = Number(point[1]) || 0;
        return `${x.toFixed(4)},${y.toFixed(4)}`;
      })
      .join(' ');
    polygon.setAttribute('points', points);
    polygon.dataset.arcGroupId = String(group.id);
    if (group.ring_index !== undefined && group.ring_index !== null) {
      polygon.dataset.ringIndex = String(group.ring_index);
    }
    if (group.line_angle !== undefined && group.line_angle !== null) {
      polygon.dataset.lineAngle = String(group.line_angle);
    }
    polygon.style.setProperty('--arc-highlight', '0');
    polygon.addEventListener('click', handleArcGroupClick);
    overlay.appendChild(polygon);
    overlayMap.set(String(group.id), polygon);
  });
}

function applyPresetFrames(frameGroups, presetId = 'manual') {
  stopAnimationPlayback();
  if (!animationState.geometry) {
    updateAnimationStatus('Render the spiral before applying presets.', 'error');
    return;
  }
  frameIdCounter = 0;
  animationState.frames = [];
  animationState.assignments.clear();
  overlayMap.forEach(element => {
    element.classList.remove('arc-assigned', 'arc-flash');
    element.removeAttribute('data-assigned-frame');
    element.removeAttribute('data-highlight-state');
    element.style.setProperty('--arc-highlight', '0');
  });

  const frames = Array.isArray(frameGroups) && frameGroups.length ? frameGroups : [[]];
  frames.forEach(groups => {
    const filtered = (groups || [])
      .map(id => String(id))
      .filter(id => animationState.groupMap.has(id));
    animationState.frames.push(createFrame(filtered));
  });
  if (!animationState.frames.length) {
    animationState.frames.push(createFrame());
  }
  animationState.frames.forEach((frame, index) => {
    frame.groups.forEach(groupId => {
      animationState.assignments.set(groupId, index);
      markArcGroupSelected(groupId, index);
    });
  });
  animationState.activeFrame = 0;
  if (animationPresetSelect) {
    animationPresetSelect.value = presetId;
  }
  renderAnimationFrames();
  updateAnimationStatus('Preset applied. You can refine the frames manually.');
}

function prepareAnimationGeometry() {
  if (!svgPreview) {
    return;
  }
  const svgElement = svgPreview.querySelector('svg');
  if (!svgElement || !lastRender || !hasGeometry(lastRender.geometry)) {
    resetAnimationState(null, false);
    return;
  }
  buildArcGroupOverlay(svgElement, lastRender.geometry);
  resetAnimationState(lastRender.geometry, false);
  updateAnimationStatus('Select a frame and click an arc to build the sequence.');
}

function applyAnimationToGeometry() {
  stopAnimationPlayback();
  if (!animationState.geometry) {
    updateAnimationStatus('Render the spiral before animating.', 'error');
    return;
  }
  if (!animationState.frames.length) {
    updateAnimationStatus('Add at least one frame before animating.', 'error');
    return;
  }
  const framesWithGroups = animationState.frames
    .map((frame, index) => ({ frame, index }))
    .filter(entry => entry.frame.groups.length > 0);
  if (!framesWithGroups.length) {
    updateAnimationStatus('Add arcs to at least one frame to animate.', 'error');
    return;
  }

  if (fillToggle && !fillToggle.checked) {
    fillToggle.checked = true;
    toggleFillSettings();
  }
  const angleStep = 180 / framesWithGroups.length;
  framesWithGroups.forEach((entry, orderIndex) => {
    const angle = orderIndex * angleStep;
    entry.frame.angle = angle;
    entry.frame.groups.forEach(groupId => {
      const meta = animationState.groupMap.get(groupId);
      if (meta && meta.ref) {
        meta.ref.line_angle = angle;
        meta.lineAngle = angle;
      }
      const overlayElement = overlayMap.get(groupId);
      if (overlayElement) {
        overlayElement.dataset.lineAngle = angle.toFixed(2);
      }
    });
  });
  animationState.frames
    .filter(frame => frame.groups.length === 0)
    .forEach(frame => {
      frame.angle = null;
    });

  renderAnimationFrames();
  updateAnimationStatus('Animation angles applied. Opening 3D view…', 'loading');

  if (lastRender) {
    lastRender.geometry = animationState.geometry;
  }

  const params = collectParams();
  if (threeApp) {
    threeApp.useGeometryFromPayload(params, animationState.geometry);
  }

  const view3dButton = viewButtons.find(button => button.dataset.view === '3d');
  if (view3dButton) {
    view3dButton.click();
  }

  setStatus('Animation generated. Inspect it in the 3D view.');
  updateAnimationStatus('Animation ready. 3D view updated.');
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

async function renderCurrentSpiral(showLoading = true) {
  const params = collectParams();
  if (showLoading) {
    setStatus('Rendering spiral…', 'loading');
  }
  try {
    const result = renderSpiral(params);
    showSVG(result.svg);

    const geometry = hasGeometry(result.geometry) ? result.geometry : null;
    lastRender = { params, geometry, mode: params.mode, svgString: result.svgString };

    updateStats(geometry);
    statMode.textContent = params.mode === 'arram_boyle' ? 'Arram-Boyle' : 'Classic Doyle';
    setStatus('Spiral updated. Switch views to explore it in 3D.');
    updateExportAvailability(true);
    prepareAnimationGeometry();

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
    setStatus(error.message || 'Unexpected error', 'error');
    lastRender = null;
    updateExportAvailability(false);
    resetAnimationState(null, false);
    updateAnimationStatus('Unable to render spiral for animation.', 'error');
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

    const show3d = view === '3d';
    const showAnimate = view === 'animate';
    const show2d = view === '2d';

    if (!showAnimate) {
      stopAnimationPlayback();
    }

    if (view2d) {
      view2d.hidden = !show2d;
    }
    if (viewAnimate) {
      viewAnimate.hidden = !showAnimate;
    }
    view3d.hidden = !show3d;

    if (show2d) {
      moveWorkspaceTo(svg2dHost);
      setWorkspaceAnimateMode(false);
    } else if (showAnimate) {
      moveWorkspaceTo(svgAnimateHost);
      setWorkspaceAnimateMode(true);
      renderAnimationFrames();
      if (animationState.geometry) {
        updateAnimationStatus('Select a frame and click an arc to build the sequence.');
      } else {
        updateAnimationStatus('Render a spiral to begin animating.');
      }
    } else {
      setWorkspaceAnimateMode(false);
    }

    if (!show3d) {
      updateStats(lastRender ? lastRender.geometry : null);
    } else if (statsBlock) {
      statsBlock.hidden = true;
    }

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

if (animationAddFrameButton) {
  animationAddFrameButton.addEventListener('click', addFrame);
}

if (animationClearButton) {
  animationClearButton.addEventListener('click', clearFrames);
}

if (animationGenerateButton) {
  animationGenerateButton.addEventListener('click', applyAnimationToGeometry);
}

if (animationFrameSlider) {
  animationFrameSlider.addEventListener('input', event => {
    if (!animationState.frames.length) {
      event.target.value = 0;
      return;
    }
    stopAnimationPlayback();
    const value = Number(event.target.value) || 1;
    const index = Math.min(animationState.frames.length - 1, Math.max(0, value - 1));
    setActiveFrame(index, false);
  });
  animationFrameSlider.addEventListener('change', event => {
    if (!animationState.frames.length) {
      return;
    }
    stopAnimationPlayback();
    const value = Number(event.target.value) || 1;
    const index = Math.min(animationState.frames.length - 1, Math.max(0, value - 1));
    setActiveFrame(index);
  });
}

if (animationPrevButton) {
  animationPrevButton.addEventListener('click', () => {
    if (animationState.frames.length <= 1) {
      return;
    }
    stopAnimationPlayback();
    advanceFrame(-1);
  });
}

if (animationNextButton) {
  animationNextButton.addEventListener('click', () => {
    if (animationState.frames.length <= 1) {
      return;
    }
    stopAnimationPlayback();
    advanceFrame(1);
  });
}

if (animationPlayButton) {
  animationPlayButton.addEventListener('click', () => {
    if (animationState.frames.length <= 1) {
      updateAnimationStatus('Add at least two frames to play the sequence.', 'error');
      return;
    }
    startAnimationPlayback();
  });
}

if (animationPauseButton) {
  animationPauseButton.addEventListener('click', () => {
    if (!isPlaybackActive()) {
      return;
    }
    stopAnimationPlayback('Playback paused.');
  });
}

if (animationPresetSelect) {
  Object.values(ANIMATION_PRESETS).forEach(preset => {
    const option = animationPresetSelect.querySelector(`option[value="${preset.id}"]`);
    if (option && preset.description) {
      option.title = preset.description;
    }
  });
  animationPresetSelect.addEventListener('change', () => {
    const presetId = animationPresetSelect.value;
    if (presetId === 'manual') {
      resetAnimationState(animationState.geometry, true);
      updateAnimationStatus('Manual selection enabled.');
      return;
    }
    if (!animationState.geometry) {
      updateAnimationStatus('Render the spiral before applying presets.', 'error');
      animationPresetSelect.value = 'manual';
      return;
    }
    const frames = generatePresetFrames(presetId, animationState.geometry.arcgroups || []);
    if (!frames.length) {
      updateAnimationStatus('Preset did not yield frames for this geometry.', 'error');
      animationPresetSelect.value = 'manual';
      return;
    }
    applyPresetFrames(frames, presetId);
  });
}

resetAnimationState(null, false);
updateExportAvailability(false);
toggleFillSettings();
updateTValue();
renderCurrentSpiral(true);
