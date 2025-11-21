const SVG_NS = 'http://www.w3.org/2000/svg';

function outlineToPath(outline) {
  if (!Array.isArray(outline) || outline.length < 2) {
    return '';
  }
  const commands = outline
    .map((point, idx) => {
      if (!Array.isArray(point) || point.length < 2) {
        return null;
      }
      const [x, y] = point;
      const prefix = idx === 0 ? 'M' : 'L';
      return `${prefix}${Number(x).toFixed(4)},${Number(y).toFixed(4)}`;
    })
    .filter(Boolean);
  if (!commands.length) {
    return '';
  }
  commands.push('Z');
  return commands.join(' ');
}

function computePolygonCentroid(points) {
  if (!Array.isArray(points) || points.length < 3) {
    return { x: 0, y: 0 };
  }
  let area = 0;
  let cx = 0;
  let cy = 0;
  for (let idx = 0; idx < points.length; idx += 1) {
    const [x1, y1] = points[idx];
    const [x2, y2] = points[(idx + 1) % points.length];
    const cross = x1 * y2 - x2 * y1;
    area += cross;
    cx += (x1 + x2) * cross;
    cy += (y1 + y2) * cross;
  }
  if (Math.abs(area) < 1e-9) {
    return {
      x: points.reduce((sum, [x]) => sum + x, 0) / points.length,
      y: points.reduce((sum, [, y]) => sum + y, 0) / points.length,
    };
  }
  const factor = 1 / (3 * area);
  return { x: cx * factor, y: cy * factor };
}

function normalizeAngle(angle) {
  const tau = Math.PI * 2;
  const normalized = ((angle % tau) + tau) % tau;
  return normalized;
}

function buildAnimationModel(geometry) {
  const arcgroups = Array.isArray(geometry?.arcgroups) ? geometry.arcgroups : [];
  if (!arcgroups.length) {
    return null;
  }
  const groups = [];
  const groupMap = new Map();
  for (const entry of arcgroups) {
    if (!entry || !Array.isArray(entry.outline) || entry.outline.length < 3) {
      continue;
    }
    const outline = entry.outline.map(point => {
      if (!Array.isArray(point) || point.length < 2) {
        return [0, 0];
      }
      return [Number(point[0]), Number(point[1])];
    });
    const centroid = computePolygonCentroid(outline);
    const angle = normalizeAngle(Math.atan2(centroid.y, centroid.x));
    const radius = Math.hypot(centroid.x, centroid.y);
    const ringIndex = Number.isFinite(entry.ring_index) ? entry.ring_index : 0;
    const group = {
      id: entry.id,
      outline,
      ringIndex,
      centroid,
      angle,
      radius,
      neighbours: new Set(),
      orderInRing: 0,
    };
    groups.push(group);
    groupMap.set(group.id, group);
  }
  if (!groups.length) {
    return null;
  }
  const ringsByIndex = new Map();
  for (const group of groups) {
    const idx = Number.isFinite(group.ringIndex) ? group.ringIndex : 0;
    if (!ringsByIndex.has(idx)) {
      ringsByIndex.set(idx, []);
    }
    ringsByIndex.get(idx).push(group);
  }
  const rings = Array.from(ringsByIndex.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([index, entries]) => {
      const ordered = entries
        .slice()
        .sort((a, b) => a.angle - b.angle);
      ordered.forEach((group, idx) => {
        group.orderInRing = idx;
      });
      return { index, groups: ordered };
    });

  const linkNeighbours = (a, b) => {
    if (!a || !b || a.id === b.id) {
      return;
    }
    a.neighbours.add(b.id);
    b.neighbours.add(a.id);
  };

  for (const ring of rings) {
    const { groups: ringGroups } = ring;
    if (ringGroups.length === 1) {
      continue;
    }
    for (let idx = 0; idx < ringGroups.length; idx += 1) {
      const current = ringGroups[idx];
      const next = ringGroups[(idx + 1) % ringGroups.length];
      linkNeighbours(current, next);
    }
  }

  for (let ringIdx = 0; ringIdx < rings.length - 1; ringIdx += 1) {
    const inner = rings[ringIdx];
    const outer = rings[ringIdx + 1];
    if (!inner || !outer || !inner.groups.length || !outer.groups.length) {
      continue;
    }
    const innerLen = inner.groups.length;
    const outerLen = outer.groups.length;
    const ratio = outerLen / innerLen;
    inner.groups.forEach((group, idx) => {
      const mapped = Math.round(idx * ratio) % outerLen;
      const targets = [outer.groups[mapped], outer.groups[(mapped + 1) % outerLen]];
      targets.forEach(target => linkNeighbours(group, target));
    });
    outer.groups.forEach((group, idx) => {
      const mapped = Math.round(idx / ratio) % innerLen;
      const targets = [inner.groups[mapped], inner.groups[(mapped + 1) % innerLen]];
      targets.forEach(target => linkNeighbours(group, target));
    });
  }

  return {
    groups,
    groupMap,
    rings,
    minRingIndex: rings.length ? rings[0].index : 0,
    maxRingIndex: rings.length ? rings[rings.length - 1].index : 0,
  };
}

