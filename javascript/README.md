# Doyle Packing JavaScript Studio

This directory contains the browser-based tooling for exploring Doyle spirals in
both 2D (SVG) and 3D (Three.js). The code mirrors the Python implementation in
`src/` and provides a fully client-side experience for rendering, exporting, and
inspecting spiral geometry.

## Project layout

- `index.html` – landing page for the interactive studio that combines the 2D
  renderer with an optional Three.js viewer.
- `js/` – JavaScript modules shared by the studio and the standalone viewer.
  - `app.js` orchestrates the user interface for the studio.
  - `doyle_spiral_engine.js` ports the Doyle spiral engine to the browser.
  - `render_worker.js` enables off-main-thread rendering when Web Workers are
    available.
  - `three_viewer.js` defines the reusable Three.js viewer.
  - `viewer.js` drives the standalone 3D viewer page.
- `perf_measure.mjs` – Node.js script for profiling the renderer.

## Running the studio locally

1. From the project root start a simple HTTP server so that module imports work
   correctly in the browser:

   ```bash
   python -m http.server 8000
   ```

2. Visit [http://localhost:8000/javascript/index.html](http://localhost:8000/javascript/index.html)
   to launch the studio.

The interface automatically renders a spiral using the default parameters and
updates the result whenever you tweak any of the controls. Switching to the 3D
view will initialise the Three.js viewer and reuse the same parameters to build
geometry.

## Standalone Three.js viewer

The `js/viewer.js` module exposes the same viewer logic without the surrounding
2D UI. You can wire it up by creating a minimal HTML shell that imports the
module and provides the expected DOM structure. The viewer reads parameters from
the URL query string so you can share specific configurations simply by
adjusting the URL, e.g. `?p=24&q=24&t=0.35`.

## Profiling performance

`perf_measure.mjs` can be executed under Node.js to capture timing data for the
Arram–Boyle renderer. The script measures both the plain and pattern-filled SVG
modes while collecting phase-level statistics:

```bash
node javascript/perf_measure.mjs
```

All instrumentation lives in the script itself, so you can extend the measured
cases or inspect additional methods without touching the rendering engine.

## Design notes

- The UI controllers (`app.js` and `viewer.js`) now use small classes to group
  related behaviour, which keeps state management contained and clarifies the
  lifecycle of event listeners.
- `three_viewer.js` remains framework-agnostic and reusable; both controllers
  depend on it for Three.js integration.
- Documentation comments throughout the modules explain the intent of key
  methods and can be surfaced by editors with JSDoc support.

