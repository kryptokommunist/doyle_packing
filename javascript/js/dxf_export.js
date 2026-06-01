/**
 * DXF export for Doyle Spiral outlines.
 *
 * Produces a DXF R2000 file with one LWPOLYLINE per arc group, with coordinates
 * in millimetres matching the bounding box the user configured.
 *
 * The engine works in an internal coordinate space where the spiral fits inside
 * a unit-ish radius.  scaleFactor converts from that space to SVG pixels.
 * We then divide by pixelsPerMm to reach mm.
 *
 * Options mirror the SVG export toggles:
 *   drawGroupOutline  – export spiral outlines on layer SPIRALS
 *   redOutline        – export highlight rim arcs on layer HIGHLIGHT
 */

import { buildContinuousPathsFromArcs } from './doyle_spiral_engine.js';

/**
 * @param {Map<string, ArcGroup>} arcGroups - from engine.arcGroups
 * @param {number} scaleFactor             - from the render result (SVG pixels per internal unit)
 * @param {number} canvasSizePx            - SVG canvas width/height in pixels
 * @param {number} boundingWidthMm         - desired output width in mm
 * @param {number} boundingHeightMm        - desired output height in mm
 * @param {Object} [opts]
 * @param {boolean} [opts.drawGroupOutline=true]  - export spiral outlines
 * @param {boolean} [opts.redOutline=false]       - export highlight rim arcs
 * @returns {string} DXF file contents
 */
export function generateDXF(arcGroups, scaleFactor, canvasSizePx, boundingWidthMm, boundingHeightMm, opts = {}) {
  const drawGroupOutline = opts.drawGroupOutline !== false;
  const redOutline = Boolean(opts.redOutline);

  const pixelsPerMm = canvasSizePx / Math.max(boundingWidthMm, boundingHeightMm);

  // DXF Y axis is up; SVG Y axis is down.  Flip Y so geometry isn't mirrored.
  function ptToMm(re, im) {
    const px = re * scaleFactor + canvasSizePx / 2;
    const py = im * scaleFactor + canvasSizePx / 2; // square canvas
    const x = (px / canvasSizePx) * boundingWidthMm;
    const y = ((canvasSizePx - py) / canvasSizePx) * boundingHeightMm;
    return { x, y };
  }

  // Collect layers actually needed
  const needSpirals = drawGroupOutline;
  const needHighlight = redOutline;

  // Build highlight rim geometry: arcs at index 2 and 3 of the outermost ring group
  let highlightPaths = [];
  if (needHighlight) {
    const ringIndices = Array.from(arcGroups.values())
      .filter(g => g.ringIndex !== null && g.ringIndex !== undefined)
      .map(g => g.ringIndex);
    const maxIndex = ringIndices.length ? Math.max(...ringIndices) : null;
    if (maxIndex !== null) {
      for (const [key, group] of arcGroups.entries()) {
        if (!key.startsWith('circle_')) continue;
        if (group.ringIndex !== maxIndex) continue;
        const highlightArcs = group.arcs.filter((_, i) => i === 2 || i === 3);
        const paths = buildContinuousPathsFromArcs(highlightArcs);
        highlightPaths = highlightPaths.concat(paths);
      }
    }
  }

  const lines = [];

  // ── HEADER ──────────────────────────────────────────────────────────────
  lines.push('  0', 'SECTION');
  lines.push('  2', 'HEADER');
  lines.push('  9', '$ACADVER');
  lines.push('  1', 'AC1015'); // R2000
  lines.push('  9', '$INSUNITS');
  lines.push(' 70', '4');      // 4 = millimetres
  lines.push('  0', 'ENDSEC');

  // ── TABLES ──────────────────────────────────────────────────────────────
  lines.push('  0', 'SECTION');
  lines.push('  2', 'TABLES');
  lines.push('  0', 'TABLE');
  lines.push('  2', 'LAYER');
  const layerCount = (needSpirals ? 1 : 0) + (needHighlight ? 1 : 0);
  lines.push(' 70', String(layerCount));

  if (needSpirals) {
    lines.push('  0', 'LAYER');
    lines.push('  2', 'SPIRALS');
    lines.push(' 70', '0');
    lines.push(' 62', '7'); // white
    lines.push('  6', 'Continuous');
  }
  if (needHighlight) {
    lines.push('  0', 'LAYER');
    lines.push('  2', 'HIGHLIGHT');
    lines.push(' 70', '0');
    lines.push(' 62', '1'); // red
    lines.push('  6', 'Continuous');
  }

  lines.push('  0', 'ENDTAB');
  lines.push('  0', 'ENDSEC');

  // ── ENTITIES ────────────────────────────────────────────────────────────
  lines.push('  0', 'SECTION');
  lines.push('  2', 'ENTITIES');

  if (needSpirals) {
    for (const [key, group] of arcGroups.entries()) {
      if (key.startsWith('outer_')) continue;

      const outline = group.getClosedOutline();
      if (!outline || outline.length < 2) continue;

      const pts = outline.map(pt => ptToMm(pt.re, pt.im));

      lines.push('  0', 'LWPOLYLINE');
      lines.push('  8', 'SPIRALS');
      lines.push(' 70', '1');           // closed
      lines.push(' 90', String(pts.length));

      for (const { x, y } of pts) {
        lines.push(' 10', x.toFixed(6));
        lines.push(' 20', y.toFixed(6));
      }
    }
  }

  if (needHighlight) {
    for (const path of highlightPaths) {
      if (!path || path.length < 2) continue;
      const pts = path.map(pt => ptToMm(pt.re, pt.im));
      const isClosed = pts.length >= 2
        && Math.abs(pts[0].x - pts[pts.length - 1].x) < 1e-4
        && Math.abs(pts[0].y - pts[pts.length - 1].y) < 1e-4;

      lines.push('  0', 'LWPOLYLINE');
      lines.push('  8', 'HIGHLIGHT');
      lines.push(' 70', isClosed ? '1' : '0');
      lines.push(' 90', String(pts.length));

      for (const { x, y } of pts) {
        lines.push(' 10', x.toFixed(6));
        lines.push(' 20', y.toFixed(6));
      }
    }
  }

  lines.push('  0', 'ENDSEC');
  lines.push('  0', 'EOF');

  return lines.join('\n');
}
