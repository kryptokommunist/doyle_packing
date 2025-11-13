/* Three.js Doyle spiral viewer.
 *
 * The viewer is designed to be reusable.  Call createThreeViewer with DOM
 * references and a geometryFetcher callback that returns Arram-Boyle geometry
 * for given spiral parameters.
 */

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function normalizeAngleRadians(angle) {
  const twoPi = Math.PI * 2;
  return ((angle % twoPi) + twoPi) % twoPi;
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

function computeOutlineCentroid(outline) {
  if (!outline || !outline.length) {
    return { x: 0, y: 0 };
  }
  let sumX = 0;
  let sumY = 0;
  for (const point of outline) {
    sumX += point[0];
    sumY += point[1];
  }
  const inv = 1 / outline.length;
  return { x: sumX * inv, y: sumY * inv };
}

function hashId(value) {
  const str = String(value ?? '');
  let hash = 0;
  for (let i = 0; i < str.length; i += 1) {
    hash = (hash * 31 + str.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
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
  const animationModeSelect = controls.animationMode || null;
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
  let animationController = null;

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
    animationController.clear();
  }

  function createPolygonMesh(outline, ringIndex = 0, lineAngle = 0, groupId = null) {
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
    const angle = Math.atan2(centroid.y, centroid.x);
    const angleNormalized = normalizeAngleRadians(angle);
    const radius = Math.hypot(centroid.x, centroid.y);
    const logIndex = (ringIndex ?? 0) + Math.log(1 + radius) + angleNormalized / (Math.PI * 2);
    const randomPhase = ((hashId(groupId ?? mesh.id) % 360) * Math.PI) / 180;
    mesh.userData = {
      ringIndex,
      lineAngle: normaliseOrientationDeg(lineAngle),
      centroid,
      angle,
      angleNormalized,
      radius,
      logIndex,
      randomPhase,
      neighbors: [],
      isPulsing: false,
      wasInRange: false,
      pulseStart: 0,
      groupId: groupId ?? null,
    };
    return mesh;
  }

  function loadSpiralFromJSON(data) {
    if (!data || !Array.isArray(data.arcgroups)) {
      throw new Error('Invalid geometry payload');
    }
    clearSpiral();
    data.arcgroups.forEach(group => {
      const mesh = createPolygonMesh(group.outline || [], group.ring_index, group.line_angle, group.id || group.name);
      if (mesh) {
        spiralContainer.add(mesh);
      }
    });
    animationController.registerMeshes(spiralContainer.children);
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

  function addNeighbor(mesh, neighbor) {
    if (!mesh || !neighbor || mesh === neighbor) {
      return;
    }
    if (!mesh.userData.neighbors) {
      mesh.userData.neighbors = [];
    }
    if (!neighbor.userData.neighbors) {
      neighbor.userData.neighbors = [];
    }
    if (!mesh.userData.neighbors.includes(neighbor)) {
      mesh.userData.neighbors.push(neighbor);
    }
    if (!neighbor.userData.neighbors.includes(mesh)) {
      neighbor.userData.neighbors.push(mesh);
    }
  }

  function linkAdjacentRings(innerRing = [], outerRing = []) {
    if (!innerRing.length || !outerRing.length) {
      return;
    }
    for (const cell of innerRing) {
      let closestIndex = 0;
      let bestDiff = Infinity;
      const targetAngle = cell.userData.angleNormalized || 0;
      for (let idx = 0; idx < outerRing.length; idx += 1) {
        const candidateAngle = outerRing[idx].userData.angleNormalized || 0;
        const diff = Math.abs(candidateAngle - targetAngle);
        const wrappedDiff = Math.min(diff, Math.abs(diff - Math.PI * 2));
        if (wrappedDiff < bestDiff) {
          bestDiff = wrappedDiff;
          closestIndex = idx;
        }
      }
      const neighborA = outerRing[closestIndex];
      const neighborB = outerRing[(closestIndex + 1) % outerRing.length];
      addNeighbor(cell, neighborA);
      addNeighbor(cell, neighborB);
    }
  }

  const animationModes = {
    orientation_sweep: {
      update: ({ controller, timeSec, rotationDeg, speed }) => {
        const threshold = 20;
        const duration = 1 / Math.max(speed || 1, 0.0001);
        controller.meshes.forEach(mesh => {
          const lineAngle = mesh.userData.lineAngle || 0;
          const diff = angularDifferenceDeg(rotationDeg, lineAngle);
          const isInRange = diff < threshold;
          if (isInRange && !mesh.userData.wasInRange) {
            mesh.userData.isPulsing = true;
            mesh.userData.pulseStart = timeSec;
          }
          let intensity = 0;
          if (mesh.userData.isPulsing) {
            const elapsed = timeSec - mesh.userData.pulseStart;
            if (elapsed < duration) {
              const t = elapsed / duration;
              intensity = Math.sin(t * Math.PI);
            } else {
              mesh.userData.isPulsing = false;
            }
          }
          if (intensity > 0) {
            controller.highlight(mesh, intensity, 0xffd700);
          }
          mesh.userData.wasInRange = isInRange;
        });
      },
    },
    ring_chase: {
      update: ({ controller, timeSec, speed }) => {
        const baseSpeed = Math.max(speed || 1, 0.1);
        controller.ringOrder.forEach((ring, ringIdx) => {
          const ringCells = controller.ringMap.get(ring) || [];
          if (!ringCells.length) {
            return;
          }
          const localSpeed = baseSpeed * 0.5;
          const offset = ringIdx * 0.35;
          const travel = ((timeSec * localSpeed) + offset) % ringCells.length;
          const currentIndex = Math.floor(travel);
          const frac = travel - currentIndex;
          const current = ringCells[currentIndex];
          const next = ringCells[(currentIndex + 1) % ringCells.length];
          if (current) {
            controller.highlight(current, 1 - frac, 0xffc857);
          }
          if (next) {
            controller.highlight(next, frac, 0xffc857);
          }
        });
      },
    },
    ring_wave: {
      update: ({ controller, timeSec, speed }) => {
        const ringCount = controller.ringOrder.length;
        if (!ringCount) {
          return;
        }
        const travel = (timeSec * Math.max(speed || 1, 0.1) * 0.4) % ringCount;
        const index = Math.floor(travel);
        const blend = travel - index;
        const ringA = controller.ringMap.get(controller.ringOrder[index]) || [];
        const ringB = controller.ringMap.get(controller.ringOrder[(index + 1) % ringCount]) || [];
        ringA.forEach(mesh => controller.highlight(mesh, 1 - blend, 0xfff5c0));
        ringB.forEach(mesh => controller.highlight(mesh, blend, 0xfff5c0));
      },
    },
    spiral_expansion: {
      update: ({ controller, timeSec, speed }) => {
        if (!controller.meshes.length) {
          return;
        }
        const { min, max } = controller.logRange;
        const span = Math.max(max - min, 1e-3);
        const wave = (timeSec * Math.max(speed || 1, 0.1) * 0.2) % 1;
        const cutoff = min + wave * span;
        const softness = span * 0.12;
        controller.meshes.forEach(mesh => {
          const value = mesh.userData.logIndex || 0;
          if (value > cutoff || value < cutoff - softness) {
            return;
          }
          const t = 1 - (cutoff - value) / softness;
          controller.highlight(mesh, clamp(t, 0, 1), 0xfff08a);
        });
      },
    },
    spiral_dual: {
      update: ({ controller, timeSec, speed }) => {
        const order = controller.spiralOrder;
        const total = order.length;
        if (!total) {
          return;
        }
        const travel = (timeSec * Math.max(speed || 1, 0.1) * 0.4) % total;
        const width = Math.max(3, Math.floor(total * 0.02));
        for (let i = 0; i < width; i += 1) {
          const fade = 1 - i / width;
          const idxA = Math.floor((travel + i) % total);
          const idxB = Math.floor((travel + total / 2 + i) % total);
          if (order[idxA]) {
            controller.highlight(order[idxA], fade, 0xff6ff0);
          }
          if (order[idxB]) {
            controller.highlight(order[idxB], fade, 0x6fffe2);
          }
        }
      },
    },
    constellation: {
      update: ({ controller, timeSec, speed }) => {
        const baseSpeed = Math.max(speed || 1, 0.1);
        controller.meshes.forEach(mesh => {
          const phase = mesh.userData.randomPhase || 0;
          const wave = Math.sin(timeSec * baseSpeed + phase);
          const intensity = Math.pow(Math.max(0, wave), 2);
          if (intensity > 0.05) {
            controller.highlight(mesh, intensity, 0xcffafe);
          }
        });
      },
    },
    ca_frontier: {
      createState: controller => ({
        frontier: [],
        visited: new Set(),
        activationTime: new Map(),
        lastAdvance: 0,
        initialized: false,
        controller,
      }),
      update: ({ controller, state, timeSec, speed }) => {
        const interval = Math.max(0.2, 0.8 / Math.max(speed || 1, 0.1));
        if (!state.initialized) {
          const inner = controller.getInnerRingMeshes();
          state.frontier = inner.slice();
          state.visited = new Set(inner);
          state.activationTime.clear();
          inner.forEach(mesh => state.activationTime.set(mesh, timeSec));
          state.initialized = true;
        }
        if (timeSec - state.lastAdvance >= interval) {
          const next = [];
          state.frontier.forEach(mesh => {
            controller.getNeighbors(mesh).forEach(neighbor => {
              if (!state.visited.has(neighbor)) {
                state.visited.add(neighbor);
                state.activationTime.set(neighbor, timeSec);
                next.push(neighbor);
              }
            });
          });
          if (!next.length) {
            const inner = controller.getInnerRingMeshes();
            state.visited = new Set(inner);
            state.activationTime.clear();
            inner.forEach(mesh => state.activationTime.set(mesh, timeSec));
            state.frontier = inner.slice();
          } else {
            state.frontier = next;
          }
          state.lastAdvance = timeSec;
        }
        const fadeDuration = Math.max(0.6, 2 / Math.max(speed || 1, 0.1));
        for (const [mesh, started] of state.activationTime.entries()) {
          const elapsed = timeSec - started;
          const t = 1 - elapsed / fadeDuration;
          if (t <= 0) {
            state.activationTime.delete(mesh);
          } else {
            controller.highlight(mesh, t, 0xff914d);
          }
        }
      },
    },
    ca_echo: {
      createState: controller => {
        const cells = new Map();
        controller.meshes.forEach(mesh => {
          const active = (mesh.userData.ringIndex ?? 0) === controller.minRing ? 1 : 0;
          cells.set(mesh, active);
        });
        return {
          cells,
          buffer: new Map(),
          lastStep: 0,
        };
      },
      update: ({ controller, state, timeSec, speed }) => {
        const stepDuration = Math.max(0.25, 0.9 / Math.max(speed || 1, 0.1));
        if (timeSec - state.lastStep >= stepDuration) {
          state.buffer.clear();
          controller.meshes.forEach(mesh => {
            const current = state.cells.get(mesh) || 0;
            const activeNeighbors = controller.getNeighbors(mesh).reduce((sum, neighbor) => sum + (state.cells.get(neighbor) || 0), 0);
            let next = current;
            if (current === 1) {
              next = activeNeighbors >= 1 && activeNeighbors <= 3 ? 1 : 0;
            } else if (activeNeighbors >= 2) {
              next = 1;
            }
            state.buffer.set(mesh, next);
          });
          state.cells = new Map(state.buffer);
          state.lastStep = timeSec;
        }
        controller.meshes.forEach(mesh => {
          if (state.cells.get(mesh)) {
            controller.highlight(mesh, 0.65, 0x7dd3fc);
          }
        });
      },
    },
    ca_checker: {
      createState: controller => {
        const cells = new Map();
        controller.meshes.forEach(mesh => {
          const active = (mesh.userData.ringIndex ?? 0) === controller.minRing ? 1 : 0;
          cells.set(mesh, active);
        });
        return {
          cells,
          buffer: new Map(),
          lastStep: 0,
        };
      },
      update: ({ controller, state, timeSec, speed }) => {
        const stepDuration = Math.max(0.15, 0.6 / Math.max(speed || 1, 0.1));
        if (timeSec - state.lastStep >= stepDuration) {
          state.buffer.clear();
          controller.meshes.forEach(mesh => {
            const parity = Math.abs((mesh.userData.ringIndex ?? 0) - controller.minRing) % 2;
            const neighborSum = controller.getNeighbors(mesh).reduce((sum, neighbor) => sum + (state.cells.get(neighbor) || 0), 0);
            const next = (neighborSum + parity) % 2;
            state.buffer.set(mesh, next);
          });
          state.cells = new Map(state.buffer);
          state.lastStep = timeSec;
        }
        controller.meshes.forEach(mesh => {
          if (state.cells.get(mesh)) {
            const flicker = 0.7 + 0.3 * Math.sin(timeSec * Math.max(speed || 1, 0.1) + (mesh.userData.randomPhase || 0));
            controller.highlight(mesh, flicker, 0xa78bfa);
          }
        });
      },
    },
  };

  function createAnimationController(defaultMode = 'orientation_sweep') {
    const controller = {
      meshes: [],
      ringMap: new Map(),
      ringOrder: [],
      spiralOrder: [],
      logRange: { min: 0, max: 1 },
      minRing: 0,
      baseMetalness: 0.4,
      mode: Object.prototype.hasOwnProperty.call(animationModes, defaultMode) ? defaultMode : 'orientation_sweep',
      modeState: null,
      clear() {
        this.meshes = [];
        this.ringMap.clear();
        this.ringOrder = [];
        this.spiralOrder = [];
        this.logRange = { min: 0, max: 1 };
        this.modeState = null;
      },
      registerMeshes(children) {
        this.clear();
        let minLog = Infinity;
        let maxLog = -Infinity;
        const meshes = [];
        children.forEach(child => {
          if (!child.isMesh) {
            return;
          }
          meshes.push(child);
          const ring = Number(child.userData?.ringIndex ?? 0);
          if (!this.ringMap.has(ring)) {
            this.ringMap.set(ring, []);
          }
          this.ringMap.get(ring).push(child);
          child.userData.neighbors = [];
          const logIndex = Number(child.userData?.logIndex ?? 0);
          if (Number.isFinite(logIndex)) {
            minLog = Math.min(minLog, logIndex);
            maxLog = Math.max(maxLog, logIndex);
          }
        });
        this.meshes = meshes;
        if (!Number.isFinite(minLog) || !Number.isFinite(maxLog)) {
          minLog = 0;
          maxLog = 1;
        }
        this.logRange = { min: minLog, max: maxLog };
        this.ringOrder = Array.from(this.ringMap.keys()).sort((a, b) => a - b);
        this.minRing = this.ringOrder.length ? this.ringOrder[0] : 0;
        this.ringOrder.forEach(ring => {
          const cells = this.ringMap.get(ring) || [];
          cells.sort((a, b) => (a.userData.angleNormalized || 0) - (b.userData.angleNormalized || 0));
          if (cells.length > 1) {
            for (let i = 0; i < cells.length; i += 1) {
              const prev = cells[(i - 1 + cells.length) % cells.length];
              const next = cells[(i + 1) % cells.length];
              addNeighbor(cells[i], prev);
              addNeighbor(cells[i], next);
            }
          }
        });
        for (let i = 0; i < this.ringOrder.length - 1; i += 1) {
          const innerRing = this.ringOrder[i];
          const outerRing = this.ringOrder[i + 1];
          linkAdjacentRings(this.ringMap.get(innerRing) || [], this.ringMap.get(outerRing) || []);
        }
        this.spiralOrder = [...this.meshes].sort((a, b) => (a.userData.logIndex || 0) - (b.userData.logIndex || 0));
        this.modeState = null;
      },
      resetMeshes(baseMetalness) {
        this.baseMetalness = baseMetalness;
        this.meshes.forEach(mesh => {
          if (!mesh.material) {
            return;
          }
          mesh.material.emissive.setHex(0x000000);
          mesh.material.emissiveIntensity = 0;
          mesh.material.metalness = baseMetalness;
        });
      },
      highlight(mesh, intensity, color = 0xffd700) {
        if (!mesh || !mesh.material) {
          return;
        }
        const level = clamp(intensity ?? 0, 0, 1);
        if (level <= 0) {
          return;
        }
        mesh.material.emissive.setHex(color);
        mesh.material.emissiveIntensity = level;
        mesh.material.metalness = this.baseMetalness + level * 0.2;
      },
      setMode(mode) {
        const nextMode = Object.prototype.hasOwnProperty.call(animationModes, mode) ? mode : 'orientation_sweep';
        if (this.mode !== nextMode) {
          this.mode = nextMode;
        }
        this.modeState = null;
      },
      getInnerRingMeshes() {
        return this.ringMap.get(this.minRing) || [];
      },
      getNeighbors(mesh) {
        return (mesh && mesh.userData && mesh.userData.neighbors) || [];
      },
      update({ timeSec, rotationDeg, speed, baseMetalness }) {
        if (!this.meshes.length) {
          return;
        }
        const modeKey = Object.prototype.hasOwnProperty.call(animationModes, this.mode) ? this.mode : 'orientation_sweep';
        const descriptor = animationModes[modeKey];
        this.resetMeshes(baseMetalness);
        if (!this.modeState && typeof descriptor.createState === 'function') {
          this.modeState = descriptor.createState(this);
        } else if (!this.modeState) {
          this.modeState = {};
        }
        descriptor.update({ controller: this, state: this.modeState, timeSec, rotationDeg, speed });
      },
    };
    return controller;
  }

  animationController = createAnimationController(animationModeSelect ? animationModeSelect.value : 'orientation_sweep');

  let cameraRotation = { x: 0, y: 0 };
  let cameraDistance = 4;
  let autoRotationSpeed = rotationSpeed ? parseFloat(rotationSpeed.value) : 0.4;
  let pulseSpeed = pulseSpeedSlider ? parseFloat(pulseSpeedSlider.value) : 1.0;
  let animationStart = performance.now();

  function runAnimationFrame(rotationAngleDeg, timeSec) {
    if (!spiralContainer.children.length) {
      return;
    }
    const sliderMetalness = metalnessSlider ? parseFloat(metalnessSlider.value) : NaN;
    const baseMetalness = Number.isFinite(sliderMetalness) ? sliderMetalness : 0.4;
    animationController.update({
      rotationDeg: rotationAngleDeg,
      timeSec,
      speed: pulseSpeed,
      baseMetalness,
    });
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
      animationController.setMode(animationModeSelect.value);
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
    runAnimationFrame(rotationDeg, timeSec);
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
