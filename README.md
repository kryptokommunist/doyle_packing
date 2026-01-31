# Doyle Spiral Studio

A generative art tool to compute [Doyle spirals](https://en.wikipedia.org/wiki/Doyle_spiral) and export patterns as SVGs for fabrication with a fiber laser. The software animates geometric textures on a rotating disk, then translates the animations into physical pieces through engraving angled line patterns. The surface reflection sequences can be changed based on the angle of the engraved line pattern, similar to a [zoetrope](https://en.wikipedia.org/wiki/Zoetrope).

**[Read the full project write-up](https://kryptokommun.ist/portfolio/projects/tech/2025/11/01/doyle-packing.html)**

## Features

- **3D visualization:** Interactive Three.js view to inspect the animation path before etching
- **Parameter controls:** Tweak spiral parameters (p, q, arc modes, gaps, fill spacing, offsets, outlines) with immediate SVG preview
- **High-resolution SVG export:** Generate production-ready files for laser engraving
- **Animated preview:** See how the pattern will appear when the disk rotates

## Getting started

Open `javascript/index.html` directly in a modern browser or serve the `javascript/` folder with any static file server. No bundling is required; all dependencies are pulled from CDNs.

## Technical details

- **Bounding box:** The spiral is scaled so the outermost petal tips align with the viewport boundary, using outer circle centers to define the bounding diameter
- **SVG export:** Exported SVGs contain fully expanded elements for maximum compatibility with laser software

## Experiments

- Tested both steel etching and wood lasering; steel is more promising for crisp contrast and durability
- Ongoing tuning of fabrication settings to make animated motion clearly visible in etched results
- Planned animation UI driven by cellular automata rules to vary parameters over time

## Project layout

- `javascript/` — Standalone Three.js UI for designing, tuning, and previewing the reflective spiral animation
- `templates/` — Flask-rendered HTML that parallels the static JavaScript experience
- `python/` and `src/` — Supporting Python utilities for spiral math and optional server rendering
- `app.py` — Minimal Flask app for API-driven workflows

## Acknowledgements

Thanks to [Arram Sabeti](https://arr.am) for coming up with the idea originally. I encountered his art on [Twitter](https://x.com/arram/status/1438541186319282178).
