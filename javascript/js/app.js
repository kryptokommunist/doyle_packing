import { renderSpiral, normaliseParams } from './doyle_spiral_engine.js';
import { createThreeViewer } from './three_viewer.js';

const DEFAULTS = {
  p: 16,
  q: 16,
  t: 0,
  mode: 'arram_boyle',
  arc_mode: 'closest',
  num_gaps: 2,
  size: 800,
  bounding_box_width_mm: 200,
  bounding_box_height_mm: 200,
  add_fill_pattern: false,
  draw_group_outline: true,
  red_outline: false,
  fill_pattern_spacing: 8,
  fill_pattern_angle: 0,
  fill_pattern_offset: 0,
  fill_pattern_type: 'lines',
  fill_pattern_rect_width: 2,
  fill_pattern_animation: 'radial_bloom',
  highlight_rim_width: 1.2,
  group_outline_width: 0.6,
  pattern_stroke_width: 0.5,
};

const WORKER_SUPPORTED = typeof Worker !== 'undefined';
const RENDER_WORKER_URL = WORKER_SUPPORTED ? new URL('./render_worker.js', import.meta.url) : null;
const SVG_PARSER = typeof DOMParser !== 'undefined' ? new DOMParser() : null;

/**
 * Return a debounced wrapper that delays invoking `fn` until `delay` has elapsed.
 * @param {Function} fn
 * @param {number} delay
 * @returns {Function}
 */
function debounce(fn, delay) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

/**
 * Controller responsible for coordinating the 2D/3D spiral studio UI.
 */
class SpiralRendererApp {
  constructor(elements) {
    this.form = elements.form;
    this.statusEl = elements.statusEl;
    this.svgPreview = elements.svgPreview;
    this.statsBlock = elements.statsBlock;
    this.statArcGroups = elements.statArcGroups;
    this.statPolygons = elements.statPolygons;
    this.statMode = elements.statMode;
    this.tRange = elements.tRange;
    this.tValue = elements.tValue;
    this.fillToggle = elements.fillToggle;
    this.fillSettings = elements.fillSettings;
    this.fillPatternTypeSelect = elements.fillPatternTypeSelect;
    this.fillRectWidthGroup = elements.fillRectWidthGroup;
    this.outlineToggle = elements.outlineToggle;
    this.redToggle = elements.redToggle;
    this.viewButtons = elements.viewButtons || [];
    this.view2d = elements.view2d;
    this.view3d = elements.view3d;
    this.threeStatus = elements.threeStatus;
    this.threeSettingsToggle = elements.threeSettingsToggle;
    this.threeStage = elements.threeStage;
    this.threeStats = elements.threeStats;
    this.fileInput = elements.fileInput;
    this.exportButton = elements.exportButton;
    this.exportFilenameInput = elements.exportFilenameInput;
    this.defaults = { ...DEFAULTS };

    this.activeView = '2d';
    this.lastRender = null;
    this.threeApp = null;
    this.renderWorkerHandle = null;
    this.currentRenderToken = 0;
    this.debouncedRender = debounce(() => this.renderCurrentSpiral(false), 200);
  }

  /**
   * Initialise the UI handlers and trigger the first render.
   */
  init() {
    if (!this.form) {
      console.warn('Unable to bootstrap spiral controls – form not found.');
      return;
    }
    this.attachEventListeners();
    this.updateExportAvailability(false);
    this.toggleFillSettings();
    this.updateTValue();
    this.renderCurrentSpiral(true);
  }

  /**
   * Attach DOM event listeners for form controls and view toggles.
   */
  attachEventListeners() {
    this.form.addEventListener('input', event => {
      if (event.target?.name === 't') {
        this.updateTValue();
      }
      if (event.target === this.fillToggle) {
        this.toggleFillSettings();
      }
      if (event.target === this.fillPatternTypeSelect) {
        this.updatePatternTypeVisibility();
      }
      this.debouncedRender();
      if (this.threeApp) {
        this.threeApp.queueGeometryUpdate(this.collectParams());
      }
    });

    this.form.addEventListener('submit', event => {
      event.preventDefault();
      this.renderCurrentSpiral(true);
      if (this.threeApp) {
        this.threeApp.queueGeometryUpdate(this.collectParams(), true);
      }
    });

    this.viewButtons.forEach(button => {
      button.addEventListener('click', () => {
        const view = button.dataset.view;
        if (view) {
          this.switchView(view);
        }
      });
    });

    if (this.threeSettingsToggle) {
      this.threeSettingsToggle.addEventListener('click', () => {
        const collapsed = this.threeStage
          ? this.threeStage.classList.toggle('collapsed')
          : this.threeSettingsToggle.classList.contains('collapsed');
        this.threeSettingsToggle.textContent = collapsed ? 'Show 3D settings' : 'Hide 3D settings';
        this.threeSettingsToggle.setAttribute('aria-expanded', String(!collapsed));
      });
    }

    if (this.exportButton) {
      this.exportButton.addEventListener('click', () => this.downloadCurrentSvg());
    }

    if (this.fillPatternTypeSelect) {
      this.fillPatternTypeSelect.addEventListener('change', () => this.updatePatternTypeVisibility());
    }
  }

