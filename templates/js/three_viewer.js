/* Three.js Doyle spiral viewer.
 *
 * The viewer is designed to be reusable.  Call createThreeViewer with DOM
 * references and a geometryFetcher callback that returns Arram-Boyle geometry
 * for given spiral parameters.
 */

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function normaliseOrientationDeg(angle) {
  if (!Number.isFinite(angle)) {
    return 0;
  }
  return ((angle % 180) + 180) % 180;
}

function angularDifferenceDeg(a, b) {
  const diff = (normaliseOrientationDeg(a) - normaliseOrientationDeg(b) + 180) % 180;
  return Math.min(diff, 180 - diff);
}

const AnimationModes = {
  rotationPulse: 'rotation_pulse',
  ringChase: 'ring_chase',
  ringCascade: 'ring_cascade',
  logSpiral: 'log_spiral',
  caWavefront: 'ca_wavefront',
  caToggle: 'ca_toggle',
  caDecay: 'ca_decay',
  tripleStrobe: 'triple_strobe',
  randomEcho: 'random_echo',
};

const PATTERN_COLORS = [0xffd36b, 0x6ef2c1, 0xff7eb6];

function computeOutlineCentroid(outline = []) {
  if (!outline.length) {
    return { x: 0, y: 0 };
  }
  let sumX = 0;
  let sumY = 0;
  for (const point of outline) {
    const [x, y] = point;
    sumX += x;
    sumY += y;
  }
  const inv = 1 / outline.length;
  return { x: sumX * inv, y: sumY * inv };
}

function wrapAngleRad(angle) {
  const tau = Math.PI * 2;
  return ((angle % tau) + tau) % tau;
}