function buildPropagationLevels(model) {
  if (!model || !model.rings.length) {
    return [];
  }
  const visited = new Set();
  const levels = [];
  let frontier = model.rings[0].groups.slice();
  while (frontier.length) {
    const ids = [];
    const next = [];
    for (const group of frontier) {
      if (!group || visited.has(group.id)) {
        continue;
      }
      visited.add(group.id);
      ids.push(group.id);
      for (const neighbour of group.neighbours) {
        if (!visited.has(neighbour)) {
          const neighbourGroup = model.groupMap.get(neighbour);
          if (neighbourGroup) {
            next.push(neighbourGroup);
          }
        }
      }
    }
    if (ids.length) {
      levels.push(ids);
    }
    frontier = next;
  }
  return levels;
}

function createSequentialAnimation(frames, stepDuration = 0.4) {
  const validFrames = Array.isArray(frames)
    ? frames.map(frame => frame.filter(Boolean)).filter(frame => frame.length)
    : [];
  if (!validFrames.length) {
    return null;
  }
  const duration = Math.max(stepDuration * validFrames.length, stepDuration);
  return {
    duration,
    update(timeSec) {
      const local = duration > 0 ? timeSec % duration : 0;
      const idx = Math.floor(local / stepDuration) % validFrames.length;
      const nextIdx = (idx + 1) % validFrames.length;
      const progress = (local % stepDuration) / stepDuration;
      const eased = 0.5 - 0.5 * Math.cos(Math.PI * progress);
      const state = new Map();
      const current = validFrames[idx];
      const next = validFrames[nextIdx];
      current.forEach(id => {
        const value = Math.max(state.get(id) || 0, 1 - eased);
        state.set(id, value);
      });
      next.forEach(id => {
        const value = Math.max(state.get(id) || 0, eased);
        state.set(id, value);
      });
      return state;
    },
  };
}

function chunkSequence(sequence, size) {
  const chunks = [];
  if (!Array.isArray(sequence) || size <= 0) {
    return chunks;
  }
  for (let idx = 0; idx < sequence.length; idx += size) {
    chunks.push(sequence.slice(idx, idx + size));
  }
  return chunks;
}

function createRadialBreathAnimation(model) {
  const radii = model.groups.map(group => group.radius).filter(Number.isFinite);
  if (!radii.length) {
    return null;
  }
  const minR = Math.min(...radii);
  const maxR = Math.max(...radii);
  const range = Math.max(maxR - minR, 1e-3);
  return {
    duration: 8,
    update(timeSec) {
      const state = new Map();
      const waveSpeed = 1.2;
      for (const group of model.groups) {
        const normalized = (group.radius - minR) / range;
        const phase = (waveSpeed * timeSec) - normalized * Math.PI * 3;
        const value = 0.5 + 0.5 * Math.sin(phase);
        state.set(group.id, Math.max(0, Math.min(1, value)));
      }
      return state;
    },
  };
}

