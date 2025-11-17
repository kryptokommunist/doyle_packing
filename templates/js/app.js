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
const svgAnimateContainer = document.getElementById('svgAnimateContainer');
const animatePanel = document.getElementById('animatePanel');
const animationPresetSelect = document.getElementById('animationPreset');
const applyPresetButton = document.getElementById('applyPresetButton');
const frameList = document.getElementById('frameList');
const frameCountInput = document.getElementById('frameCountInput');
const clearAnimationButton = document.getElementById('clearAnimationButton');
const animateSequenceButton = document.getElementById('animateSequenceButton');
const animationStatusEl = document.getElementById('animationStatus');

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

const DEFAULT_FRAME_COUNT = 6;
const MAX_FRAMES = 24;

let activeView = '2d';
let lastRender = null;
let threeApp = null;

const animationState = {
  frames: [],
  selectedFrameIndex: 0,
  assignments: new Map(),
  arcGroups: new Map(),
  previewTimer: null,
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

function computeOutlineCentroid(outline) {
  if (!outline || !outline.length) {
    return { x: 0, y: 0 };
  }
  let area = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0, j = outline.length - 1; i < outline.length; j = i, i += 1) {
    const [x0, y0] = outline[j];
    const [x1, y1] = outline[i];
    const cross = x0 * y1 - x1 * y0;
    area += cross;
    cx += (x0 + x1) * cross;
    cy += (y0 + y1) * cross;
  }
  area *= 0.5;
  if (Math.abs(area) < 1e-6) {
    let sumX = 0;
    let sumY = 0;
    for (const [x, y] of outline) {
      sumX += x;
      sumY += y;
    }
    const inv = 1 / outline.length;
    return { x: sumX * inv, y: sumY * inv };
  }
  const factor = 1 / (6 * area);
  return { x: cx * factor, y: cy * factor };
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

function setAnimationStatus(message, state = 'info') {
  if (!animationStatusEl) {
    return;
  }
  animationStatusEl.textContent = message;
  animationStatusEl.classList.remove('success', 'error');
  if (state === 'success' || state === 'error') {
    animationStatusEl.classList.add(state);
  }
}

function getFramePalette(index) {
  const hue = 46;
  const saturation = 88;
  const baseLightness = 62;
  const attenuation = Math.pow(0.75, index);
  const lightness = Math.max(26, Math.min(82, baseLightness * attenuation));
  const borderLightness = Math.max(20, lightness - 12);
  const background = `hsl(${hue}, ${saturation}%, ${lightness.toFixed(1)}%)`;
  const border = `hsl(${hue}, ${Math.min(96, saturation + 4)}%, ${borderLightness.toFixed(1)}%)`;
  const text = lightness < 45 ? '#f8fafc' : '#1f2937';
  return { background, border, text };
}

function resetAnimationState(frameCount = DEFAULT_FRAME_COUNT) {
  const count = Math.max(1, Math.min(MAX_FRAMES, Number(frameCount) || DEFAULT_FRAME_COUNT));
  animationState.frames = Array.from({ length: count }, () => ({ arcs: [] }));
  animationState.assignments.clear();
  animationState.selectedFrameIndex = 0;
  if (frameCountInput) {
    frameCountInput.value = String(count);
  }
}

function triggerArcPulse(element) {
  if (!element) {
    return;
  }
  element.classList.remove('is-pulsing');
  void element.getBoundingClientRect();
  element.classList.add('is-pulsing');
  setTimeout(() => element.classList.remove('is-pulsing'), 900);
}

function updateArcGroupHighlights() {
  animationState.arcGroups.forEach((info, id) => {
    const element = info.element;
    if (!element) {
      return;
    }
    const assignedFrame = animationState.assignments.get(id);
    element.classList.toggle('is-selected', assignedFrame !== undefined);
    element.classList.toggle('is-highlighted', assignedFrame === animationState.selectedFrameIndex);
    if (assignedFrame !== undefined) {
      element.dataset.assignedFrame = String(assignedFrame);
    } else if (element.dataset.assignedFrame) {
      delete element.dataset.assignedFrame;
    }
  });
}

function updateFrameUI() {
  if (!frameList) {
    return;
  }
  frameList.innerHTML = '';
  const frameCount = animationState.frames.length;
  if (!frameCount) {
    const empty = document.createElement('div');
    empty.className = 'animate-status error';
    empty.textContent = 'Animation is available only for Arram-Boyle arc groups.';
    frameList.appendChild(empty);
    return;
  }
  const angleStep = 180 / Math.max(1, frameCount);
  animationState.frames.forEach((frame, index) => {
    const card = document.createElement('div');
    card.className = 'frame-card';
    card.dataset.frameIndex = String(index);
    const palette = getFramePalette(index);
    if (index === animationState.selectedFrameIndex) {
      card.classList.add('frame-card--selected');
    }
    card.style.borderColor = palette.border;

    const chips = document.createElement('div');
    chips.className = 'frame-card__chips';
    if (frame.arcs.length) {
      for (const arcId of frame.arcs) {
        const info = animationState.arcGroups.get(arcId);
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'frame-chip';
        chip.dataset.arcId = String(arcId);
        chip.dataset.frameIndex = String(index);
        chip.textContent = info ? info.label : `Arc ${arcId}`;
        chip.style.background = palette.background;
        chip.style.border = `1px solid ${palette.border}`;
        chip.style.color = palette.text;
        const remove = document.createElement('span');
        remove.textContent = '×';
        chip.appendChild(remove);
        chips.appendChild(chip);
      }
    } else {
      const empty = document.createElement('div');
      empty.className = 'frame-card__empty';
      empty.textContent = 'No arcs yet. Click the SVG to add.';
      chips.appendChild(empty);
    }
    card.appendChild(chips);

    const label = document.createElement('div');
    label.className = 'frame-card__label';
    const frameLabel = document.createElement('span');
    frameLabel.textContent = `Frame ${index + 1}`;
    const angleLabel = document.createElement('span');
    angleLabel.className = 'frame-card__angle';
    angleLabel.textContent = `${(index * angleStep).toFixed(1)}°`;
    label.appendChild(frameLabel);
    label.appendChild(angleLabel);
    card.appendChild(label);

    frameList.appendChild(card);
  });
}

function selectFrame(index) {
  if (!animationState.frames.length) {
    return;
  }
  if (!Number.isFinite(index)) {
    return;
  }
  const clamped = Math.max(0, Math.min(animationState.frames.length - 1, index));
  animationState.selectedFrameIndex = clamped;
  updateFrameUI();
  updateArcGroupHighlights();
}

function removeArcFromFrame(frameIndex, arcId) {
  if (!Number.isFinite(frameIndex) || !Number.isFinite(arcId)) {
    return;
  }
  const frame = animationState.frames[frameIndex];
  if (!frame) {
    return;
  }
  const position = frame.arcs.indexOf(arcId);
  if (position === -1) {
    return;
  }
  frame.arcs.splice(position, 1);
  animationState.assignments.delete(arcId);
  updateFrameUI();
  updateArcGroupHighlights();
  setAnimationStatus(`Removed from frame ${frameIndex + 1}.`);
}

function clearAnimationAssignments() {
  if (animationState.previewTimer) {
    clearTimeout(animationState.previewTimer);
    animationState.previewTimer = null;
  }
  animationState.frames.forEach(frame => {
    frame.arcs = [];
  });
  animationState.assignments.clear();
  animationState.selectedFrameIndex = 0;
  updateFrameUI();
  updateArcGroupHighlights();
  setAnimationStatus('Cleared animation timeline.');
}

function adjustFrameCount(newCount) {
  const count = Math.max(1, Math.min(MAX_FRAMES, Number(newCount) || DEFAULT_FRAME_COUNT));
  if (count === animationState.frames.length) {
    if (frameCountInput) {
      frameCountInput.value = String(count);
    }
    return;
  }
  if (animationState.previewTimer) {
    clearTimeout(animationState.previewTimer);
    animationState.previewTimer = null;
  }
  const allArcIds = animationState.frames.flatMap(frame => frame.arcs.slice());
  animationState.frames = Array.from({ length: count }, () => ({ arcs: [] }));
  animationState.assignments.clear();
  allArcIds.forEach((arcId, index) => {
    const frameIndex = index % count;
    animationState.frames[frameIndex].arcs.push(arcId);
    animationState.assignments.set(arcId, frameIndex);
  });
  animationState.selectedFrameIndex = Math.min(animationState.selectedFrameIndex, animationState.frames.length - 1);
  if (frameCountInput) {
    frameCountInput.value = String(count);
  }
  updateFrameUI();
  updateArcGroupHighlights();
  setAnimationStatus(`Frames updated to ${count}.`);
}

function createEmptyFrameArray(frameCount) {
  const count = Math.max(1, frameCount);
  return Array.from({ length: count }, () => []);
}

function generateRingAlternate(groups, frameCount) {
  const frames = createEmptyFrameArray(frameCount);
  const ringMap = new Map();
  groups.forEach(group => {
    const key = group.ringIndex ?? 0;
    if (!ringMap.has(key)) {
      ringMap.set(key, []);
    }
    ringMap.get(key).push(group);
  });
  const ringKeys = Array.from(ringMap.keys()).sort((a, b) => a - b);
  let cursor = 0;
  ringKeys.forEach((key, index) => {
    const entries = ringMap.get(key) || [];
    entries.sort((a, b) => a.polarAngle - b.polarAngle);
    if (index % 2 === 1) {
      entries.reverse();
    }
    entries.forEach(entry => {
      const frameIndex = cursor % frameCount;
      frames[frameIndex].push(entry.id);
      cursor += 1;
    });
  });
  return frames;
}

function generateSpiralArmsOut(groups, frameCount) {
  const frames = createEmptyFrameArray(frameCount);
  const sorted = groups.slice().sort((a, b) => {
    if (a.radius === b.radius) {
      return a.polarAngle - b.polarAngle;
    }
    return a.radius - b.radius;
  });
  sorted.forEach(group => {
    const angleNorm = (group.polarAngle + Math.PI) / (2 * Math.PI);
    const frameIndex = Math.floor(angleNorm * frameCount) % frameCount;
    frames[frameIndex].push(group.id);
  });
  return frames;
}

function generateRingWave(groups, frameCount) {
  const frames = createEmptyFrameArray(frameCount);
  const ringMap = new Map();
  groups.forEach(group => {
    const key = group.ringIndex ?? 0;
    if (!ringMap.has(key)) {
      ringMap.set(key, []);
    }
    ringMap.get(key).push(group);
  });
  const ringKeys = Array.from(ringMap.keys()).sort((a, b) => a - b);
  ringKeys.forEach(ringKey => {
    const entries = ringMap.get(ringKey) || [];
    entries.sort((a, b) => a.polarAngle - b.polarAngle);
    entries.forEach((entry, index) => {
      const frameIndex = (ringKey + index) % frameCount;
      frames[frameIndex].push(entry.id);
    });
  });
  return frames;
}

function generateSineRipple(groups, frameCount) {
  const frames = createEmptyFrameArray(frameCount);
  const sorted = groups.slice().sort((a, b) => a.polarAngle - b.polarAngle);
  sorted.forEach(group => {
    const wave = (Math.sin(group.polarAngle * 2) + 1) / 2;
    const frameIndex = Math.min(frameCount - 1, Math.round(wave * (frameCount - 1)));
    frames[frameIndex].push(group.id);
  });
  return frames;
}

function generateRandomSpark(groups, frameCount) {
  const frames = createEmptyFrameArray(frameCount);
  const shuffled = groups.slice();
  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  shuffled.forEach((group, index) => {
    const frameIndex = index % frameCount;
    frames[frameIndex].push(group.id);
  });
  return frames;
}

function normalisePresetOutput(rawFrames, groups, frameCount) {
  const frames = Array.from({ length: frameCount }, (_, index) => {
    const list = Array.isArray(rawFrames[index]) ? rawFrames[index].slice() : [];
    return list;
  });
  const seen = new Set();
  frames.forEach(list => {
    for (let i = list.length - 1; i >= 0; i -= 1) {
      const id = list[i];
      if (seen.has(id)) {
        list.splice(i, 1);
      } else {
        seen.add(id);
      }
    }
  });
  const missing = groups.filter(group => !seen.has(group.id));
  missing.forEach((group, index) => {
    frames[index % frameCount].push(group.id);
    seen.add(group.id);
  });
  return frames;
}

const ANIMATION_PRESETS = [
  {
    id: 'ring-alternate',
    label: 'Alternating rings sweep',
    generator: generateRingAlternate,
  },
  {
    id: 'spiral-out',
    label: 'Spiral arms outward',
    generator: generateSpiralArmsOut,
  },
  {
    id: 'ring-wave',
    label: 'Ring wavefront',
    generator: generateRingWave,
  },
  {
    id: 'sine-ripple',
    label: 'Sine ripple around rings',
    generator: generateSineRipple,
  },
  {
    id: 'random-spark',
    label: 'Random spark burst',
    generator: generateRandomSpark,
  },
];

function applyAnimationPreset(presetId) {
  if (!animationState.arcGroups.size) {
    setAnimationStatus('Load an Arram-Boyle spiral before applying presets.', 'error');
    return;
  }
  const preset = ANIMATION_PRESETS.find(entry => entry.id === presetId) || ANIMATION_PRESETS[0];
  const frameCount = animationState.frames.length || DEFAULT_FRAME_COUNT;
  const groups = Array.from(animationState.arcGroups.values());
  const rawFrames = preset.generator(groups, frameCount);
  const frames = normalisePresetOutput(rawFrames, groups, frameCount);
  frames.forEach((list, index) => {
    animationState.frames[index].arcs = list.slice();
  });
  animationState.assignments.clear();
  animationState.frames.forEach((frame, index) => {
    frame.arcs.forEach(id => animationState.assignments.set(id, index));
  });
  animationState.selectedFrameIndex = 0;
  updateFrameUI();
  updateArcGroupHighlights();
  setAnimationStatus(`${preset.label} preset applied.`, 'success');
}

function updateSVGLineAngles(geometry) {
  if (!geometry) {
    return;
  }
  const svgElement = svgPreview.querySelector('svg');
  if (!svgElement) {
    return;
  }
  const angleMap = new Map();
  geometry.arcgroups.forEach(group => {
    angleMap.set(String(group.id), group.line_angle ?? 0);
  });
  const elements = svgElement.querySelectorAll('[data-arc-group-id]');
  elements.forEach(element => {
    const id = element.dataset.arcGroupId;
    if (!angleMap.has(id)) {
      return;
    }
    const value = angleMap.get(id);
    element.dataset.lineAngle = String(value);
    const overlay = element.querySelector('.arc-group-hit');
    if (overlay) {
      overlay.dataset.lineAngle = String(value);
    }
  });
  animationState.arcGroups.forEach(info => {
    const value = angleMap.get(String(info.id));
    if (value !== undefined) {
      info.lineAngle = value;
    }
  });
}

function playTimelinePreview() {
  if (animationState.previewTimer) {
    clearTimeout(animationState.previewTimer);
    animationState.previewTimer = null;
  }
  if (!animationState.frames.length) {
    return;
  }
  let index = 0;
  const step = () => {
    if (index >= animationState.frames.length) {
      animationState.previewTimer = null;
      return;
    }
    selectFrame(index);
    const arcs = animationState.frames[index].arcs;
    arcs.forEach(arcId => {
      const info = animationState.arcGroups.get(arcId);
      if (info && info.element) {
        triggerArcPulse(info.element);
      }
    });
    index += 1;
    animationState.previewTimer = setTimeout(step, 650);
  };
  step();
}

function applyAnimationAngles() {
  if (!lastRender || !hasGeometry(lastRender.geometry)) {
    setAnimationStatus('Animation requires Arram-Boyle geometry.', 'error');
    return;
  }
  if (!animationState.assignments.size) {
    setAnimationStatus('Assign at least one arc to a frame before animating.', 'error');
    return;
  }
  const frameCount = Math.max(1, animationState.frames.length);
  const angleStep = 180 / frameCount;
  const updatedArcgroups = lastRender.geometry.arcgroups.map(group => {
    const assignedFrame = animationState.assignments.get(group.id);
    if (assignedFrame !== undefined) {
      const angle = Number((assignedFrame * angleStep).toFixed(4));
      return { ...group, line_angle: angle };
    }
    return { ...group };
  });
  const updatedGeometry = { ...lastRender.geometry, arcgroups: updatedArcgroups };
  lastRender = { ...lastRender, geometry: updatedGeometry };
  updateSVGLineAngles(updatedGeometry);
  const params = collectParams();
  if (threeApp) {
    threeApp.useGeometryFromPayload(params, updatedGeometry);
  }
  setAnimationStatus('Animation sequence generated. Opening 3D view…', 'success');
  showView('3d');
  playTimelinePreview();
}

function handleArcGroupSelection(groupId) {
  if (!animationState.frames.length) {
    setAnimationStatus('Animation timeline is not available for this spiral.', 'error');
    return;
  }
  const info = animationState.arcGroups.get(groupId);
  if (!info) {
    return;
  }
  const existing = animationState.assignments.get(groupId);
  if (existing !== undefined) {
    setAnimationStatus(`Arc already assigned to frame ${existing + 1}.`, 'error');
    selectFrame(existing);
    triggerArcPulse(info.element);
    return;
  }
  const frame = animationState.frames[animationState.selectedFrameIndex];
  if (!frame) {
    setAnimationStatus('Select a frame before adding arcs.', 'error');
    return;
  }
  frame.arcs.push(groupId);
  animationState.assignments.set(groupId, animationState.selectedFrameIndex);
  updateFrameUI();
  updateArcGroupHighlights();
  triggerArcPulse(info.element);
  setAnimationStatus(`Added to frame ${animationState.selectedFrameIndex + 1}.`, 'success');
}

function prepareAnimationElements(geometry) {
  const animateToggle = viewButtons.find(button => button.dataset.view === 'animate');
  if (animationState.previewTimer) {
    clearTimeout(animationState.previewTimer);
    animationState.previewTimer = null;
  }
  if (!hasGeometry(geometry)) {
    animationState.arcGroups.clear();
    animationState.frames = [];
    animationState.assignments.clear();
    if (animateToggle) {
      animateToggle.disabled = true;
      animateToggle.setAttribute('aria-disabled', 'true');
      animateToggle.classList.remove('active');
    }
    if (animatePanel) {
      animatePanel.hidden = true;
    }
    if (svgAnimateContainer) {
      svgAnimateContainer.classList.remove('animate-mode');
    }
    if (frameCountInput) {
      frameCountInput.value = String(DEFAULT_FRAME_COUNT);
      frameCountInput.disabled = true;
    }
    if (applyPresetButton) {
      applyPresetButton.disabled = true;
    }
    if (clearAnimationButton) {
      clearAnimationButton.disabled = true;
    }
    if (animateSequenceButton) {
      animateSequenceButton.disabled = true;
    }
    if (animationPresetSelect) {
      animationPresetSelect.disabled = true;
    }
    updateFrameUI();
    if (activeView === 'animate') {
      showView('2d');
      setStatus('Animation view is only available for Arram-Boyle arcs.', 'error');
    }
    setAnimationStatus('Animation view is available only in Arram-Boyle mode.', 'error');
    return;
  }

  if (animateToggle) {
    animateToggle.disabled = false;
    animateToggle.removeAttribute('aria-disabled');
  }
  if (frameCountInput) {
    frameCountInput.disabled = false;
  }
  if (applyPresetButton) {
    applyPresetButton.disabled = false;
  }
  if (clearAnimationButton) {
    clearAnimationButton.disabled = false;
  }
  if (animateSequenceButton) {
    animateSequenceButton.disabled = false;
  }
  if (animationPresetSelect) {
    animationPresetSelect.disabled = false;
  }

  resetAnimationState(animationState.frames.length || DEFAULT_FRAME_COUNT);
  const svgElement = svgPreview.querySelector('svg');
  if (!svgElement) {
    return;
  }
  animationState.arcGroups.clear();
  const geometryMap = new Map();
  geometry.arcgroups.forEach(group => {
    geometryMap.set(String(group.id), group);
  });
  const elements = svgElement.querySelectorAll('[data-arc-group-id]');
  elements.forEach(element => {
    const id = Number(element.dataset.arcGroupId);
    if (!Number.isFinite(id)) {
      return;
    }
    const data = geometryMap.get(String(id));
    if (!data) {
      return;
    }
    const outline = Array.isArray(data.outline) ? data.outline : [];
    const centroid = computeOutlineCentroid(outline);
    const polarAngle = Math.atan2(centroid.y, centroid.x);
    const radius = Math.hypot(centroid.x, centroid.y);
    const ringIndex = data.ring_index ?? (element.dataset.ringIndex !== undefined && element.dataset.ringIndex !== '' ? Number(element.dataset.ringIndex) : null);
    const label = data.name || (ringIndex !== null ? `Ring ${ringIndex + 1}` : `Arc ${id}`);
    animationState.arcGroups.set(id, {
      id,
      element,
      ringIndex,
      centroid,
      polarAngle,
      radius,
      label,
      lineAngle: data.line_angle ?? 0,
      defaultLineAngle: data.line_angle ?? 0,
    });
  });
  updateFrameUI();
  updateArcGroupHighlights();
  setAnimationStatus('Select a frame and click arcs to add them to the timeline.');
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

function showView(view) {
  if (view === 'animate' && (!lastRender || !hasGeometry(lastRender.geometry))) {
    setStatus('Animation view is available only for Arram-Boyle arcs.', 'error');
    return;
  }
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
  view2d.hidden = show3d;
  view3d.hidden = !show3d;
  if (svgAnimateContainer) {
    svgAnimateContainer.classList.toggle('animate-mode', showAnimate);
  }
  if (animatePanel) {
    animatePanel.hidden = !showAnimate;
  }
  if (!show3d) {
    updateStats(lastRender ? lastRender.geometry : null);
  }
  if (showAnimate) {
    updateArcGroupHighlights();
    setAnimationStatus('Select a frame and click arcs to add them to the timeline.');
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
    prepareAnimationElements(geometry);
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
  } catch (error) {
    console.error(error);
    svgPreview.innerHTML = '<div class="empty-state">Unable to render spiral.</div>';
    svgPreview.classList.add('empty-state');
    setStatus(error.message || 'Unexpected error', 'error');
    lastRender = null;
    updateExportAvailability(false);
    prepareAnimationElements(null);
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
    if (!view) {
      return;
    }
    showView(view);
  });
});

