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

function computePolygonCentroid(points = []) {
  if (!points.length) {
    return { x: 0, y: 0 };
  }
  let sumX = 0;
  let sumY = 0;
  for (const [x, y] of points) {
    sumX += x;
    sumY += y;
  }
  const inv = 1 / points.length;
  return { x: sumX * inv, y: sumY * inv };
}

function angularDistanceRad(a, b) {
  let diff = Math.abs(a - b);
  const tau = Math.PI * 2;
  if (diff > Math.PI) {
    diff = tau - diff;
  }
  return diff;
}

function addNeighborLink(a, b) {
  if (!a || !b || a === b) {
    return;
  }
  if (!a.userData.neighborSet) {
    a.userData.neighborSet = new Set();
  }
  if (!b.userData.neighborSet) {
    b.userData.neighborSet = new Set();
  }
  a.userData.neighborSet.add(b);
  b.userData.neighborSet.add(a);
}

const GLOW_COLORS = {
  warm: 0xffd15a,
  cool: 0x6dd6ff,
  magenta: 0xff6bd6,
  green: 0x7dffa9,
};

function createCellularRuleAnimation({ id, label, color, rule }) {
  return {
    id,
    label,
    init: ({ meshes, rings }) => {
      if (!meshes || !meshes.length) {
        return { cells: [], startIndices: [], startSet: new Set(), color };
      }
      const cells = meshes.map(mesh => ({
        mesh,
        neighbors: mesh.userData.neighborIndices || [],
        state: 0,
        buffer: 0,
      }));
      const innerRingMeshes = rings && rings.length ? rings[0].meshes : [];
      const startIndices = innerRingMeshes.map(mesh => mesh.userData.meshIndex);
      startIndices.forEach(idx => {
        if (cells[idx]) {
          cells[idx].state = 1;
        }
      });
      return {
        cells,
        startIndices,
        startSet: new Set(startIndices),
        lastStep: 0,
        stepCounter: 0,
        color,
      };
    },
    update: ctx => {
      const { state, timeSec, speed, helpers } = ctx;
      if (!state.cells.length) {
        return;
      }
      const interval = Math.max(0.12, 0.5 / Math.max(speed, 0.01));
      if (timeSec - state.lastStep >= interval) {
        state.lastStep = timeSec;
        const previous = state.cells.map(cell => cell.state);
        state.cells.forEach((cell, idx) => {
          const neighborValues = cell.neighbors.map(nIdx => previous[nIdx] || 0);
          cell.buffer = rule({
            idx,
            previousValue: previous[idx] || 0,
            neighborValues,
            state,
          });
        });
        let active = 0;
        state.cells.forEach(cell => {
          cell.state = clamp(cell.buffer, 0, 1);
          if (cell.state > 0.05) {
            active += 1;
          }
        });
        if (active === 0 && state.startIndices.length) {
          state.startIndices.forEach(idx => {
            if (state.cells[idx]) {
              state.cells[idx].state = 1;
            }
          });
        }
        state.stepCounter += 1;
      }
      state.cells.forEach(cell => {
        helpers.setGlow(cell.mesh, cell.state, state.color);
      });
    },
  };
}

const wavefrontRule = ({ previousValue, neighborValues }) => {
  if (previousValue > 0.2) {
    return Math.max(0, previousValue - 0.35);
  }
  const neighborMax = neighborValues.reduce((max, value) => Math.max(max, value), 0);
  if (neighborMax > 0.6) {
    return 1;
  }
  return 0;
};

const echoRule = ({ previousValue, neighborValues }) => {
  const activeNeighbors = neighborValues.filter(value => value > 0.6).length;
  if (activeNeighbors === 1) {
    return 1;
  }
  if (activeNeighbors >= 3) {
    return 0;
  }
  return previousValue * 0.55;
};

