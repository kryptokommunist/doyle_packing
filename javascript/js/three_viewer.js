/* Three.js Doyle spiral viewer.
 *
 * The viewer is designed to be reusable.  Call createThreeViewer with DOM
 * references and a geometryFetcher callback that returns Arram-Boyle geometry
 * for given spiral parameters.
 */

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
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
  }

  function createPolygonMesh(outline, ringIndex = 0, lineAngle = 0, patternFrame = null) {
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
    mesh.userData = {
      ringIndex,
      lineAngle: lineAngle || 0,
      patternFrame: Number.isFinite(patternFrame) ? patternFrame : null,
      isPulsing: false,
      wasInRange: false,
      pulseStart: 0,
    };
    return mesh;
  }

  function loadSpiralFromJSON(data) {
    if (!data || !Array.isArray(data.arcgroups)) {
      throw new Error('Invalid geometry payload');
    }
    clearSpiral();
    const frameCount = Number.isFinite(data.pattern_frame_count) ? data.pattern_frame_count : null;
    if (Number.isFinite(frameCount)) {
      spiralContainer.userData.patternFrameCount = frameCount;
    } else {
      delete spiralContainer.userData.patternFrameCount;
    }
    data.arcgroups.forEach(group => {
      const mesh = createPolygonMesh(
        group.outline || [],
        group.ring_index,
        group.line_angle,
        group.pattern_frame,
      );
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

  let cameraRotation = { x: 0, y: 0 };
  let cameraDistance = 4;
  let autoRotationSpeed = rotationSpeed ? parseFloat(rotationSpeed.value) : 0.4;
  let pulseSpeed = pulseSpeedSlider ? parseFloat(pulseSpeedSlider.value) : 1.0;
  let animationStart = performance.now();

  function updateMaterialsForRotation(rotationAngleDeg, timeSec) {
    if (!spiralContainer.children.length) {
      return;
    }
    const threshold = 20;
    const duration = 1 / Math.max(pulseSpeed, 0.0001);
    spiralContainer.children.forEach(mesh => {
      const lineAngle = mesh.userData.lineAngle || 0;
      const diff = Math.abs(((rotationAngleDeg - lineAngle + 450) % 180) - 90);
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
          mesh.material.emissive.setHex(0xffd700);
          mesh.material.emissiveIntensity = s * 0.8;
          mesh.material.metalness = (metalnessSlider ? parseFloat(metalnessSlider.value) : 0.4) + 0.1 * s;
        } else {
          mesh.userData.isPulsing = false;
          mesh.material.emissive.setHex(0x000000);
          mesh.material.emissiveIntensity = 0;
          mesh.material.metalness = metalnessSlider ? parseFloat(metalnessSlider.value) : 0.4;
        }
      }
      mesh.userData.wasInRange = isInRange;
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
