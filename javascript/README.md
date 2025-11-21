# Doyle Packing JavaScript UI

This folder contains the browser-based Doyle spiral viewer located at `index.html`. Use it to interactively render 2D SVG spirals and explore a 3D extrusion preview.

## Running the page

1. Open `javascript/index.html` in a modern browser (no build step required).
2. Allow the page to load the default spiral; the preview appears in the "2D SVG" tab.

## Generating spirals

1. Adjust parameters in the **Controls** pane (e.g., `p`, `q`, `t`, pattern settings, outlines).
2. The preview updates automatically after changes; click **Render** to force an immediate refresh.
3. Toggle the **Add fill pattern** option to draw infill lines; previews use a single rotated line-fill background for faster interaction.
4. Switch between **2D SVG** and **3D** views with the buttons above the preview area.

## Downloading SVG output

1. Enter a file name in the **SVG file name** field.
2. Click **Download SVG**. The app re-renders the spiral with individual infill lines and saves it using the provided name.

## Tips

- Use the **Advanced** panel to adjust render timeout limits if generating dense spirals.
- The **3D** view can load `.json` geometry exported from the renderer or reuse the latest 2D parameters.