function createThreeViewer({
  canvas,
  statusElement,
  stats = {},
  controls = {},
  geometryFetcher,
  getParams,
}) {
  if (!canvas || !geometryFetcher) {
    throw new Error('createThreeViewer requires a canvas and a geometryFetcher.');
  }
  if (typeof THREE === 'undefined') {
    if (statusElement) {
      statusElement.textContent = 'Three.js is not available. Ensure the script is loaded.';
      statusElement.classList.add('error');
    }
    return null;
  }

  const statsContainer = stats.container || null;
  const statArcGroups = stats.arcGroups || null;
  const statPolygons = stats.polygons || null;
  const statParameters = stats.parameters || null;

  const rotationSpeed = controls.rotationSpeed || null;
  const rotationSpeedValue = controls.rotationSpeedValue || null;
  const manualRotation = controls.manualRotation || null;
  const manualRotationValue = controls.manualRotationValue || null;
  const pulseSpeedSlider = controls.pulseSpeed || null;
  const pulseSpeedValue = controls.pulseSpeedValue || null;
  const metalnessSlider = controls.metalness || null;
  const metalnessValue = controls.metalnessValue || null;
  const roughnessSlider = controls.roughness || null;
  const roughnessValue = controls.roughnessValue || null;
  const animationModeSelect = controls.animationModeSelect || null;
  const reloadButton = controls.reloadButton || null;
  const loadJsonButton = controls.loadJsonButton || null;
  const resetCameraButton = controls.resetCameraButton || null;
  const fileInput = controls.fileInput || null;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0a0e1a);
  scene.fog = new THREE.Fog(0x0a0e1a, 5, 15);

  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 1000);
  camera.position.set(0, 0, 4);

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  function resizeRendererToDisplaySize() {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (width === 0 || height === 0) {
      return;
    }
    if (canvas.width !== width || canvas.height !== height) {
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    }
  }

  const ambient = new THREE.AmbientLight(0x404060, 0.4);
  scene.add(ambient);
  const key = new THREE.DirectionalLight(0xffffff, 1.2);
  key.position.set(5, 8, 7);
  key.castShadow = true;
  scene.add(key);
  const fill = new THREE.DirectionalLight(0x7799ff, 0.5);
  fill.position.set(-5, 3, -5);
  scene.add(fill);
  const rim = new THREE.DirectionalLight(0xffaa77, 0.6);
  rim.position.set(0, -5, -5);
  scene.add(rim);

  const spiralContainer = new THREE.Group();
  scene.add(spiralContainer);

  const palette = [
    0xc0c0d0, 0xb0b0c0, 0xa8a8b8, 0x9898a8,
    0xd0d0e0, 0xb8b8c8, 0xa0a0b0, 0xc8c8d8,
    0x888898, 0xd8d8e8,
  ];

  function getColorForRing(index) {
    if (!palette.length) {
      return 0xffffff;
    }
    const idx = Math.abs(index || 0) % palette.length;
    return palette[idx];
  }

  function clearSpiral() {
    spiralContainer.children.forEach(mesh => {
      if (mesh.geometry) {
        mesh.geometry.dispose();
      }
      if (mesh.material) {
        mesh.material.dispose();
      }
    });
    spiralContainer.clear();
    spiralContainer.position.set(0, 0, 0);
    spiralContainer.rotation.set(0, 0, 0);
    spiralContainer.scale.set(1, 1, 1);
    meshTopology.rings.clear();
    meshTopology.sortedRings = [];
    meshTopology.minRingIndex = null;
    meshTopology.maxRingIndex = null;
    meshTopology.ringCount = 0;
    meshTopology.spiralRange = 1;
    meshTopology.spiralMin = 0;
    meshTopology.maxLayer = 0;
  }

  function createPolygonMesh(outline, ringIndex = 0, lineAngle = 0, linePatterns = null) {
    if (!outline || outline.length < 3) {
      return null;
    }
    const shape = new THREE.Shape();
    shape.moveTo(outline[0][0], outline[0][1]);
    for (let i = 1; i < outline.length; i += 1) {
      shape.lineTo(outline[i][0], outline[i][1]);
    }
    const geometry = new THREE.ExtrudeGeometry(shape, {
      depth: 0.05,
      bevelEnabled: true,
      bevelThickness: 0.01,
      bevelSize: 0.01,
      bevelSegments: 2,
    });
    const material = new THREE.MeshStandardMaterial({
      color: getColorForRing(ringIndex),
      metalness: parseFloat(metalnessSlider ? metalnessSlider.value : '0.4') || 0.4,
      roughness: parseFloat(roughnessSlider ? roughnessSlider.value : '0.5') || 0.5,
      emissive: 0x000000,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    const centroid = computeOutlineCentroid(outline);
    const polarAngle = Math.atan2(centroid.y, centroid.x);
    const polarRadius = Math.hypot(centroid.x, centroid.y);
    const patternList = Array.isArray(linePatterns) && linePatterns.length
      ? linePatterns.map((pattern, index) => ({
        angle: normaliseOrientationDeg(pattern.angle ?? lineAngle),
        index: Number.isFinite(pattern.index) ? pattern.index : index,
      }))
      : [{ angle: normaliseOrientationDeg(lineAngle), index: 0 }];
    mesh.userData = {
      ringIndex,
      lineAngle: patternList[0].angle,
      linePatterns: patternList,
      isPulsing: false,
      wasInRange: false,
      pulseStart: 0,
      centroid,
      polarAngle,
      polarRadius,
      ringOrder: 0,
      ringPosition: 0,
      ringProgress: 0,
      spiralCoordinate: 0,
      neighbors: new Set(),
      caLayer: 0,
      caActive: false,
      caDecay: 0,
      randomPhase: Math.random() * Math.PI * 2,
      lastActivation: 0,
    };
    return mesh;
  }

  function loadSpiralFromJSON(data) {
    if (!data || !Array.isArray(data.arcgroups)) {
      throw new Error('Invalid geometry payload');
    }
    clearSpiral();
    data.arcgroups.forEach(group => {
      const mesh = createPolygonMesh(
        group.outline || [],
        group.ring_index,
        group.line_angle,
        group.line_patterns || null,
      );
      if (mesh) {
        spiralContainer.add(mesh);
      }
    });
    rebuildMeshTopology();
    resetAnimationState();
    if (spiralContainer.children.length) {
      const box = new THREE.Box3().setFromObject(spiralContainer);
      const center = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3());
      const maxDimension = Math.max(size.x, size.y, size.z, 1e-6);
      const scale = 2.5 / maxDimension;
      spiralContainer.position.set(-center.x * scale, -center.y * scale, -center.z * scale);
      spiralContainer.scale.setScalar(scale);
      resetView();
    }
    if (statsContainer) {
      statsContainer.hidden = false;
    }
    if (statArcGroups) {
      statArcGroups.textContent = data.arcgroups.length;
    }
    if (statPolygons) {
      statPolygons.textContent = spiralContainer.children.length;
    }
  }

  function getBaseMetalness() {
    const sliderValue = metalnessSlider ? parseFloat(metalnessSlider.value) : NaN;
    return Number.isFinite(sliderValue) ? sliderValue : 0.4;
  }

  function applyGlow(mesh, strength, patternIndex = 0) {
    if (!mesh || !mesh.material) {
      return;
    }
    const clampedStrength = clamp(strength, 0, 1);
    const baseMetal = getBaseMetalness();
    if (clampedStrength > 0.001) {
      const color = PATTERN_COLORS[patternIndex % PATTERN_COLORS.length] || PATTERN_COLORS[0];
      mesh.material.emissive.setHex(color);
      mesh.material.emissiveIntensity = 0.4 + 0.6 * clampedStrength;
      mesh.material.metalness = clamp(baseMetal + 0.15 * clampedStrength, 0, 1);
    } else {
      mesh.material.emissive.setHex(0x000000);
      mesh.material.emissiveIntensity = 0;
      mesh.material.metalness = baseMetal;
    }
  }

  function addNeighbor(a, b) {
    if (!a || !b || a === b) {
      return;
    }
    if (!(a.userData.neighbors instanceof Set)) {
      a.userData.neighbors = new Set();
    }
    if (!(b.userData.neighbors instanceof Set)) {
      b.userData.neighbors = new Set();
    }
    a.userData.neighbors.add(b);
    b.userData.neighbors.add(a);
  }

  function findClosestByAngle(targetAngle, candidates, count = 1) {
    if (!candidates || !candidates.length) {
      return [];
    }
    const normalizedTarget = wrapAngleRad(targetAngle || 0);
    const scored = candidates.map(mesh => {
      const candidateAngle = wrapAngleRad(mesh.userData.polarAngle || 0);
      const rawDiff = Math.abs(candidateAngle - normalizedTarget);
      const diff = rawDiff > Math.PI ? Math.PI * 2 - rawDiff : rawDiff;
      return { mesh, diff };
    });
    scored.sort((a, b) => a.diff - b.diff);
    return scored.slice(0, Math.min(count, scored.length)).map(entry => entry.mesh);
  }

  function connectRingNeighbors(ringMeshes) {
    if (!ringMeshes || ringMeshes.length < 2) {
      return;
    }
    const total = ringMeshes.length;
    for (let idx = 0; idx < total; idx += 1) {
      const current = ringMeshes[idx];
      const next = ringMeshes[(idx + 1) % total];
      addNeighbor(current, next);
    }
  }

  function connectCrossRingNeighbors() {
    const ringIndices = meshTopology.sortedRings;
    for (let idx = 0; idx < ringIndices.length - 1; idx += 1) {
      const currentRing = meshTopology.rings.get(ringIndices[idx]);
      const nextRing = meshTopology.rings.get(ringIndices[idx + 1]);
      if (!currentRing || !nextRing) {
        continue;
      }
      currentRing.forEach(mesh => {
        const matches = findClosestByAngle(mesh.userData.polarAngle, nextRing, 2);
        matches.forEach(match => addNeighbor(mesh, match));
      });
      nextRing.forEach(mesh => {
        const matches = findClosestByAngle(mesh.userData.polarAngle, currentRing, 2);
        matches.forEach(match => addNeighbor(mesh, match));
      });
    }
    spiralContainer.children.forEach(mesh => {
      if (mesh.userData.neighbors instanceof Set) {
        mesh.userData.neighbors = Array.from(mesh.userData.neighbors);
      } else if (!Array.isArray(mesh.userData.neighbors)) {
        mesh.userData.neighbors = [];
      }
    });
  }

  function computeSpiralCoordinates() {
    const coords = [];
    spiralContainer.children.forEach(mesh => {
      const radius = mesh.userData.polarRadius || 0;
      const normalizedAngle = wrapAngleRad(mesh.userData.polarAngle || 0) / (Math.PI * 2);
      const value = Math.log(radius + 1) + normalizedAngle * 0.75;
      mesh.userData.spiralCoordinate = value;
      coords.push(value);
    });
    if (!coords.length) {
      meshTopology.spiralMin = 0;
      meshTopology.spiralRange = 1;
      return;
    }
    let min = coords[0];
    let max = coords[0];
    for (const coord of coords) {
      if (coord < min) {
        min = coord;
      }
      if (coord > max) {
        max = coord;
      }
    }
    meshTopology.spiralMin = min;
    meshTopology.spiralRange = Math.max(0.0001, max - min);
  }

  function computeCaLayers() {
    const children = spiralContainer.children;
    if (!children.length) {
      meshTopology.maxLayer = 0;
      return;
    }
    const visited = new Set();
    const queue = [];
    const startRing = meshTopology.minRingIndex;
    const starters = typeof startRing === 'number' ? meshTopology.rings.get(startRing) || [] : [];
    starters.forEach(mesh => {
      mesh.userData.caLayer = 0;
      queue.push(mesh);
      visited.add(mesh);
    });
    while (queue.length) {
      const current = queue.shift();
      const neighbors = current.userData.neighbors || [];
      for (const neighbor of neighbors) {
        if (visited.has(neighbor)) {
          continue;
        }
        neighbor.userData.caLayer = (current.userData.caLayer || 0) + 1;
        visited.add(neighbor);
        queue.push(neighbor);
      }
    }
    let maxLayer = 0;
    children.forEach(mesh => {
      if (!visited.has(mesh)) {
        mesh.userData.caLayer = starters.length ? starters.length : 0;
      }
      maxLayer = Math.max(maxLayer, mesh.userData.caLayer || 0);
    });
    meshTopology.maxLayer = maxLayer;
  }

  function rebuildMeshTopology() {
    meshTopology.rings.clear();
    meshTopology.sortedRings = [];
    meshTopology.minRingIndex = null;
    meshTopology.maxRingIndex = null;
    meshTopology.ringCount = 0;
    spiralContainer.children.forEach(mesh => {
      const ringIdx = Number.isFinite(mesh.userData.ringIndex) ? mesh.userData.ringIndex : 0;
      if (!meshTopology.rings.has(ringIdx)) {
        meshTopology.rings.set(ringIdx, []);
      }
      mesh.userData.neighbors = new Set();
      meshTopology.rings.get(ringIdx).push(mesh);
      if (meshTopology.minRingIndex === null || ringIdx < meshTopology.minRingIndex) {
        meshTopology.minRingIndex = ringIdx;
      }
      if (meshTopology.maxRingIndex === null || ringIdx > meshTopology.maxRingIndex) {
        meshTopology.maxRingIndex = ringIdx;
      }
    });
    meshTopology.sortedRings = Array.from(meshTopology.rings.keys()).sort((a, b) => a - b);
    meshTopology.ringCount = meshTopology.sortedRings.length;
    meshTopology.sortedRings.forEach((ringIdx, ringOrder) => {
      const ringMeshes = meshTopology.rings.get(ringIdx) || [];
      ringMeshes.sort((a, b) => (a.userData.polarAngle || 0) - (b.userData.polarAngle || 0));
      const count = ringMeshes.length;
      ringMeshes.forEach((mesh, idx) => {
        mesh.userData.ringOrder = ringOrder;
        mesh.userData.ringPosition = idx;
        mesh.userData.ringProgress = count > 1 ? idx / (count - 1) : 0;
      });
      connectRingNeighbors(ringMeshes);
    });
    connectCrossRingNeighbors();
    computeSpiralCoordinates();
    computeCaLayers();
  }

  function resetAnimationState() {
    animationStart = performance.now();
    automataState.lastStepTime = 0;
    automataState.mode = animationMode;
    const baseMetal = getBaseMetalness();
    spiralContainer.children.forEach(mesh => {
      mesh.userData.isPulsing = false;
      mesh.userData.wasInRange = false;
      mesh.userData.pulseStart = 0;
      const isStarter = meshTopology.minRingIndex !== null && mesh.userData.ringIndex === meshTopology.minRingIndex;
      mesh.userData.caActive = Boolean(isStarter);
      mesh.userData.caDecay = mesh.userData.caActive ? 3 : 0;
      mesh.userData.lastActivation = 0;
      mesh.userData.randomPhase = Math.random() * Math.PI * 2;
      mesh.material.metalness = baseMetal;
      mesh.material.emissiveIntensity = 0;
      mesh.material.emissive.setHex(0x000000);
    });
  }

  function applyAnimationFrame(rotationAngleDeg, timeSec) {
    switch (animationMode) {
      case AnimationModes.ringChase:
        animateRingChase(timeSec);
        break;
      case AnimationModes.ringCascade:
        animateRingCascade(timeSec);
        break;
      case AnimationModes.logSpiral:
        animateLogSpiral(timeSec);
        break;
      case AnimationModes.caWavefront:
        animateCaWavefront(timeSec);
        break;
      case AnimationModes.caToggle:
        animateCaToggle(timeSec);
        break;
      case AnimationModes.caDecay:
        animateCaDecay(timeSec);
        break;
      case AnimationModes.tripleStrobe:
        animateTripleStrobe(timeSec);
        break;
      case AnimationModes.randomEcho:
        animateRandomEcho(timeSec);
        break;
      case AnimationModes.rotationPulse:
      default:
        animateRotationPulse(rotationAngleDeg, timeSec);
        break;
    }
  }

  function animateRotationPulse(rotationAngleDeg, timeSec) {
    const threshold = 20;
    const duration = 1 / Math.max(pulseSpeed, 0.0001);
    spiralContainer.children.forEach(mesh => {
      const lineAngle = mesh.userData.lineAngle || 0;
      const diff = angularDifferenceDeg(rotationAngleDeg, lineAngle);
      const isInRange = diff < threshold;
      if (isInRange && !mesh.userData.wasInRange) {
        mesh.userData.isPulsing = true;
        mesh.userData.pulseStart = timeSec;
      }
      if (mesh.userData.isPulsing) {
        const elapsed = timeSec - mesh.userData.pulseStart;
        if (elapsed < duration) {
          const t = elapsed / duration;
          const s = Math.sin(t * Math.PI);
          applyGlow(mesh, s, 0);
        } else {
          mesh.userData.isPulsing = false;
          applyGlow(mesh, 0, 0);
        }
      } else {
        applyGlow(mesh, 0, 0);
      }
      mesh.userData.wasInRange = isInRange;
    });
  }

  function animateRingChase(timeSec) {
    if (!meshTopology.ringCount) {
      return;
    }
    const ringDelay = 0.65;
    const arcDelay = 0.08;
    const speed = Math.max(0.5, pulseSpeed * 0.5);
    meshTopology.sortedRings.forEach((ringIdx, ringOrder) => {
      const ringMeshes = meshTopology.rings.get(ringIdx) || [];
      const baseTime = speed * timeSec - ringOrder * ringDelay;
      ringMeshes.forEach((mesh, idx) => {
        const localTime = baseTime - idx * arcDelay;
        const strength = Math.max(0, 1 - Math.abs(localTime) / 0.25);
        applyGlow(mesh, strength, 0);
      });
    });
  }

  function animateRingCascade(timeSec) {
    if (!meshTopology.ringCount) {
      return;
    }
    const total = meshTopology.ringCount;
    const speed = Math.max(0.25, pulseSpeed * 0.25);
    const progress = (timeSec * speed) % total;
    spiralContainer.children.forEach(mesh => {
      const order = mesh.userData.ringOrder || 0;
      let diff = Math.abs(order - progress);
      diff = Math.min(diff, total - diff);
      const strength = Math.max(0, 1 - diff / 1.2);
      applyGlow(mesh, strength, 0);
    });
  }

  function animateLogSpiral(timeSec) {
    const span = meshTopology.spiralRange || 1;
    const minValue = meshTopology.spiralMin || 0;
    const travel = Math.max(0.2, pulseSpeed * 0.3);
    const position = ((timeSec * travel) % span) + minValue;
    spiralContainer.children.forEach(mesh => {
      const coord = mesh.userData.spiralCoordinate || 0;
      let diff = Math.abs(coord - position);
      diff = Math.min(diff, span - diff);
      const strength = Math.max(0, 1 - diff / (span * 0.2));
      applyGlow(mesh, strength, 0);
    });
  }

  function animateCaWavefront(timeSec) {
    const maxLayer = Math.max(1, meshTopology.maxLayer || 1);
    const layerDuration = Math.max(0.15, 0.5 / Math.max(pulseSpeed, 0.0001));
    const cycle = layerDuration * (maxLayer + 3);
    const phase = timeSec % cycle;
    spiralContainer.children.forEach(mesh => {
      const activation = (mesh.userData.caLayer || 0) * layerDuration;
      let delta = phase - activation;
      if (delta < 0) {
        delta += cycle;
      }
      const strength = delta < layerDuration ? 1 - delta / layerDuration : 0;
      applyGlow(mesh, strength, 0);
    });
  }

  function stepAutomataToggle(timeSec) {
    const interval = Math.max(0.25, 1 / Math.max(pulseSpeed, 0.0001));
    if (timeSec - automataState.lastStepTime < interval) {
      return;
    }
    automataState.lastStepTime = timeSec;
    const pending = new Map();
    spiralContainer.children.forEach(mesh => {
      const neighbors = mesh.userData.neighbors || [];
      const neighborCount = neighbors.reduce((sum, neighbor) => sum + (neighbor.userData.caActive ? 1 : 0), 0);
      const nextActive = neighborCount === 1 || (!mesh.userData.caActive && neighborCount === 2);
      pending.set(mesh, nextActive);
    });
    pending.forEach((state, mesh) => {
      mesh.userData.caActive = state;
      if (state) {
        mesh.userData.lastActivation = timeSec;
      }
    });
  }

  function animateCaToggle(timeSec) {
    stepAutomataToggle(timeSec);
    const fadeDuration = 0.4;
    spiralContainer.children.forEach(mesh => {
      const active = mesh.userData.caActive;
      const timeSince = timeSec - (mesh.userData.lastActivation || 0);
      const strength = active ? 1 : Math.max(0, 1 - timeSince / fadeDuration);
      applyGlow(mesh, strength, active ? 1 : 0);
    });
  }

  function stepAutomataDecay(timeSec) {
    const interval = Math.max(0.3, 0.7 / Math.max(pulseSpeed, 0.0001));
    if (timeSec - automataState.lastStepTime < interval) {
      return;
    }
    automataState.lastStepTime = timeSec;
    spiralContainer.children.forEach(mesh => {
      const neighbors = mesh.userData.neighbors || [];
      const neighborCount = neighbors.reduce((sum, neighbor) => sum + (neighbor.userData.caActive ? 1 : 0), 0);
      if (!mesh.userData.caActive && neighborCount >= 1) {
        mesh.userData.caActive = true;
        mesh.userData.caDecay = 3;
        mesh.userData.lastActivation = timeSec;
      } else if (mesh.userData.caActive) {
        mesh.userData.caDecay -= 1;
        if (mesh.userData.caDecay <= 0) {
          mesh.userData.caActive = false;
        }
      }
    });
  }

  function animateCaDecay(timeSec) {
    stepAutomataDecay(timeSec);
    const fadeDuration = 1.2;
    spiralContainer.children.forEach(mesh => {
      const active = mesh.userData.caActive;
      const since = timeSec - (mesh.userData.lastActivation || 0);
      const strength = active ? 1 : Math.max(0, 1 - since / fadeDuration);
      applyGlow(mesh, strength, active ? 2 : 0);
    });
  }

  function animateTripleStrobe(timeSec) {
    spiralContainer.children.forEach(mesh => {
      const patterns = Array.isArray(mesh.userData.linePatterns) && mesh.userData.linePatterns.length
        ? mesh.userData.linePatterns
        : [{ angle: mesh.userData.lineAngle || 0, index: 0 }];
      const count = patterns.length;
      const speed = Math.max(0.5, pulseSpeed * 0.8);
      const progress = (timeSec * speed + mesh.userData.ringProgress) % count;
      const activeIndex = Math.floor(progress);
      const localPhase = progress - activeIndex;
      const strength = Math.max(0, 1 - localPhase / 0.3);
      const pattern = patterns[activeIndex] || patterns[0];
      applyGlow(mesh, strength, pattern.index || 0);
    });
  }

  function animateRandomEcho(timeSec) {
    const speed = Math.max(0.5, pulseSpeed * 0.6);
    spiralContainer.children.forEach(mesh => {
      const wave = Math.sin(timeSec * speed + (mesh.userData.randomPhase || 0));
      const strength = wave > 0 ? wave : 0;
      applyGlow(mesh, strength, 0);
    });
  }

  let cameraRotation = { x: 0, y: 0 };
  let cameraDistance = 4;
  let autoRotationSpeed = rotationSpeed ? parseFloat(rotationSpeed.value) : 0.4;
  let pulseSpeed = pulseSpeedSlider ? parseFloat(pulseSpeedSlider.value) : 1.0;
  let animationStart = performance.now();
  let animationMode = AnimationModes.rotationPulse;

  if (animationModeSelect && animationModeSelect.value) {
    const requested = animationModeSelect.value;
    if (Object.values(AnimationModes).includes(requested)) {
      animationMode = requested;
    }
  }

  const meshTopology = {
    rings: new Map(),
    sortedRings: [],
    minRingIndex: null,
    maxRingIndex: null,
    ringCount: 0,
    spiralRange: 1,
    spiralMin: 0,
    maxLayer: 0,
  };

  const automataState = {
    lastStepTime: 0,
    stepInterval: 0.6,
  };

  function updateMaterialsForRotation(rotationAngleDeg, timeSec) {
    applyAnimationFrame(rotationAngleDeg, timeSec);
  }

  function updateCamera() {
    const { x, y } = cameraRotation;
    camera.position.x = cameraDistance * Math.sin(x) * Math.cos(y);
    camera.position.y = cameraDistance * Math.sin(y);
    camera.position.z = cameraDistance * Math.cos(x) * Math.cos(y);
    camera.lookAt(0, 0, 0);
  }

  function resetView() {
    cameraRotation = { x: 0, y: 0 };
    cameraDistance = 4;
    spiralContainer.rotation.set(0, 0, 0);
    if (manualRotation) {
      manualRotation.value = '0';
      if (manualRotationValue) {
        manualRotationValue.textContent = '0';
      }
    }
    resetAnimationState();
    updateCamera();
  }

  function setStatus(message, isError = false) {
    if (!statusElement) {
      return;
    }
    statusElement.textContent = message;
    if (isError) {
      statusElement.classList.add('error');
    } else {
      statusElement.classList.remove('error');
    }
  }

  let pendingParams = null;
  let pendingTimer = null;

  async function fetchGeometry(params) {
    if (!params) {
      return;
    }
    try {
      setStatus('Generating geometry…');
      const result = await geometryFetcher(params);
      if (!result || !result.geometry || !Array.isArray(result.geometry.arcgroups)) {
        throw new Error('No geometry returned');
      }
      loadSpiralFromJSON(result.geometry);
      if (statParameters) {
        const label = result.label || `p=${params.p}, q=${params.q}, t=${Number(params.t).toFixed(2)}`;
        statParameters.textContent = label;
      }
      setStatus('Geometry generated.');
    } catch (error) {
      console.error(error);
      setStatus(`Unable to generate geometry: ${error.message}`, true);
    }
  }

  function queueGeometryUpdate(params, immediate = false) {
    pendingParams = params;
    if (pendingTimer) {
      clearTimeout(pendingTimer);
    }
    if (immediate) {
      fetchGeometry(pendingParams);
      pendingTimer = null;
      return;
    }
    pendingTimer = setTimeout(() => {
      fetchGeometry(pendingParams);
      pendingTimer = null;
    }, 250);
  }

  function useGeometryFromPayload(params, geometry) {
    if (!geometry || !Array.isArray(geometry.arcgroups)) {
      return;
    }
    try {
      loadSpiralFromJSON(geometry);
      if (statParameters) {
        statParameters.textContent = `p=${params.p}, q=${params.q}, t=${Number(params.t).toFixed(2)}`;
      }
      setStatus('Geometry loaded from renderer.');
    } catch (error) {
      setStatus(`Unable to display geometry: ${error.message}`, true);
    }
  }

  if (reloadButton) {
    reloadButton.addEventListener('click', () => {
      const params = getParams ? getParams() : null;
      queueGeometryUpdate(params, true);
    });
  }

  if (loadJsonButton && fileInput) {
    loadJsonButton.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', event => {
      const [file] = event.target.files || [];
      if (!file) {
        return;
      }
      const reader = new FileReader();
      reader.onload = e => {
        try {
          const data = JSON.parse(e.target.result);
          loadSpiralFromJSON(data);
          if (statParameters) {
            statParameters.textContent = file.name;
          }
          setStatus('Geometry loaded from local file.');
        } catch (error) {
          setStatus('Invalid JSON file.', true);
        }
      };
      reader.readAsText(file);
    });
  }

  if (resetCameraButton) {
    resetCameraButton.addEventListener('click', resetView);
  }

  if (rotationSpeed && rotationSpeedValue) {
    rotationSpeed.addEventListener('input', () => {
      autoRotationSpeed = parseFloat(rotationSpeed.value);
      rotationSpeedValue.textContent = autoRotationSpeed.toFixed(2);
    });
  }

  if (manualRotation && manualRotationValue) {
    manualRotation.addEventListener('input', () => {
      const value = parseFloat(manualRotation.value);
      manualRotationValue.textContent = value.toFixed(0);
    });
  }

  if (pulseSpeedSlider && pulseSpeedValue) {
    pulseSpeedSlider.addEventListener('input', () => {
      pulseSpeed = parseFloat(pulseSpeedSlider.value);
      pulseSpeedValue.textContent = pulseSpeed.toFixed(1);
    });
  }

  if (animationModeSelect) {
    animationModeSelect.addEventListener('change', () => {
      const value = animationModeSelect.value;
      animationMode = Object.values(AnimationModes).includes(value)
        ? value
        : AnimationModes.rotationPulse;
      resetAnimationState();
    });
  }

  if (metalnessSlider && metalnessValue) {
    metalnessSlider.addEventListener('input', () => {
      const value = parseFloat(metalnessSlider.value);
      metalnessValue.textContent = value.toFixed(2);
      spiralContainer.children.forEach(mesh => {
        mesh.material.metalness = value;
      });
    });
  }

  if (roughnessSlider && roughnessValue) {
    roughnessSlider.addEventListener('input', () => {
      const value = parseFloat(roughnessSlider.value);
      roughnessValue.textContent = value.toFixed(2);
      spiralContainer.children.forEach(mesh => {
        mesh.material.roughness = value;
      });
    });
  }

  let isDragging = false;
  let previousPointer = null;

  canvas.addEventListener('pointerdown', event => {
    isDragging = true;
    previousPointer = { x: event.clientX, y: event.clientY };
    canvas.setPointerCapture(event.pointerId);
  });

  canvas.addEventListener('pointermove', event => {
    if (!isDragging || !previousPointer) {
      return;
    }
    const dx = event.clientX - previousPointer.x;
    const dy = event.clientY - previousPointer.y;
    cameraRotation.x += dx * 0.01;
    cameraRotation.y += dy * 0.01;
    cameraRotation.y = clamp(cameraRotation.y, -Math.PI / 2, Math.PI / 2);
    previousPointer = { x: event.clientX, y: event.clientY };
    updateCamera();
  });

  canvas.addEventListener('pointerup', event => {
    isDragging = false;
    previousPointer = null;
    canvas.releasePointerCapture(event.pointerId);
  });

  canvas.addEventListener('pointerleave', () => {
    isDragging = false;
    previousPointer = null;
  });

  canvas.addEventListener('wheel', event => {
    event.preventDefault();
    cameraDistance += event.deltaY * 0.01;
    cameraDistance = clamp(cameraDistance, 1, 15);
    updateCamera();
  }, { passive: false });

  function animate(time) {
    requestAnimationFrame(animate);
    resizeRendererToDisplaySize();
    const timeSec = (time - animationStart) / 1000;
    let rotationDeg = 0;
    const manualValue = manualRotation ? parseFloat(manualRotation.value) : 0;
    if (autoRotationSpeed > 0 && Math.abs(manualValue) < 1e-6) {
      rotationDeg = (timeSec * autoRotationSpeed * 360) % 360;
    } else {
      rotationDeg = manualValue % 360;
    }
    spiralContainer.rotation.z = THREE.MathUtils.degToRad(rotationDeg);
    updateMaterialsForRotation(rotationDeg, timeSec);
    updateCamera();
    renderer.render(scene, camera);
  }

  updateCamera();
  requestAnimationFrame(animate);

  return {
    useGeometryFromPayload,
    queueGeometryUpdate,
    loadSpiralFromJSON,
    resetView,
  };
}

export { createThreeViewer };