function runCellularAutomaton(model, { survive = [], born = [], steps = 12 } = {}) {
  const surviveSet = new Set(survive);
  const bornSet = new Set(born);
  const seedRing = model?.rings?.[0]?.groups ?? [];
  const initialSeed = seedRing.length
    ? new Set(seedRing.map(group => group.id))
    : new Set(model.groups.slice(0, 3).map(group => group.id));
  if (!initialSeed.size) {
    return [];
  }
  const history = [];
  let current = new Set(initialSeed);
  for (let step = 0; step < steps; step += 1) {
    history.push(new Set(current));
    const next = new Set();
    for (const group of model.groups) {
      const isActive = current.has(group.id);
      let neighbourCount = 0;
      for (const neighbour of group.neighbours) {
        if (current.has(neighbour)) {
          neighbourCount += 1;
        }
      }
      if (isActive && surviveSet.has(neighbourCount)) {
        next.add(group.id);
      } else if (!isActive && bornSet.has(neighbourCount)) {
        next.add(group.id);
      }
    }
    if (!next.size) {
      break;
    }
    current = next;
  }
  return history.map(set => Array.from(set));
}

function createTwinSpiralAnimation(model) {
  const sorted = model.groups.slice().sort((a, b) => a.angle - b.angle);
  if (!sorted.length) {
    return null;
  }
  const armA = sorted.filter(group => group.angle < Math.PI);
  const armB = sorted.filter(group => group.angle >= Math.PI);
  if (!armA.length || !armB.length) {
    return createSequentialAnimation(sorted.map(group => [group.id]), 0.25);
  }
  const frames = [];
  const maxLen = Math.max(armA.length, armB.length);
  for (let idx = 0; idx < maxLen; idx += 1) {
    if (idx < armA.length) {
      frames.push([armA[idx].id]);
    }
    if (idx < armB.length) {
      frames.push([armB[idx].id]);
    }
  }
  return createSequentialAnimation(frames, 0.25);
}

const ANIMATIONS = new Map([
  ['ring_ripple', {
    label: 'Ring ripple',
    description: 'Each ring lights up from the center outward.',
    create: model => {
      const frames = model.rings.map(ring => ring.groups.map(group => group.id));
      return createSequentialAnimation(frames, 0.45);
    },
  }],
  ['ring_chase', {
    label: 'Ring chase',
    description: 'Arc-groups in a ring activate one after another.',
    create: model => {
      const frames = [];
      model.rings.forEach(ring => {
        ring.groups.forEach(group => {
          frames.push([group.id]);
        });
      });
      return createSequentialAnimation(frames, 0.2);
    },
  }],
  ['spiral_growth', {
    label: 'Log spiral growth',
    description: 'Activation travels along a logarithmic spiral expansion.',
    create: model => {
      const sorted = model.groups
        .slice()
        .sort((a, b) => (a.ringIndex + a.angle / (Math.PI * 2)) - (b.ringIndex + b.angle / (Math.PI * 2)));
      const chunkSize = Math.max(1, Math.round(sorted.length / 32));
      const frames = chunkSequence(sorted.map(group => group.id), chunkSize);
      return createSequentialAnimation(frames, 0.25);
    },
  }],
  ['twin_spirals', {
    label: 'Twin spiral chase',
    description: 'Two opposing spiral arms race each other.',
    create: model => createTwinSpiralAnimation(model),
  }],
  ['radial_breathe', {
    label: 'Radial breath',
    description: 'A radial pulse breathes through the packing.',
    create: model => createRadialBreathAnimation(model),
  }],
  ['ca_frontier', {
    label: 'CA frontier bloom',
    description: 'A cellular automata frontier spreads across neighbours.',
    create: model => {
      const frames = buildPropagationLevels(model);
      return createSequentialAnimation(frames, 0.4);
    },
    isCellular: true,
  }],
  ['ca_echo', {
    label: 'CA echo lattice',
    description: 'Life-like rule (S23/B3) seeded from the inner ring.',
    create: model => {
      const frames = runCellularAutomaton(model, { survive: [2, 3], born: [3], steps: 14 });
      return createSequentialAnimation(frames, 0.35);
    },
    isCellular: true,
  }],
  ['ca_checker', {
    label: 'CA checker pulse',
    description: 'Neighbour rule (S12/B2) ripples outward.',
    create: model => {
      const frames = runCellularAutomaton(model, { survive: [1, 2], born: [2], steps: 12 });
      return createSequentialAnimation(frames, 0.35);
    },
    isCellular: true,
  }],
]);

