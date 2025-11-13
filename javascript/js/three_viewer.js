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

const INACTIVE_TIME = -1e6;

function wrap01(value) {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return ((value % 1) + 1) % 1;
}

function angularDistanceRad(a, b) {
  if (!Number.isFinite(a) || !Number.isFinite(b)) {
    return 0;
  }
  const diff = Math.abs(a - b) % (Math.PI * 2);
  return Math.min(diff, Math.PI * 2 - diff);
}

function polygonCentroid(points) {
  if (!Array.isArray(points) || points.length === 0) {
    return { x: 0, y: 0 };
  }
  let areaAcc = 0;
  let cx = 0;
  let cy = 0;
  const count = points.length;
  for (let idx = 0; idx < count; idx += 1) {
    const current = points[idx];
    const next = points[(idx + 1) % count];
    if (!current || !next) {
      continue;
    }
    const x1 = Number(current[0]) || 0;
    const y1 = Number(current[1]) || 0;
    const x2 = Number(next[0]) || 0;
    const y2 = Number(next[1]) || 0;
    const cross = x1 * y2 - x2 * y1;
    areaAcc += cross;
    cx += (x1 + x2) * cross;
    cy += (y1 + y2) * cross;
  }
  if (Math.abs(areaAcc) < 1e-9) {
    let sx = 0;
    let sy = 0;
    for (const point of points) {
      const px = Array.isArray(point) ? Number(point[0]) || 0 : 0;
      const py = Array.isArray(point) ? Number(point[1]) || 0 : 0;
      sx += px;
      sy += py;
    }
    const inv = 1 / points.length;
    return { x: sx * inv, y: sy * inv };
  }
  const factor = 1 / (3 * areaAcc);
  return { x: cx * factor, y: cy * factor };
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
  const reloadButton = controls.reloadButton || null;
  const loadJsonButton = controls.loadJsonButton || null;
  const resetCameraButton = controls.resetCameraButton || null;
  const fileInput = controls.fileInput || null;
  const animationModeSelect = controls.animationModeSelect || null;

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

  const normalizationState = { center: new THREE.Vector3(), scale: 1 };
  let animationMetadata = null;
  let animationState = null;
  let animationMode = animationModeSelect && animationModeSelect.value
    ? animationModeSelect.value
    : 'orbit_sweep';

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
    animationMetadata = null;
    animationState = null;
    normalizationState.center.set(0, 0, 0);
    normalizationState.scale = 1;
  }

  function createPolygonMesh(outline, ringIndex = 0, lineAngle = 0) {
    if (!outline || outline.length < 3) {
      return null;
    }
    const centroid = polygonCentroid(outline);
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
    mesh.userData = {
      ringIndex,
      lineAngle: normaliseOrientationDeg(lineAngle),
      baseCentroid: centroid,
    };
    return mesh;
  }

  function buildAnimationMetadata() {
    const meshes = spiralContainer.children.filter(child => child.isMesh);
    if (!meshes.length) {
      return null;
    }
    const normalizedCenter = normalizationState.center;
    const normalizedScale = normalizationState.scale || 1;
    const metaList = meshes.map((mesh, index) => {
      const userData = mesh.userData || {};
      const ringIndex = Number(
        Number.isFinite(userData.ringIndex) ? userData.ringIndex : 0,
      );
      const lineAngle = Number(
        Number.isFinite(userData.lineAngle) ? userData.lineAngle : 0,
      );
      const baseCentroid = userData.baseCentroid || { x: 0, y: 0 };
      const nx = (baseCentroid.x - normalizedCenter.x) * normalizedScale;
      const ny = (baseCentroid.y - normalizedCenter.y) * normalizedScale;
      const angleRad = Math.atan2(ny, nx);
      const radius = Math.hypot(nx, ny);
      return {
        mesh,
        index,
        ringIndex,
        lineAngle,
        centroid: { x: nx, y: ny },
        angleRad: Number.isFinite(angleRad) ? angleRad : 0,
        radius: Number.isFinite(radius) ? radius : 0,
        neighbors: new Set(),
        ringPosition: 0,
        ringSize: 1,
      };
    });
    const ringMap = new Map();
    for (const meta of metaList) {
      const key = Number.isFinite(meta.ringIndex) ? meta.ringIndex : 0;
      if (!ringMap.has(key)) {
        ringMap.set(key, []);
      }
      ringMap.get(key).push(meta);
    }
    const orderedRings = Array.from(ringMap.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([ringIndex, items]) => {
        items.sort((a, b) => a.angleRad - b.angleRad);
        items.forEach((meta, idx) => {
          meta.ringPosition = idx;
          meta.ringSize = items.length;
        });
        return { ringIndex, items };
      });
    if (!orderedRings.length) {
      return null;
    }
    const minRing = orderedRings[0].ringIndex;
    const maxRing = orderedRings[orderedRings.length - 1].ringIndex;
    const connectNeighbors = (a, b) => {
      if (!a || !b || a.index === b.index) {
        return;
      }
      a.neighbors.add(b.index);
      b.neighbors.add(a.index);
    };
    for (const layer of orderedRings) {
      const { items } = layer;
      if (items.length <= 1) {
        continue;
      }
      for (let idx = 0; idx < items.length; idx += 1) {
        const current = items[idx];
        const next = items[(idx + 1) % items.length];
        connectNeighbors(current, next);
      }
    }
    const connectAcrossLayer = (source, targetLayer) => {
      if (!source || !targetLayer || !targetLayer.length) {
        return;
      }
      let nearestIndex = 0;
      let nearestDistance = Infinity;
      for (let idx = 0; idx < targetLayer.length; idx += 1) {
        const candidate = targetLayer[idx];
        const distance = angularDistanceRad(source.angleRad, candidate.angleRad);
        if (distance < nearestDistance) {
          nearestDistance = distance;
          nearestIndex = idx;
        }
      }
      const target = targetLayer[nearestIndex];
      connectNeighbors(source, target);
      if (targetLayer.length > 1) {
        const sibling = targetLayer[(nearestIndex + 1) % targetLayer.length];
        connectNeighbors(source, sibling);
      }
    };
    for (let idx = 0; idx < orderedRings.length; idx += 1) {
      const currentLayer = orderedRings[idx];
      const innerLayer = idx > 0 ? orderedRings[idx - 1].items : [];
      const outerLayer = idx < orderedRings.length - 1 ? orderedRings[idx + 1].items : [];
      currentLayer.items.forEach(meta => {
        connectAcrossLayer(meta, innerLayer);
        connectAcrossLayer(meta, outerLayer);
      });
    }
    metaList.forEach(meta => {
      meta.neighbors = Array.from(meta.neighbors);
    });
    const spiralWeight = 0.35;
    const spiralOrder = metaList.slice().sort((a, b) => {
      const aKey = Math.log(a.radius + 1) + a.angleRad * spiralWeight;
      const bKey = Math.log(b.radius + 1) + b.angleRad * spiralWeight;
      return aKey - bKey;
    });
    const dualSpirals = {
      positive: spiralOrder.filter(meta => meta.angleRad >= 0),
      negative: spiralOrder.filter(meta => meta.angleRad < 0),
    };
    const seedIndices = orderedRings[0].items.map(meta => meta.index);
    return {
      meshes: metaList,
      rings: orderedRings,
      minRing,
      maxRing,
      version: Date.now(),
      ringSpan: Math.max(1, orderedRings.length - 1),
      layerCount: orderedRings.length,
      spiralOrder,
      dualSpirals,
      seedIndices,
    };
  }

  function createRipplePayload(metadata) {
    const count = metadata.meshes.length;
    return {
      type: 'ripple',
      seeds: metadata.seedIndices.slice(),
      activationTimes: new Float32Array(count).fill(INACTIVE_TIME),
      visited: new Uint8Array(count),
      frontier: [],
      initialized: false,
      lastStep: 0,
      stepInterval: 0.45,
      fadeDuration: 1.2,
    };
  }

  function initializeRipplePayload(payload, timeSec) {
    payload.activationTimes.fill(INACTIVE_TIME);
    payload.visited.fill(0);
    payload.frontier = payload.seeds.slice();
    payload.initialized = payload.frontier.length > 0;
    payload.lastStep = timeSec;
    if (!payload.initialized) {
      return;
    }
    for (const idx of payload.frontier) {
      payload.visited[idx] = 1;
      payload.activationTimes[idx] = timeSec;
    }
  }

  function stepRipplePayload(payload, metadata, timeSec) {
    if (!payload.frontier.length) {
      payload.initialized = false;
      return;
    }
    const next = [];
    for (const idx of payload.frontier) {
      const meta = metadata.meshes[idx];
      if (!meta) {
        continue;
      }
      for (const neighborIdx of meta.neighbors) {
        if (!payload.visited[neighborIdx]) {
          payload.visited[neighborIdx] = 1;
          payload.activationTimes[neighborIdx] = timeSec;
          next.push(neighborIdx);
        }
      }
    }
    payload.frontier = next;
    payload.lastStep = timeSec;
    if (!next.length) {
      payload.initialized = false;
    }
  }

  function applyRippleLevels(payload, timeSec, levels) {
    const fade = payload.fadeDuration || 1.2;
    const times = payload.activationTimes;
    for (let idx = 0; idx < times.length; idx += 1) {
      const start = times[idx];
      if (start <= INACTIVE_TIME / 2) {
        continue;
      }
      const elapsed = timeSec - start;
      if (elapsed < fade) {
        const intensity = Math.max(0, 1 - elapsed / fade);
        levels[idx] = Math.max(levels[idx], intensity);
      }
    }
  }

  function runRippleMode(context, levels) {
    const { metadata, state, timeSec, pulseSpeed: pulse } = context;
    const payload = state.payload;
    if (!payload || !metadata.seedIndices.length) {
      return;
    }
    const speedFactor = Math.max(0.2, Number.isFinite(pulse) ? pulse : 1);
    const interval = payload.stepInterval / speedFactor;
    if (!payload.initialized) {
      initializeRipplePayload(payload, timeSec);
    }
    if (payload.initialized && timeSec - payload.lastStep >= interval) {
      stepRipplePayload(payload, metadata, timeSec);
      if (!payload.initialized) {
        initializeRipplePayload(payload, timeSec);
      }
    }
    applyRippleLevels(payload, timeSec, levels);
  }

  function countActiveNeighbors(meta, activeFlags) {
    if (!meta || !meta.neighbors) {
      return 0;
    }
    let count = 0;
    for (const neighborIdx of meta.neighbors) {
      if (activeFlags[neighborIdx]) {
        count += 1;
      }
    }
    return count;
  }

  function createCellularPayload(metadata, options = {}) {
    const count = metadata.meshes.length;
    const stepInterval = typeof options.stepInterval === 'number' ? options.stepInterval : 0.5;
    const fadeDuration = typeof options.fadeDuration === 'number' ? options.fadeDuration : 1.3;
    const sustainLevel = typeof options.sustainLevel === 'number' ? options.sustainLevel : 0.2;
    return {
      type: 'cellular',
      seeds: metadata.seedIndices.slice(),
      activationTimes: new Float32Array(count).fill(INACTIVE_TIME),
      active: new Uint8Array(count),
      nextActive: new Uint8Array(count),
      initialized: false,
      lastStep: 0,
      stepInterval,
      fadeDuration,
      sustainLevel,
      rule: options.rule || null,
    };
  }

  function initializeCellularPayload(payload, timeSec) {
    payload.activationTimes.fill(INACTIVE_TIME);
    payload.active.fill(0);
    payload.nextActive.fill(0);
    if (!payload.seeds.length) {
      payload.initialized = false;
      return;
    }
    for (const idx of payload.seeds) {
      payload.active[idx] = 1;
      payload.activationTimes[idx] = timeSec;
    }
    payload.lastStep = timeSec;
    payload.initialized = true;
  }

  function stepCellularAutomaton(payload, metadata, timeSec) {
    const active = payload.active;
    const next = payload.nextActive;
    next.fill(0);
    const rule = payload.rule;
    if (!rule) {
      payload.initialized = false;
      return;
    }
    let hasActive = false;
    for (let idx = 0; idx < metadata.meshes.length; idx += 1) {
      const meta = metadata.meshes[idx];
      const neighborCount = countActiveNeighbors(meta, active);
      const willBeActive = rule({
        wasActive: active[idx] === 1,
        neighborCount,
        meta,
        index: idx,
      });
      if (willBeActive) {
        next[idx] = 1;
        if (!active[idx]) {
          payload.activationTimes[idx] = timeSec;
        }
        hasActive = true;
      }
    }
    payload.active.set(next);
    payload.lastStep = timeSec;
    if (!hasActive) {
      payload.initialized = false;
    }
  }

  function applyCellularLevels(payload, timeSec, levels) {
    const { activationTimes, fadeDuration, sustainLevel, active } = payload;
    for (let idx = 0; idx < activationTimes.length; idx += 1) {
      if (activationTimes[idx] <= INACTIVE_TIME / 2) {
        continue;
      }
      const elapsed = timeSec - activationTimes[idx];
      let intensity = 0;
      if (elapsed < fadeDuration) {
        intensity = Math.max(sustainLevel, 1 - elapsed / fadeDuration);
      } else if (active[idx]) {
        intensity = sustainLevel;
      }
      if (intensity > 0) {
        levels[idx] = Math.max(levels[idx], intensity);
      }
    }
  }

  function runCellularMode(context, levels) {
    const { metadata, state, timeSec, pulseSpeed: pulse } = context;
    const payload = state.payload;
    if (!payload || !payload.seeds.length) {
      return;
    }
    if (!payload.initialized) {
      initializeCellularPayload(payload, timeSec);
    }
    const speedFactor = Math.max(0.2, Number.isFinite(pulse) ? pulse : 1);
    const interval = payload.stepInterval / speedFactor;
    if (payload.initialized && timeSec - payload.lastStep >= interval) {
      stepCellularAutomaton(payload, metadata, timeSec);
      if (!payload.initialized) {
        initializeCellularPayload(payload, timeSec);
      }
    }
    applyCellularLevels(payload, timeSec, levels);
  }

  const animationModes = {
    orbit_sweep: {
      label: 'Orbit sweep highlight',
      update(context, levels) {
        const { metadata, rotationDeg } = context;
        const threshold = 20;
        for (const meta of metadata.meshes) {
          const diff = angularDifferenceDeg(rotationDeg || 0, meta.lineAngle || 0);
          if (diff < threshold) {
            const intensity = Math.pow(1 - diff / threshold, 2);
            levels[meta.index] = Math.max(levels[meta.index], intensity);
          }
        }
      },
    },
    ring_pulse: {
      label: 'Ring pulse wave',
      update(context, levels) {
        const { metadata, timeSec, pulseSpeed: pulse } = context;
        const speedFactor = Math.max(0.2, Number.isFinite(pulse) ? pulse : 1);
        const head = wrap01(timeSec * 0.12 * speedFactor);
        for (const meta of metadata.meshes) {
          const normalized = metadata.ringSpan === 0
            ? 0
            : (meta.ringIndex - metadata.minRing) / metadata.ringSpan;
          let diff = Math.abs(normalized - head);
          diff = Math.min(diff, 1 - diff);
          const intensity = Math.max(0, 1 - diff * 3.2);
          levels[meta.index] = Math.max(levels[meta.index], intensity);
        }
      },
    },
    ring_cascade: {
      label: 'Ring cascade',
      update(context, levels) {
        const { metadata, timeSec, pulseSpeed: pulse } = context;
        const speedFactor = Math.max(0.2, Number.isFinite(pulse) ? pulse : 1);
        metadata.rings.forEach((layer, idx) => {
          const items = layer.items;
          if (!items.length) {
            return;
          }
          const speed = (0.35 + idx * 0.05) * speedFactor;
          const head = (timeSec * speed) % items.length;
          const trail = Math.max(1, items.length * 0.25);
          items.forEach(meta => {
            const rawDiff = Math.abs(meta.ringPosition - head);
            const wrapped = Math.min(rawDiff, items.length - rawDiff);
            const intensity = Math.max(0, 1 - wrapped / trail);
            levels[meta.index] = Math.max(levels[meta.index], intensity);
          });
        });
      },
    },
    log_spiral: {
      label: 'Log spiral expansion',
      update(context, levels) {
        const { metadata, timeSec, pulseSpeed: pulse } = context;
        const order = metadata.spiralOrder;
        if (!order.length) {
          return;
        }
        const speedFactor = Math.max(0.2, Number.isFinite(pulse) ? pulse : 1);
        const travel = wrap01(timeSec * 0.1 * speedFactor);
        const tailLength = 0.22;
        order.forEach((meta, idx) => {
          const position = idx / order.length;
          let diff = position - travel;
          if (diff < 0) {
            diff += 1;
          }
          if (diff < tailLength) {
            const intensity = 1 - diff / tailLength;
            levels[meta.index] = Math.max(levels[meta.index], intensity);
          }
        });
      },
    },
    dual_spiral: {
      label: 'Dual spiral weave',
      update(context, levels) {
        const { metadata, timeSec, pulseSpeed: pulse } = context;
        const speedFactor = Math.max(0.2, Number.isFinite(pulse) ? pulse : 1);
        const applySequence = (sequence, offset) => {
          if (!sequence.length) {
            return;
          }
          const head = wrap01(timeSec * 0.1 * speedFactor + offset);
          const tail = 0.18;
          sequence.forEach((meta, idx) => {
            const position = idx / sequence.length;
            let diff = position - head;
            if (diff < 0) {
              diff += 1;
            }
            if (diff < tail) {
              const intensity = 1 - diff / tail;
              levels[meta.index] = Math.max(levels[meta.index], intensity);
            }
          });
        };
        applySequence(metadata.dualSpirals.positive, 0);
        applySequence(metadata.dualSpirals.negative, 0.5);
      },
    },
    ca_ripple: {
      label: 'Cellular ripple wave',
      createState: metadata => createRipplePayload(metadata),
      update: runRippleMode,
    },
    ca_bloom: {
      label: 'Cellular bloom',
      createState: metadata => createCellularPayload(metadata, {
        stepInterval: 0.5,
        fadeDuration: 1.6,
        sustainLevel: 0.25,
        rule: ({ wasActive, neighborCount }) => {
          if (wasActive) {
            return neighborCount >= 1;
          }
          return neighborCount >= 2;
        },
      }),
      update: runCellularMode,
    },
    ca_echo: {
      label: 'Cellular echo lattice',
      createState: metadata => createCellularPayload(metadata, {
        stepInterval: 0.4,
        fadeDuration: 1.2,
        sustainLevel: 0.18,
        rule: ({ wasActive, neighborCount }) => {
          if (wasActive) {
            return neighborCount === 1 || neighborCount === 2;
          }
          return neighborCount === 1;
        },
      }),
      update: runCellularMode,
    },
  };

  function setAnimationMode(newMode) {
    const key = animationModes[newMode] ? newMode : 'orbit_sweep';
    animationMode = key;
    animationState = null;
  }

  setAnimationMode(animationMode);

  function applyLevelsToMeshes(levels) {
    if (!animationMetadata || !animationMetadata.meshes.length) {
      return;
    }
    const baseMetalness = metalnessSlider ? parseFloat(metalnessSlider.value) : NaN;
    const resolvedMetalness = Number.isFinite(baseMetalness) ? baseMetalness : 0.4;
    for (let idx = 0; idx < animationMetadata.meshes.length; idx += 1) {
      const meta = animationMetadata.meshes[idx];
      const mesh = meta.mesh;
      const intensity = clamp(levels[idx] || 0, 0, 1);
      if (intensity > 1e-3) {
        mesh.material.emissive.setHex(0xffd700);
        mesh.material.emissiveIntensity = 0.2 + 0.8 * intensity;
        mesh.material.metalness = clamp(resolvedMetalness + 0.15 * intensity, 0, 1);
      } else {
        mesh.material.emissive.setHex(0x000000);
        mesh.material.emissiveIntensity = 0;
        mesh.material.metalness = resolvedMetalness;
      }
    }
  }

  function applyAnimationModes(timeSec, rotationDeg) {
    if (!animationMetadata || !animationMetadata.meshes.length) {
      return;
    }
    const mode = animationModes[animationMode] || animationModes.orbit_sweep;
    if (!animationState || animationState.mode !== animationMode || animationState.version !== animationMetadata.version) {
      animationState = {
        mode: animationMode,
        version: animationMetadata.version,
        levels: new Float32Array(animationMetadata.meshes.length),
        payload: mode.createState ? mode.createState(animationMetadata) : null,
      };
    } else if (animationState.levels.length !== animationMetadata.meshes.length) {
      animationState.levels = new Float32Array(animationMetadata.meshes.length);
    }
    const context = {
      metadata: animationMetadata,
      state: animationState,
      timeSec,
      rotationDeg,
      pulseSpeed: pulseSpeed,
    };
    animationState.levels.fill(0);
    if (mode.update) {
      mode.update(context, animationState.levels);
    }
    applyLevelsToMeshes(animationState.levels);
  }

  function loadSpiralFromJSON(data) {
    if (!data || !Array.isArray(data.arcgroups)) {
      throw new Error('Invalid geometry payload');
    }
    clearSpiral();
    data.arcgroups.forEach(group => {
      const mesh = createPolygonMesh(group.outline || [], group.ring_index, group.line_angle);
      if (mesh) {
        spiralContainer.add(mesh);
      }
    });
    if (spiralContainer.children.length) {
      const box = new THREE.Box3().setFromObject(spiralContainer);
      const center = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3());
      const maxDimension = Math.max(size.x, size.y, size.z, 1e-6);
      const scale = 2.5 / maxDimension;
      normalizationState.center.copy(center);
      normalizationState.scale = scale;
      spiralContainer.position.set(-center.x * scale, -center.y * scale, -center.z * scale);
      spiralContainer.scale.setScalar(scale);
      resetView();
    } else {
      normalizationState.center.set(0, 0, 0);
      normalizationState.scale = 1;
    }
    animationMetadata = buildAnimationMetadata();
    animationState = null;
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

  if (animationModeSelect) {
    animationModeSelect.addEventListener('change', () => {
      setAnimationMode(animationModeSelect.value);
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
    applyAnimationModes(timeSec, rotationDeg);
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