const caBranchesAnimation = {
  id: 'ca_branches',
  label: 'CA · Branching vines',
  init: ({ meshes, rings }) => {
    const cells = (meshes || []).map(mesh => ({
      mesh,
      neighbors: mesh.userData.neighborIndices || [],
      strength: 0,
    }));
    const startMeshes = rings && rings.length ? rings[0].meshes : [];
    const startIndices = startMeshes.map(mesh => mesh.userData.meshIndex);
    startIndices.forEach(idx => {
      if (cells[idx]) {
        cells[idx].strength = 1;
      }
    });
    return {
      cells,
      startIndices,
      lastStep: 0,
      seed: Math.random() * 1000,
      color: GLOW_COLORS.green,
    };
  },
  update: ctx => {
    const { state, timeSec, speed, helpers } = ctx;
    if (!state.cells.length) {
      return;
    }
    const interval = Math.max(0.18, 0.7 / Math.max(speed, 0.01));
    if (timeSec - state.lastStep >= interval) {
      state.lastStep = timeSec;
      const previous = state.cells.map(cell => cell.strength);
      const pendingActivations = new Set();
      state.cells.forEach((cell, idx) => {
        let value = previous[idx] * 0.55;
        if (previous[idx] > 0.7 && cell.neighbors.length) {
          const signal = Math.abs(Math.sin(state.seed + idx * 1.37 + timeSec));
          const choice = Math.floor(signal * cell.neighbors.length) % cell.neighbors.length;
          pendingActivations.add(cell.neighbors[choice]);
        }
        cell.strength = value;
      });
      pendingActivations.forEach(targetIdx => {
        if (state.cells[targetIdx]) {
          state.cells[targetIdx].strength = 1;
        }
      });
      const hasEnergy = state.cells.some(cell => cell.strength > 0.05);
      if (!hasEnergy && state.startIndices.length) {
        state.startIndices.forEach(idx => {
          if (state.cells[idx]) {
            state.cells[idx].strength = 1;
          }
        });
      }
    }
    state.cells.forEach(cell => {
      helpers.setGlow(cell.mesh, clamp(cell.strength, 0, 1), state.color);
    });
  },
};