class ArcAnimationController {
  constructor({
    select,
    playButton,
    pauseButton,
    resetButton,
    speedSlider,
    speedValue,
    statusElement,
  } = {}) {
    this.select = select || null;
    this.playButton = playButton || null;
    this.pauseButton = pauseButton || null;
    this.resetButton = resetButton || null;
    this.speedSlider = speedSlider || null;
    this.speedValue = speedValue || null;
    this.statusElement = statusElement || null;
    this.speed = this.speedSlider ? parseFloat(this.speedSlider.value) : 1;
    if (!Number.isFinite(this.speed) || this.speed <= 0) {
      this.speed = 1;
    }
    this.currentAnimationId = this.select?.value || 'ring_ripple';
    this.isPlaying = false;
    this.animationModel = null;
    this.animationInstance = null;
    this.svgElement = null;
    this.layer = null;
    this.paths = new Map();
    this.lastIntensities = new Map();
    this.frameHandle = null;
    this.lastTimestamp = null;
    this.geometryAvailable = false;
    this._bindEvents();
    this._updateSpeedLabel();
  }

  _bindEvents() {
    if (this.select) {
      this.select.addEventListener('change', () => {
        const value = this.select.value;
        this.setAnimation(value);
      });
    }
    if (this.playButton) {
      this.playButton.addEventListener('click', () => this.play());
    }
    if (this.pauseButton) {
      this.pauseButton.addEventListener('click', () => this.pause());
    }
    if (this.resetButton) {
      this.resetButton.addEventListener('click', () => this.reset());
    }
    if (this.speedSlider) {
      this.speedSlider.addEventListener('input', () => {
        const value = parseFloat(this.speedSlider.value);
        if (Number.isFinite(value) && value > 0) {
          this.speed = value;
          this._updateSpeedLabel();
        }
      });
    }
  }

  _updateSpeedLabel() {
    if (this.speedValue) {
      this.speedValue.textContent = `${this.speed.toFixed(1)}×`;
    }
  }

  _setStatus(message) {
    if (this.statusElement) {
      this.statusElement.textContent = message;
    }
  }

  _setUiAvailability(enabled) {
    const targets = [this.select, this.playButton, this.pauseButton, this.resetButton, this.speedSlider];
    targets.forEach(element => {
      if (element) {
        element.disabled = !enabled;
      }
    });
  }

  _clearLayer() {
    if (this.layer && this.layer.parentNode) {
      this.layer.parentNode.removeChild(this.layer);
    }
    this.layer = null;
    this.paths.clear();
    this.lastIntensities.clear();
  }

  _buildLayer() {
    if (!this.svgElement || !this.animationModel) {
      this._clearLayer();
      return;
    }
    this._clearLayer();
    const layer = document.createElementNS(SVG_NS, 'g');
    layer.setAttribute('data-animation-layer', 'true');
    layer.style.pointerEvents = 'none';
    layer.classList.add('animation-layer');
    this.svgElement.appendChild(layer);
    for (const group of this.animationModel.groups) {
      const pathData = outlineToPath(group.outline);
      if (!pathData) {
        continue;
      }
      const path = document.createElementNS(SVG_NS, 'path');
      path.setAttribute('d', pathData);
      path.dataset.arcgroupId = String(group.id);
      path.style.fill = 'var(--accent)';
      path.style.stroke = 'var(--accent)';
      path.style.fillOpacity = '0';
      path.style.strokeOpacity = '0';
      path.style.strokeWidth = '0.1';
      path.style.transition = 'fill-opacity 0.25s ease, stroke-opacity 0.25s ease';
      path.style.pointerEvents = 'none';
      layer.appendChild(path);
      this.paths.set(group.id, path);
    }
    this.layer = layer;
  }

  setScene(svgElement, geometry, mode = 'arram_boyle') {
    this.svgElement = svgElement || null;
    if (!geometry || mode !== 'arram_boyle') {
      this.animationModel = null;
      this.animationInstance = null;
      this.geometryAvailable = false;
      this._clearLayer();
      this._setUiAvailability(false);
      if (mode !== 'arram_boyle') {
        this._setStatus('Animations require the Arram-Boyle arc geometry.');
      } else {
        this._setStatus('Render a spiral to enable the animation controls.');
      }
      return;
    }
    const model = buildAnimationModel(geometry);
    if (!model) {
      this.animationModel = null;
      this.animationInstance = null;
      this.geometryAvailable = false;
      this._clearLayer();
      this._setUiAvailability(false);
      this._setStatus('Not enough arc groups to animate.');
      return;
    }
    this.animationModel = model;
    this.geometryAvailable = true;
    this._setUiAvailability(true);
    this._buildLayer();
    this._refreshAnimationInstance();
    this._setStatus(`Ready to animate ${model.groups.length} arc groups.`);
    if (this.isPlaying) {
      this._requestFrame();
    }
  }