  /**
   * Collect the current form parameters and normalise them for the engine.
   * @returns {ReturnType<typeof normaliseParams>}
   */
  collectParams() {
    const formData = new FormData(this.form);
    const raw = { ...this.defaults };
    for (const [key, value] of formData.entries()) {
      raw[key] = value;
    }
    raw.add_fill_pattern = this.fillToggle?.checked ?? raw.add_fill_pattern;
    raw.draw_group_outline = this.outlineToggle?.checked ?? raw.draw_group_outline;
    raw.red_outline = this.redToggle?.checked ?? raw.red_outline;
    const params = normaliseParams(raw);
    params.mode = raw.mode || params.mode;
    return params;
  }

  /**
   * Update the textual representation of the tilt slider value.
   */
  updateTValue() {
    if (this.tValue && this.tRange) {
      this.tValue.textContent = parseFloat(this.tRange.value).toFixed(2);
    }
  }

  /**
   * Show or hide the fill pattern options depending on the toggle state.
   */
  toggleFillSettings() {
    if (!this.fillSettings || !this.fillToggle) {
      return;
    }
    this.fillSettings.hidden = !this.fillToggle.checked;
    this.updatePatternTypeVisibility();
  }

  /**
   * Hide rectangle-specific controls unless the rectangle pattern is selected.
   */
  updatePatternTypeVisibility() {
    if (!this.fillPatternTypeSelect || !this.fillRectWidthGroup) {
      return;
    }
    const showRectangles = this.fillPatternTypeSelect.value === 'rectangles';
    this.fillRectWidthGroup.hidden = !showRectangles;
  }

  /**
   * Update the status banner with the provided message and visual state.
   * @param {string} message
   * @param {'idle'|'loading'|'error'} [state='idle']
   */
  setStatus(message, state = 'idle') {
    if (!this.statusEl) {
      return;
    }
    this.statusEl.textContent = message;
    this.statusEl.classList.remove('loading', 'error');
    if (state !== 'idle') {
      this.statusEl.classList.add(state);
    }
  }

  /**
   * Enable or disable the export button depending on render availability.
   * @param {boolean} available
   */
  updateExportAvailability(available) {
    if (this.exportButton) {
      this.exportButton.disabled = !available;
    }
  }

  /**
   * Switch between 2D and 3D presentation modes.
   * @param {'2d'|'3d'} view
   */
  switchView(view) {
    if (view === this.activeView) {
      return;
    }
    this.activeView = view;
    this.viewButtons.forEach(button => {
      const isActive = button.dataset.view === view;
      button.classList.toggle('active', isActive);
      button.setAttribute('aria-pressed', String(isActive));
    });

    const show3d = view === '3d';
    if (this.view2d) {
      this.view2d.hidden = show3d;
    }
    if (this.view3d) {
      this.view3d.hidden = !show3d;
    }
    this.updateStats(this.lastRender ? this.lastRender.geometry : null);

    if (!show3d) {
      return;
    }
    this.pulseSettingsButton();
    const app = this.ensureThreeApp();
    if (!app) {
      return;
    }
    const params = this.collectParams();
    if (this.lastRender && this.hasGeometry(this.lastRender.geometry)) {
      app.useGeometryFromPayload(params, this.lastRender.geometry);
    } else {
      app.queueGeometryUpdate(params, true);
    }
  }

  /**
   * Briefly animate the 3D settings toggle button to draw attention.
   */
  pulseSettingsButton() {
    if (!this.threeSettingsToggle) {
      return;
    }
    this.threeSettingsToggle.classList.remove('pulse');
    void this.threeSettingsToggle.offsetWidth;
    this.threeSettingsToggle.classList.add('pulse');
    setTimeout(() => this.threeSettingsToggle.classList.remove('pulse'), 1200);
  }

