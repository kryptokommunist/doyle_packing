import { renderSpiral, normaliseParams } from './doyle_spiral_engine.js';
import { createThreeViewer } from './three_viewer.js';

const statusMessage = document.getElementById('statusMessage');
const canvas = document.getElementById('canvas');
const rotationSpeed = document.getElementById('rotationSpeed');
const rotationSpeedValue = document.getElementById('rotationSpeedValue');
const pulseSpeed = document.getElementById('pulseSpeed');
const pulseSpeedValue = document.getElementById('pulseSpeedValue');
const metalness = document.getElementById('metalness');
const metalnessValue = document.getElementById('metalnessValue');
const roughness = document.getElementById('roughness');
const roughnessValue = document.getElementById('roughnessValue');
const manualRotation = document.getElementById('manualRotation');
const manualRotationValue = document.getElementById('manualRotationValue');
const animationMode = document.getElementById('animationMode');
const reloadButton = document.getElementById('reloadGeometry');
const loadJsonButton = document.getElementById('loadJson');
const resetCameraButton = document.getElementById('resetCamera');
const statsContainer = document.getElementById('stats');
const statArcGroups = document.getElementById('statArcGroups');
const statPolygons = document.getElementById('statPolygons');
const statParameters = document.getElementById('statParameters');
const fileInput = document.getElementById('fileInput');

function parseParamsFromURL() {
  const defaults = {
    p: 16,
    q: 16,
    t: 0,
    mode: 'arram_boyle',
    arc_mode: 'closest',
    num_gaps: 2,
    max_d: 2000,
  };
  const search = new URLSearchParams(window.location.search);
  const raw = { ...defaults };
  for (const key of ['p', 'q', 't', 'arc_mode', 'num_gaps', 'max_d']) {
    if (search.has(key)) {
      raw[key] = search.get(key);
    }
  }
  return normaliseParams(raw);
}

let params = parseParamsFromURL();

const viewer = createThreeViewer({
  canvas,
  statusElement: statusMessage,
  stats: {
    container: statsContainer,
    arcGroups: statArcGroups,
    polygons: statPolygons,
    parameters: statParameters,
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
    animationModeSelect: animationMode,
    reloadButton,
    loadJsonButton,
    resetCameraButton,
    fileInput,
  },
  geometryFetcher: async currentParams => {
    const result = renderSpiral({ ...currentParams, mode: 'arram_boyle' }, 'arram_boyle');
    if (!result.geometry || !Array.isArray(result.geometry.arcgroups)) {
      throw new Error('Geometry generation failed');
    }
    return {
      geometry: result.geometry,
      label: `p=${currentParams.p}, q=${currentParams.q}, t=${Number(currentParams.t).toFixed(2)}`,
    };
  },
  getParams: () => ({ ...params }),
});

if (viewer) {
  statusMessage.textContent = `Generating geometry for p=${params.p}, q=${params.q}, t=${Number(params.t).toFixed(2)}…`;
  viewer.queueGeometryUpdate(params, true);

  if (reloadButton) {
    reloadButton.addEventListener('click', () => {
      params = parseParamsFromURL();
      statusMessage.textContent = `Generating geometry for p=${params.p}, q=${params.q}, t=${Number(params.t).toFixed(2)}…`;
      viewer.queueGeometryUpdate(params, true);
    });
  }
} else {
  statusMessage.textContent = 'Unable to initialise the 3D viewer.';
  statusMessage.classList.add('error');
}
