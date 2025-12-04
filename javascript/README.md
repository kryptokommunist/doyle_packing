# Doyle Spiral JavaScript demo

This folder contains the standalone `index.html` used to explore and export Doyle spirals in the browser.

## Running the page

1. Serve the `javascript` folder with any static file server (for example `python -m http.server 8000` from the repository root).
2. Open `http://localhost:8000/javascript/index.html` in a modern browser.
3. Adjust the parameters in the left panel to render the spiral preview. The preview automatically refreshes as you change values.
4. Switch to the 3D view to load the Three.js preview. Use the on-page controls to tweak rotation, materials, and camera resets.

> Tip: The render uses a background line pattern for fast on-screen previews. The exported SVG still contains individual lines for precise editing.

## Exporting SVGs

1. After configuring the spiral, enter a filename in the "SVG file name" field.
2. Click **Download SVG** to generate a full-detail SVG with separate stroke segments.
3. The download uses the same parameters shown in the preview, but regenerates the output with detailed line strokes for editing or laser-cutting workflows.

## Files

- `index.html` – UI shell and controls for configuring renders.
- `js/` – rendering logic, including the Arram–Boyle spiral engine, worker, and Three.js viewer helpers.
- `perf_measure.mjs` – optional performance profiling helper.
