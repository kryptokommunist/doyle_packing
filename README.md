# Doyle Spiral Laser Pattern Studio

Design and preview light-reflective patterns that can be etched onto metal surfaces with a fibo laser so a rotating object reveals an animation in motion. The project leans on the property that properly angled lines reflect light back to the viewer at the right moment, creating the illusion of movement when the piece spins.

## JavaScript-first workflow
- **3D visualization:** The `javascript/index.html` experience uses Three.js to render Doyle spirals and their fill patterns in an interactive 3D view so you can inspect the animation path before etching.
- **Parameter controls:** Front-end controls let you tweak spiral parameters (p, q, arc modes, gaps, fill spacing, offsets, outlines, and more) and immediately see the updated SVG and geometry.
- **Performance hooks:** The `javascript/js` and `javascript/perf_measure.mjs` modules provide the rendering and timing utilities that drive the preview experience without extra build steps.
- **Running the UI:** Open `javascript/index.html` directly in a modern browser or serve the `javascript/` folder with any static file server to try the designer. No bundling is required; all dependencies are pulled from CDNs.

## Python services (briefly)
A minimal Flask app in `app.py` mirrors the same spiral generation logic server-side. You can start it with `python app.py` if you prefer an API-driven workflow, but the primary interaction model is the JavaScript UI described above.

## Project layout
- `javascript/` — Standalone Three.js UI for designing, tuning, and previewing the reflective spiral animation.
- `templates/` — Flask-rendered HTML that parallels the static JavaScript experience.
- `python/` and `src/` — Supporting Python utilities for spiral math and optional server rendering.

## Contributing
Feel free to adjust the JavaScript controls, improve the 3D presentation, or add presets that optimize reflections for your specific fibo laser and material. Keep changes focused on enhancing the design-to-etch loop.
