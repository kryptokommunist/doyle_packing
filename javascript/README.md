# Doyle Spiral Studio (JavaScript)

This folder contains the browser-based Doyle spiral viewer. The main entry point is `index.html`, which provides both the SVG preview and the interactive 3D view.

## Running the page locally

1. From the repository root, change into the `javascript` directory:
   ```bash
   cd javascript
   ```
2. Start a simple local server (needed because the page loads ES modules):
   ```bash
   python -m http.server 8000
   ```
3. Open http://localhost:8000 in your browser and select `index.html`.

You can also use any other static file server; the important part is that the files are served over HTTP so the module imports are allowed.

## Using the interface

- Adjust parameters in the **Spiral parameters** and **Fill pattern** panels and the preview updates automatically.
- Toggle between the **2D** and **3D** views with the buttons above the preview area.
- Use **Download SVG** to export the current spiral; the exported file renders each fill line individually, while the on-page preview uses a lighter pattern fill for faster updates.
- The **Advanced settings** panel lets you tune render timeouts and stroke widths. Use the **3D settings** toggle inside the 3D view to expose material and animation controls.

## Performance tips

- Leave the lightweight pattern preview enabled for quicker on-page renders; exporting automatically regenerates a full-detail SVG.
- Reduce `Canvas size` or `Number of gaps` if renders take too long, or increase the timeout under **Advanced settings**.