const animationDefinitions = {
  rotation_sweep: {
    id: 'rotation_sweep',
    label: 'Rotation sweep',
    init: () => ({}),
    update: ({ meshes, rotationDeg, helpers }) => {
      const threshold = 25;
      meshes.forEach(mesh => {
        const lineAngle = mesh.userData.lineAngle || 0;
        const diff = angularDifferenceDeg(rotationDeg, lineAngle);
        if (diff < threshold) {
          const t = Math.cos((diff / threshold) * (Math.PI / 2));
          helpers.setGlow(mesh, t * t, GLOW_COLORS.warm);
        }
      });
    },
  },
  ring_chase: {
    id: 'ring_chase',
    label: 'Ring chase',
    init: () => ({}),
    update: ({ rings, timeSec, speed, helpers }) => {
      if (!rings.length) {
        return;
      }
      const tempo = Math.max(0.2, speed);
      rings.forEach((ring, ringIdx) => {
        const meshes = ring.meshes;
        if (!meshes.length) {
          return;
        }
        const localPhase = (timeSec * tempo * 0.2 + ringIdx * 0.12) % 1;
        const position = localPhase * meshes.length;
        meshes.forEach((mesh, idx) => {
          const delta = Math.abs(idx - position);
          const wrapped = Math.min(delta, meshes.length - delta);
          const intensity = Math.max(0, 1 - wrapped);
          if (intensity > 0) {
            helpers.setGlow(mesh, intensity, GLOW_COLORS.warm);
          }
        });
      });
    },
  },
  spiral_expansion: {
    id: 'spiral_expansion',
    label: 'Spiral expansion',
    init: () => ({}),
    update: ({ rings, timeSec, speed, helpers }) => {
      if (!rings.length) {
        return;
      }
      const maxRingLength = rings.reduce((max, ring) => Math.max(max, ring.meshes.length), 1);
      const totalSpan = rings.length + maxRingLength;
      const progress = (timeSec * Math.max(speed, 0.1) * 0.15) % totalSpan;
      rings.forEach((ring, orderIdx) => {
        const meshes = ring.meshes;
        const ringBase = orderIdx;
        const count = Math.max(meshes.length, 1);
        meshes.forEach(mesh => {
          const value = ringBase + (mesh.userData.ringOrder || 0) / count;
          const distance = Math.abs(value - progress);
          if (distance < 1.2) {
            const intensity = Math.max(0, 1 - distance / 1.2);
            helpers.setGlow(mesh, intensity, GLOW_COLORS.cool);
          }
        });
      });
    },
  },
  radial_bloom: {
    id: 'radial_bloom',
    label: 'Radial bloom',
    init: () => ({}),
    update: ({ rings, timeSec, speed, helpers }) => {
      if (!rings.length) {
        return;
      }
      const span = Math.max(rings.length - 1, 1);
      const wave = (Math.sin(timeSec * Math.max(speed, 0.1) * 0.7) + 1) * 0.5 * span;
      rings.forEach((ring, orderIdx) => {
        const ringDelta = Math.abs(orderIdx - wave);
        const intensity = Math.max(0, 1 - ringDelta);
        ring.meshes.forEach(mesh => {
          if (intensity > 0.01) {
            helpers.setGlow(mesh, intensity, GLOW_COLORS.magenta);
          }
        });
      });
    },
  },
  aurora_shimmer: {
    id: 'aurora_shimmer',
    label: 'Aurora shimmer',
    init: () => ({}),
    update: ({ meshes, timeSec, speed, helpers }) => {
      const tempo = Math.max(speed, 0.1);
      meshes.forEach(mesh => {
        const angle = mesh.userData.angle || 0;
        const ringOrder = mesh.userData.ringOrder || 0;
        const band = Math.sin(angle * 4 + ringOrder * 0.2 + timeSec * tempo * 2.5);
        const intensity = Math.max(0, (band + 1) * 0.5 - 0.1);
        if (intensity > 0) {
          helpers.setGlow(mesh, intensity * 0.85, GLOW_COLORS.cool);
        }
      });
    },
  },
  ca_wavefront: createCellularRuleAnimation({
    id: 'ca_wavefront',
    label: 'CA · Wavefront',
    color: GLOW_COLORS.cool,
    rule: wavefrontRule,
  }),
  ca_echo: createCellularRuleAnimation({
    id: 'ca_echo',
    label: 'CA · Echo lattice',
    color: GLOW_COLORS.magenta,
    rule: echoRule,
  }),
  ca_branches: caBranchesAnimation,
};

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
  const animationModeSelect = controls.animationMode || null;
  const metalnessSlider = controls.metalness || null;
  const metalnessValue = controls.metalnessValue || null;
  const roughnessSlider = controls.roughness || null;
  const roughnessValue = controls.roughnessValue || null;
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
    ringInfos = [];
    innermostRingIndex = 0;
    resetAnimationState();
  }

  function resetAnimationState() {
    animationState = null;
  }

  function linkRingPairs(innerMeshes = [], outerMeshes = []) {
    if (!innerMeshes.length || !outerMeshes.length) {
      return;
    }
    innerMeshes.forEach(mesh => {
      let best = null;
      let second = null;
      outerMeshes.forEach(candidate => {
        const diff = angularDistanceRad(mesh.userData.angle || 0, candidate.userData.angle || 0);
        if (!best || diff < best.diff) {
          second = best;
          best = { mesh: candidate, diff };
        } else if (!second || diff < second.diff) {
          second = { mesh: candidate, diff };
        }
      });
      if (best) {
        addNeighborLink(mesh, best.mesh);
      }
      if (second) {
        addNeighborLink(mesh, second.mesh);
      }
    });
  }

  function rebuildTopology() {
    ringInfos = [];
    innermostRingIndex = 0;
    if (!spiralContainer.children.length) {
      geometryRevision += 1;
      resetAnimationState();
      return;
    }
    const ringMap = new Map();
    let minRingIndex = Infinity;
    spiralContainer.children.forEach((mesh, idx) => {
      mesh.userData.meshIndex = idx;
      mesh.userData.neighborSet = new Set();
      const ringIdx = Number(mesh.userData.ringIndex ?? 0);
      if (!ringMap.has(ringIdx)) {
        ringMap.set(ringIdx, []);
      }
      ringMap.get(ringIdx).push(mesh);
      if (ringIdx < minRingIndex) {
        minRingIndex = ringIdx;
      }
    });
    ringInfos = Array.from(ringMap.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([ringIdx, meshes], order) => {
        meshes.sort((a, b) => (a.userData.angle || 0) - (b.userData.angle || 0));
        meshes.forEach((mesh, idx) => {
          mesh.userData.ringOrder = idx;
        });
        return { index: ringIdx, order, meshes };
      });
    innermostRingIndex = Number.isFinite(minRingIndex) ? minRingIndex : 0;
    ringInfos.forEach(ring => {
      const meshes = ring.meshes;
      if (meshes.length <= 1) {
        return;
      }
      for (let i = 0; i < meshes.length; i += 1) {
        const current = meshes[i];
        const next = meshes[(i + 1) % meshes.length];
        const prev = meshes[(i - 1 + meshes.length) % meshes.length];
        addNeighborLink(current, next);
        addNeighborLink(current, prev);
      }
    });
    for (let i = 0; i < ringInfos.length - 1; i += 1) {
      linkRingPairs(ringInfos[i].meshes, ringInfos[i + 1].meshes);
    }
    spiralContainer.children.forEach(mesh => {
      const neighbors = Array.from(mesh.userData.neighborSet || []);
      mesh.userData.neighbors = neighbors;
      mesh.userData.neighborIndices = neighbors.map(nb => nb.userData.meshIndex);
      delete mesh.userData.neighborSet;
    });
    geometryRevision += 1;
    resetAnimationState();
  }

  function getBaseMetalness() {
    const sliderMetalness = metalnessSlider ? parseFloat(metalnessSlider.value) : NaN;
    return Number.isFinite(sliderMetalness) ? sliderMetalness : 0.4;
  }

  function applyGlow(mesh, intensity, baseMetalness, colorHex = GLOW_COLORS.warm) {
    if (!mesh || !mesh.material) {
      return;
    }
    const clamped = clamp(Number.isFinite(intensity) ? intensity : 0, 0, 1);
    if (clamped <= 0.001) {
      mesh.material.emissive.setHex(0x000000);
      mesh.material.emissiveIntensity = 0;
    } else {
      mesh.material.emissive.setHex(colorHex);
      mesh.material.emissiveIntensity = clamped;
    }
    mesh.material.metalness = baseMetalness + 0.2 * clamped;
  }

  function setAnimationMode(nextId) {
    const candidate = animationDefinitions[nextId] ? nextId : defaultAnimationId;
    if (candidate !== activeAnimationId) {
      activeAnimationId = candidate;
      resetAnimationState();
    }
  }

  setAnimationMode(activeAnimationId);

  function ensureAnimationStateReady() {
    if (!spiralContainer.children.length) {
      return null;
    }
    const definition = animationDefinitions[activeAnimationId] || animationDefinitions[defaultAnimationId];
    if (!definition) {
      return null;
    }
    if (!animationState || animationState.mode !== definition.id || animationState.revision !== geometryRevision) {
      animationState = {
        mode: definition.id,
        revision: geometryRevision,
        data: definition.init({
          meshes: spiralContainer.children,
          rings: ringInfos,
          innermostRingIndex,
        }) || {},
      };
    }
    return { definition, state: animationState.data };
  }

  function applyAnimationFrame(timeSec, rotationDeg) {
    if (!spiralContainer.children.length) {
      return;
    }
    const animationPayload = ensureAnimationStateReady();
    if (!animationPayload) {
      return;
    }
    const baseMetalness = getBaseMetalness();
    spiralContainer.children.forEach(mesh => {
      applyGlow(mesh, 0, baseMetalness);
    });
    const { definition, state } = animationPayload;
    const setGlow = (mesh, intensity, color = GLOW_COLORS.warm) => {
      applyGlow(mesh, intensity, baseMetalness, color);
    };
    definition.update({
      state,
      meshes: spiralContainer.children,
      rings: ringInfos,
      innermostRingIndex,
      timeSec,
      speed: Math.max(pulseSpeed, 0.01),
      rotationDeg,
      helpers: { setGlow },
      baseMetalness,
    });
  }

  function createPolygonMesh(outline, ringIndex = 0, lineAngle = 0) {
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
    const centroid = computePolygonCentroid(outline);
    const orientation = ((Math.atan2(centroid.y, centroid.x) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    mesh.userData = {
      ringIndex,
      lineAngle: normaliseOrientationDeg(lineAngle),
      centroid,
      angle: orientation,
      ringOrder: 0,
      neighbors: [],
    };
    return mesh;
  }

  function loadSpiralFromJSON(data) {
    if (!data || !Array.isArray(data.arcgroups)) {
      throw new Error('Invalid geometry payload');
    }
    clearSpiral();
    data.arcgroups.forEach(group => {
      const patternAngles = Array.isArray(group.line_patterns) && group.line_patterns.length
        ? group.line_patterns.slice(0, 3)
        : [group.line_angle];
      patternAngles.forEach((angle, index) => {
        const mesh = createPolygonMesh(group.outline || [], group.ring_index, angle);
        if (mesh) {
          mesh.userData.patternIndex = index;
          if (index > 0) {
            mesh.position.z += 0.02 * index;
            mesh.material.transparent = true;
            mesh.material.opacity = Math.max(0.65, 1 - index * 0.15);
          }
          spiralContainer.add(mesh);
        }
      });
    });
    if (spiralContainer.children.length) {
      const box = new THREE.Box3().setFromObject(spiralContainer);
      const center = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3());
      const maxDimension = Math.max(size.x, size.y, size.z, 1e-6);
      const scale = 2.5 / maxDimension;
      spiralContainer.position.set(-center.x * scale, -center.y * scale, -center.z * scale);
      spiralContainer.scale.setScalar(scale);
      resetView();
      rebuildTopology();
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

  let cameraRotation = { x: 0, y: 0 };
  let cameraDistance = 4;
  let autoRotationSpeed = rotationSpeed ? parseFloat(rotationSpeed.value) : 0.4;
  let pulseSpeed = pulseSpeedSlider ? parseFloat(pulseSpeedSlider.value) : 1.0;
  let animationStart = performance.now();
  let ringInfos = [];
  let innermostRingIndex = 0;
  let geometryRevision = 0;
  let animationState = null;
  const defaultAnimationId = 'rotation_sweep';
  let activeAnimationId = animationModeSelect && animationDefinitions[animationModeSelect.value]
    ? animationModeSelect.value
    : defaultAnimationId;

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
    animationStart = performance.now();
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
      resetAnimationState();
    });
  }

  if (animationModeSelect) {
    animationModeSelect.addEventListener('change', () => {
      setAnimationMode(animationModeSelect.value);
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
    applyAnimationFrame(timeSec, rotationDeg);
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
