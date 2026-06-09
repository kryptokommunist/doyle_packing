/**
 * DXF export for Doyle Spiral outlines.
 *
 * Produces a DXF R2000 file with one LWPOLYLINE per arc group, with coordinates
 * in millimetres matching the bounding box the user configured.
 *
 * renderSpiral uses lengthUnits='mm', so scaleFactor is already mm/internal-unit
 * and the DrawingContext origin is at the centre of the bounding box.
 * We only need to shift to bottom-left origin and flip Y for DXF.
 *
 * Options mirror the SVG export toggles:
 *   drawGroupOutline  – export spiral outlines on layer SPIRALS
 *   redOutline        – export highlight rim arcs on layer HIGHLIGHT
 */

import { buildContinuousPathsFromArcs } from './doyle_spiral_engine.js';

/**
 * @param {Map<string, ArcGroup>} arcGroups    - from engine.arcGroups
 * @param {number} scaleFactor                 - mm per internal unit (from render result)
 * @param {number} boundingWidthMm             - output width in mm
 * @param {number} boundingHeightMm            - output height in mm
 * @param {Object} [opts]
 * @param {boolean} [opts.drawGroupOutline=true]  - export spiral outlines
 * @param {boolean} [opts.redOutline=false]       - export highlight rim arcs
 * @returns {string} DXF file contents
 */
export function generateDXF(arcGroups, scaleFactor, boundingWidthMm, boundingHeightMm, opts = {}) {
  const drawGroupOutline = opts.drawGroupOutline !== false;
  const redOutline = Boolean(opts.redOutline);

  // scaleFactor is mm/internal-unit; origin is at centre of bounding box.
  // DXF Y axis is up; SVG/internal Y axis is down — flip Y.
  // Shift origin from centre to bottom-left corner.
  function ptToMm(re, im) {
    return {
      x: re * scaleFactor + boundingWidthMm / 2,
      y: -(im * scaleFactor) + boundingHeightMm / 2,
    };
  }

  const needSpirals = drawGroupOutline;
  const needHighlight = redOutline;

  // Build highlight rim geometry — two sources, matching SVG _renderArramBoyle:
  // 1. outer_* groups: outer closure arcs (from _drawOuterClosureArcs)
  // 2. arcs at index 2 and 3 of the outermost circle_* ring group
  let highlightPaths = [];
  if (needHighlight) {
    for (const [key, group] of arcGroups.entries()) {
      if (!key.startsWith('outer_')) continue;
      const paths = buildContinuousPathsFromArcs(group.arcs);
      highlightPaths = highlightPaths.concat(paths);
    }

    const ringIndices = Array.from(arcGroups.values())
      .filter(g => g.ringIndex !== null && g.ringIndex !== undefined && g.ringIndex >= 0)
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

/**
 * Generates a DXF R2000 file for a single arc group outline (breakdown export).
 *
 * @param {Array<{re: number, im: number}>} outline   - closed outline points in internal units
 * @param {Array<Array<{re: number, im: number}>>} highlightPaths - optional rim paths (empty = no HIGHLIGHT layer)
 * @param {number} scaleFactor   - mm per internal unit
 * @param {number} workpieceWmm  - workpiece width in mm (used to centre the outline)
 * @param {number} workpieceHmm  - workpiece height in mm
 * @returns {string} DXF file contents
 */
export function generateSingleGroupDXF(outline, highlightPaths, scaleFactor, workpieceWmm, workpieceHmm) {
  function ptToMm(re, im) {
    return {
      x: re * scaleFactor + workpieceWmm / 2,
      y: -(im * scaleFactor) + workpieceHmm / 2,
    };
  }

  const hasHighlight = Array.isArray(highlightPaths) && highlightPaths.length > 0;
  const layerCount = hasHighlight ? 2 : 1;

  const lines = [];

  lines.push('  0', 'SECTION', '  2', 'HEADER');
  lines.push('  9', '$ACADVER', '  1', 'AC1015');
  lines.push('  9', '$INSUNITS', ' 70', '4');
  lines.push('  0', 'ENDSEC');

  lines.push('  0', 'SECTION', '  2', 'TABLES');
  lines.push('  0', 'TABLE', '  2', 'LAYER', ' 70', String(layerCount));
  lines.push('  0', 'LAYER', '  2', 'SPIRALS', ' 70', '0', ' 62', '7', '  6', 'Continuous');
  if (hasHighlight) {
    lines.push('  0', 'LAYER', '  2', 'HIGHLIGHT', ' 70', '0', ' 62', '1', '  6', 'Continuous');
  }
  lines.push('  0', 'ENDTAB', '  0', 'ENDSEC');

  lines.push('  0', 'SECTION', '  2', 'ENTITIES');

  const pts = outline.map(pt => ptToMm(pt.re, pt.im));
  lines.push('  0', 'LWPOLYLINE', '  8', 'SPIRALS', ' 70', '1', ' 90', String(pts.length));
  for (const { x, y } of pts) {
    lines.push(' 10', x.toFixed(6), ' 20', y.toFixed(6));
  }

  if (hasHighlight) {
    for (const path of highlightPaths) {
      if (!path || path.length < 2) continue;
      const hPts = path.map(pt => ptToMm(pt.re, pt.im));
      const isClosed = hPts.length >= 2
        && Math.abs(hPts[0].x - hPts[hPts.length - 1].x) < 1e-4
        && Math.abs(hPts[0].y - hPts[hPts.length - 1].y) < 1e-4;
      lines.push('  0', 'LWPOLYLINE', '  8', 'HIGHLIGHT',
        ' 70', isClosed ? '1' : '0', ' 90', String(hPts.length));
      for (const { x, y } of hPts) {
        lines.push(' 10', x.toFixed(6), ' 20', y.toFixed(6));
      }
    }
  }

  lines.push('  0', 'ENDSEC', '  0', 'EOF');
  return lines.join('\n');
}
