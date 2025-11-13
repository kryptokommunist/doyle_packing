import { renderSpiral, normaliseParams } from './doyle_spiral_engine.js';
import { createThreeViewer } from './three_viewer.js';

/**
 * Lightweight controller for the standalone 3D viewer page.
 */
class StandaloneSpiralViewer {
  constructor(elements) {
    this.statusEl = elements.statusEl;
    this.canvas = elements.canvas;
    this.controls = elements.controls || {};
    this.stats = elements.stats || {};
    this.params = StandaloneSpiralViewer.parseParamsFromURL();
    this.viewer = null;
  }

  /**
   * Read URL query parameters and convert them into valid spiral parameters.
   * @returns {ReturnType<typeof normaliseParams>}
   */
  static parseParamsFromURL() {
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

  /**
   * Update the viewer status message with the current parameter summary.
   */
  updateStatus() {
    if (!this.statusEl) {
      return;
    }
    const { p, q, t } = this.params;
    this.statusEl.textContent = `Generating geometry for p=${p}, q=${q}, t=${Number(t).toFixed(2)}…`;
    this.statusEl.classList.remove('error');
  }

  /**
   * Reload parameters from the URL and refresh the queued geometry.
   */
  reloadFromURL() {
    this.params = StandaloneSpiralViewer.parseParamsFromURL();
    this.updateStatus();
    if (this.viewer) {
      this.viewer.queueGeometryUpdate(this.params, true);
    }
  }

  /**
   * Build the Three.js viewer instance and kick off the initial render.
   */
  init() {
    try {
      this.viewer = createThreeViewer({
        canvas: this.canvas,
        statusElement: this.statusEl,
        stats: this.stats,
        controls: this.controls,
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
        getParams: () => ({ ...this.params }),
      });
    } catch (error) {
      console.error(error);
      this.showError('Unable to initialise the 3D viewer.');
      return;
    }

    if (!this.viewer) {
      this.showError('Unable to initialise the 3D viewer.');
      return;
    }

    this.updateStatus();
    this.viewer.queueGeometryUpdate(this.params, true);

    const reloadButton = this.controls.reloadButton;
    if (reloadButton) {
      reloadButton.addEventListener('click', () => this.reloadFromURL());
    }
  }

  /**
   * Render an error message in the UI.
   * @param {string} message
   */
  showError(message) {
    if (!this.statusEl) {
      return;
    }
    this.statusEl.textContent = message;
    this.statusEl.classList.add('error');
  }

  /**
   * Gather DOM references and create the viewer instance.
   * @returns {StandaloneSpiralViewer | null}
   */
  static bootstrap() {
    const statusEl = document.getElementById('statusMessage');
    const canvas = document.getElementById('canvas');
    if (!statusEl || !canvas) {
      return null;
    }

    const viewer = new StandaloneSpiralViewer({
      statusEl,
      canvas,
      stats: {
        container: document.getElementById('stats'),
        arcGroups: document.getElementById('statArcGroups'),
        polygons: document.getElementById('statPolygons'),
        parameters: document.getElementById('statParameters'),
      },
      controls: {
        rotationSpeed: document.getElementById('rotationSpeed'),
        rotationSpeedValue: document.getElementById('rotationSpeedValue'),
        manualRotation: document.getElementById('manualRotation'),
        manualRotationValue: document.getElementById('manualRotationValue'),
        pulseSpeed: document.getElementById('pulseSpeed'),
        pulseSpeedValue: document.getElementById('pulseSpeedValue'),
        metalness: document.getElementById('metalness'),
        metalnessValue: document.getElementById('metalnessValue'),
        roughness: document.getElementById('roughness'),
        roughnessValue: document.getElementById('roughnessValue'),
        reloadButton: document.getElementById('reloadGeometry'),
        loadJsonButton: document.getElementById('loadJson'),
        resetCameraButton: document.getElementById('resetCamera'),
        fileInput: document.getElementById('fileInput'),
      },
    });

    viewer.init();
    return viewer;
  }
}

StandaloneSpiralViewer.bootstrap();