  _refreshAnimationInstance() {
    if (!this.animationModel || !this.currentAnimationId || this.currentAnimationId === 'none') {
      this.animationInstance = null;
      this.applyState(new Map());
      return;
    }
    const definition = ANIMATIONS.get(this.currentAnimationId);
    if (!definition) {
      this.animationInstance = null;
      return;
    }
    this.animationInstance = definition.create(this.animationModel);
    this.elapsed = 0;
    this.lastTimestamp = null;
  }

  setAnimation(animationId) {
    this.currentAnimationId = animationId;
    if (!this.geometryAvailable && animationId !== 'none') {
      this._setStatus('Render in Arram-Boyle mode to preview animations.');
      return;
    }
    this._refreshAnimationInstance();
    if (this.animationInstance) {
      const label = ANIMATIONS.get(animationId)?.label || 'custom';
      this._setStatus(`Ready: ${label}.`);
    } else if (animationId === 'none') {
      this._setStatus('Animation disabled.');
    } else {
      this._setStatus('Not enough geometry to play this animation.');
    }
  }

  applyState(stateMap) {
    for (const [id, path] of this.paths.entries()) {
      const value = stateMap instanceof Map ? stateMap.get(id) || 0 : 0;
      const clamped = Math.max(0, Math.min(1, value));
      const lastValue = this.lastIntensities.get(id) || 0;
      if (Math.abs(clamped - lastValue) < 1e-3) {
        continue;
      }
      this.lastIntensities.set(id, clamped);
      const fillOpacity = (clamped * 0.45).toFixed(3);
      const strokeOpacity = (0.1 + clamped * 0.9).toFixed(3);
      const strokeWidth = (0.1 + clamped * 0.7).toFixed(3);
      path.style.fillOpacity = fillOpacity;
      path.style.strokeOpacity = strokeOpacity;
      path.style.strokeWidth = strokeWidth;
    }
  }

  _requestFrame() {
    if (this.frameHandle) {
      cancelAnimationFrame(this.frameHandle);
    }
    this.frameHandle = requestAnimationFrame(this._tick.bind(this));
  }

  _tick(timestamp) {
    if (!this.isPlaying || !this.animationInstance) {
      this.frameHandle = null;
      this.lastTimestamp = null;
      return;
    }
    if (!this.lastTimestamp) {
      this.lastTimestamp = timestamp;
    }
    const delta = (timestamp - this.lastTimestamp) / 1000;
    this.lastTimestamp = timestamp;
    this.elapsed = (this.elapsed || 0) + delta * this.speed;
    const duration = this.animationInstance.duration || 8;
    const t = duration > 0 ? this.elapsed % duration : this.elapsed;
    const state = this.animationInstance.update(t);
    this.applyState(state);
    this.frameHandle = requestAnimationFrame(this._tick.bind(this));
  }

  play() {
    if (!this.geometryAvailable) {
      this._setStatus('Render in Arram-Boyle mode to preview animations.');
      return;
    }
    if (!this.animationInstance) {
      this.setAnimation(this.currentAnimationId || 'ring_ripple');
      if (!this.animationInstance) {
        this.isPlaying = false;
        return;
      }
    }
    this.isPlaying = true;
    this._setStatus('Animation playing…');
    this._requestFrame();
  }

  pause() {
    this.isPlaying = false;
    if (this.frameHandle) {
      cancelAnimationFrame(this.frameHandle);
      this.frameHandle = null;
    }
    this.lastTimestamp = null;
    if (this.geometryAvailable) {
      this._setStatus('Animation paused.');
    }
  }

  reset() {
    this.elapsed = 0;
    this.lastTimestamp = null;
    if (this.animationInstance) {
      this.applyState(new Map());
      this._setStatus('Animation reset.');
    }
  }
}

function createArcAnimationController(options = {}) {
  return new ArcAnimationController(options);
}

export { createArcAnimationController };