  /**
   * Ensure that a Three.js viewer has been created for 3D exploration.
   * @returns {ReturnType<typeof createThreeViewer>|null}
   */
  ensureThreeApp() {
    if (this.threeApp) {
      return this.threeApp;
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

    this.threeApp = createThreeViewer({
      canvas,
      statusElement: this.threeStatus,
      stats: {
        container: this.threeStats,
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
        fileInput: this.fileInput,
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
      getParams: () => this.collectParams(),
    });
    return this.threeApp;
  }

  /**
   * Determine whether the supplied geometry payload contains arc group data.
   * @param {unknown} geometry
   * @returns {geometry is { arcgroups: Array }}
   */
  hasGeometry(geometry) {
    return Boolean(geometry && Array.isArray(geometry.arcgroups));
  }

  /**
   * Update the statistics display with the current geometry summary.
   * @param {{ arcgroups: Array<{ arc_count: number }> } | null} geometry
   */
  updateStats(geometry) {
    if (!this.statsBlock || !this.statArcGroups || !this.statPolygons) {
      return;
    }
    if (this.hasGeometry(geometry)) {
      const arcGroups = geometry.arcgroups.length;
      const polygons = geometry.arcgroups.reduce((sum, group) => sum + (group.arc_count || 0), 0);
      this.statArcGroups.textContent = String(arcGroups);
      this.statPolygons.textContent = String(polygons);
      this.statsBlock.hidden = false;
    } else {
      this.statsBlock.hidden = true;
    }
  }

  /**
   * Replace the preview area with a fresh SVG element.
   * @param {SVGElement} svgElement
   */
  showSVG(svgElement) {
    if (!this.svgPreview) {
      return;
    }
    svgElement.setAttribute('width', '100%');
    svgElement.setAttribute('height', '100%');
    svgElement.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    this.svgPreview.replaceChildren(svgElement);
    this.svgPreview.classList.remove('empty-state');
  }

  /**
   * Convert a render result into an SVG element for display.
   * @param {{ svg?: SVGElement, svgString?: string }} result
   * @returns {SVGElement | null}
   */
  materializeSvg(result) {
    if (result?.svg) {
      return result.svg;
    }
    if (!result?.svgString || !SVG_PARSER) {
      return null;
    }
    const doc = SVG_PARSER.parseFromString(result.svgString, 'image/svg+xml');
    const element = doc.documentElement;
    if (!element || element.nodeName.toLowerCase() !== 'svg') {
      return null;
    }
    return document.importNode(element, true);
  }

  /**
   * Persist the latest successful render and update the UI.
   * @param {object} result
   */
  handleRenderSuccess(result) {
    const svgElement = this.materializeSvg(result);
    if (!svgElement) {
      throw new Error('Renderer produced no SVG content');
    }

    this.showSVG(svgElement);

    const params = result.params || this.collectParams();
    const geometry = this.hasGeometry(result.geometry) ? result.geometry : null;
    const mode = result.mode || params?.mode || this.defaults.mode;
    const svgString = typeof result.svgString === 'string' && result.svgString.trim().length
      ? result.svgString
      : new XMLSerializer().serializeToString(svgElement);

    this.lastRender = { params, geometry, mode, svgString };

    this.updateStats(geometry);
    if (this.statMode) {
      this.statMode.textContent = mode === 'arram_boyle' ? 'Arram-Boyle' : 'Classic Doyle';
    }
    this.setStatus('Spiral updated. Switch views to explore it in 3D.');
    this.updateExportAvailability(true);

    if (!this.threeApp) {
      return;
    }
    if (geometry) {
      this.threeApp.useGeometryFromPayload(params, geometry);
    } else {
      this.threeApp.queueGeometryUpdate(params, true);
    }
  }

  /**
   * Display an error message when rendering fails.
   * @param {string} [message]
   */
  handleRenderFailure(message) {
    if (this.svgPreview) {
      this.svgPreview.innerHTML = '<div class="empty-state">Unable to render spiral.</div>';
      this.svgPreview.classList.add('empty-state');
    }
    this.setStatus(message || 'Unexpected error', 'error');
    this.lastRender = null;
    this.updateExportAvailability(false);
  }

  /**
   * Abort and clean up the active worker, if any.
   */
  terminateRenderWorker() {
    if (this.renderWorkerHandle) {
      this.renderWorkerHandle.terminate();
      this.renderWorkerHandle = null;
    }
  }

  /**
   * Run the spiral engine either in a worker or on the main thread.
   * @param {object} params
   * @param {boolean} showLoading
   */
  startRenderJob(params, showLoading) {
    const token = ++this.currentRenderToken;
    const statusMessage = showLoading ? 'Rendering spiral…' : 'Updating spiral…';
    this.setStatus(statusMessage, 'loading');

    if (WORKER_SUPPORTED && RENDER_WORKER_URL && SVG_PARSER) {
      this.terminateRenderWorker();
      const worker = new Worker(RENDER_WORKER_URL, { type: 'module' });
      this.renderWorkerHandle = worker;

      worker.onmessage = event => {
        const data = event.data || {};
        if (data.requestId !== token) {
          return;
        }
        if (this.renderWorkerHandle === worker) {
          worker.terminate();
          this.renderWorkerHandle = null;
        }
        if (data.type === 'result') {
          try {
            this.handleRenderSuccess(data);
          } catch (error) {
            console.error(error);
            this.handleRenderFailure(error.message || 'Unexpected error');
          }
        } else if (data.type === 'error') {
          const message = data.message || 'Render failed';
          console.error(message);
          this.handleRenderFailure(message);
        }
      };

      worker.onerror = event => {
        const message = event?.message || 'Render failed';
        if (this.renderWorkerHandle === worker) {
          worker.terminate();
          this.renderWorkerHandle = null;
        }
        console.error(event?.error || message);
        this.handleRenderFailure(message);
      };

      worker.postMessage({ type: 'render', requestId: token, params });
      return;
    }

    setTimeout(() => {
      try {
        const result = renderSpiral(params);
        this.handleRenderSuccess(result);
      } catch (error) {
        console.error(error);
        this.handleRenderFailure(error.message || 'Unexpected error');
      }
    }, 0);
  }

  /**
   * Trigger a render using the latest form parameters.
   * @param {boolean} [showLoading=true]
   */
  renderCurrentSpiral(showLoading = true) {
    const params = this.collectParams();
    this.startRenderJob(params, showLoading);
  }

  /**
   * Create a safe filename for SVG exports.
   * @returns {string}
   */
  getExportFileName() {
    const input = this.exportFilenameInput;
    if (!input) {
      return 'doyle-spiral.svg';
    }
    const raw = input.value.trim() || 'doyle-spiral';
    const safe = raw.replace(/[\\/:*?"<>|]+/g, '-') || 'doyle-spiral';
    return safe.toLowerCase().endsWith('.svg') ? safe : `${safe}.svg`;
  }

  /**
   * Download the most recent render as an SVG file.
   */
  downloadCurrentSvg() {
    if (!this.lastRender) {
      this.setStatus('Render the spiral before downloading.', 'error');
      return;
    }

    let svgContent = this.lastRender.svgString || '';
    if (!svgContent && this.svgPreview) {
      const svgElement = this.svgPreview.querySelector('svg');
      if (svgElement) {
        svgContent = new XMLSerializer().serializeToString(svgElement);
      }
    }

    if (!svgContent) {
      this.setStatus('Unable to access the rendered SVG for download.', 'error');
      return;
    }

    const blob = new Blob([svgContent], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const filename = this.getExportFileName();
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    this.setStatus(`SVG downloaded as ${filename}.`);
  }

  /**
   * Build an instance of the controller using elements queried from document.
   * @returns {SpiralRendererApp | null}
   */
  static bootstrap() {
    const elements = {
      form: document.getElementById('controlsForm'),
      statusEl: document.getElementById('statusMessage'),
      svgPreview: document.getElementById('svgPreview'),
      statsBlock: document.getElementById('stats'),
      statArcGroups: document.getElementById('statArcGroups'),
      statPolygons: document.getElementById('statPolygons'),
      statMode: document.getElementById('statMode'),
      tRange: document.getElementById('inputT'),
      tValue: document.getElementById('tValue'),
      fillToggle: document.getElementById('togglePattern'),
      fillSettings: document.getElementById('fillSettings'),
      fillPatternTypeSelect: document.getElementById('fillPatternType'),
      fillRectWidthGroup: document.getElementById('rectWidthGroup'),
      outlineToggle: document.getElementById('toggleOutline'),
      redToggle: document.getElementById('toggleRed'),
      viewButtons: Array.from(document.querySelectorAll('[data-view]')),
      view2d: document.getElementById('view2d'),
      view3d: document.getElementById('view3d'),
      threeStatus: document.getElementById('threeStatus'),
      threeSettingsToggle: document.getElementById('threeSettingsToggle'),
      threeStage: document.getElementById('threeStage'),
      threeStats: document.getElementById('threeStats'),
      fileInput: document.getElementById('threeFileInput'),
      exportButton: document.getElementById('exportSvgButton'),
      exportFilenameInput: document.getElementById('exportFilename'),
    };

    if (!elements.form || !elements.svgPreview) {
      return null;
    }

    const app = new SpiralRendererApp(elements);
    app.init();
    return app;
  }
}

SpiralRendererApp.bootstrap();