if (svgPreview) {
  svgPreview.addEventListener('click', event => {
    const target = event.target.closest('[data-arc-group-id]');
    if (!target) {
      return;
    }
    const id = Number(target.dataset.arcGroupId);
    if (!Number.isFinite(id)) {
      return;
    }
    const info = animationState.arcGroups.get(id);
    if (info && info.element) {
      triggerArcPulse(info.element);
    } else {
      triggerArcPulse(target);
    }
    if (activeView === 'animate') {
      event.preventDefault();
      handleArcGroupSelection(id);
    }
  });
}

if (frameList) {
  frameList.addEventListener('click', event => {
    const chip = event.target.closest('.frame-chip');
    if (chip) {
      event.stopPropagation();
      const frameIndex = Number(chip.dataset.frameIndex);
      const arcId = Number(chip.dataset.arcId);
      if (Number.isFinite(frameIndex) && Number.isFinite(arcId)) {
        removeArcFromFrame(frameIndex, arcId);
      }
      return;
    }
    const card = event.target.closest('.frame-card');
    if (card) {
      const frameIndex = Number(card.dataset.frameIndex);
      if (Number.isFinite(frameIndex)) {
        selectFrame(frameIndex);
      }
    }
  });
}

if (applyPresetButton) {
  applyPresetButton.addEventListener('click', () => {
    const presetId = animationPresetSelect ? animationPresetSelect.value : ANIMATION_PRESETS[0].id;
    applyAnimationPreset(presetId);
  });
}

if (animationPresetSelect) {
  animationPresetSelect.addEventListener('change', () => {
    setAnimationStatus(`Preset selected: ${animationPresetSelect.options[animationPresetSelect.selectedIndex].text}.`);
  });
}

if (clearAnimationButton) {
  clearAnimationButton.addEventListener('click', clearAnimationAssignments);
}

if (animateSequenceButton) {
  animateSequenceButton.addEventListener('click', applyAnimationAngles);
}

if (frameCountInput) {
  frameCountInput.addEventListener('change', () => {
    adjustFrameCount(frameCountInput.value);
  });
}

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
updateTValue();
renderCurrentSpiral(true);
