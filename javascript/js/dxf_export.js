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

function layerEntry(name, colorCode) {
  return ['  0', 'LAYER',
          '100', 'AcDbSymbolTableRecord',
          '100', 'AcDbLayerTableRecord',
          '  2', name,
          ' 70', '0',
          ' 62', String(colorCode),
          '  6', 'Continuous'];
}

function lwPolyline(pts, layer, closed) {
  const lines = ['  0', 'LWPOLYLINE',
                 '100', 'AcDbEntity',
                 '  8', layer,
                 '100', 'AcDbPolyline',
                 ' 90', String(pts.length),
                 ' 70', closed ? '1' : '0'];
  for (const { x, y } of pts) {
    lines.push(' 10', x.toFixed(6), ' 20', y.toFixed(6));
  }
  return lines;
}

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

  function ptToMm(re, im) {
    return {
      x: re * scaleFactor + boundingWidthMm / 2,
      y: -(im * scaleFactor) + boundingHeightMm / 2,
    };
  }

  const needSpirals = drawGroupOutline;
  const needHighlight = redOutline;

  let highlightPaths = [];
  if (needHighlight) {
    for (const [key, group] of arcGroups.entries()) {
      if (!key.startsWith('outer_')) continue;
      highlightPaths = highlightPaths.concat(buildContinuousPathsFromArcs(group.arcs));
    }

    const ringIndices = Array.from(arcGroups.values())
      .filter(g => g.ringIndex !== null && g.ringIndex !== undefined && g.ringIndex >= 0)
      .map(g => g.ringIndex);
    const maxIndex = ringIndices.length ? Math.max(...ringIndices) : null;
    if (maxIndex !== null) {
      for (const [key, group] of arcGroups.entries()) {
        if (!key.startsWith('circle_')) continue;
        if (group.ringIndex !== maxIndex) continue;
        const paths = buildContinuousPathsFromArcs(group.arcs.filter((_, i) => i === 2 || i === 3));
        highlightPaths = highlightPaths.concat(paths);
      }
    }
  }

  const lines = [];

  // ── HEADER ──────────────────────────────────────────────────────────────
  lines.push('  0', 'SECTION', '  2', 'HEADER');
  lines.push('  9', '$ACADVER', '  1', 'AC1015');
  lines.push('  9', '$INSUNITS', ' 70', '4');
  lines.push('  0', 'ENDSEC');

  // ── TABLES ──────────────────────────────────────────────────────────────
  const layerCount = (needSpirals ? 1 : 0) + (needHighlight ? 1 : 0);
  lines.push('  0', 'SECTION', '  2', 'TABLES');
  lines.push('  0', 'TABLE', '  2', 'LAYER', '100', 'AcDbSymbolTable', ' 70', String(layerCount));
  if (needSpirals) lines.push(...layerEntry('SPIRALS', 7));
  if (needHighlight) lines.push(...layerEntry('HIGHLIGHT', 1));
  lines.push('  0', 'ENDTAB', '  0', 'ENDSEC');

  // ── ENTITIES ────────────────────────────────────────────────────────────
  lines.push('  0', 'SECTION', '  2', 'ENTITIES');

  if (needSpirals) {
    for (const [key, group] of arcGroups.entries()) {
      if (key.startsWith('outer_')) continue;
      const outline = group.getClosedOutline();
      if (!outline || outline.length < 2) continue;
      lines.push(...lwPolyline(outline.map(pt => ptToMm(pt.re, pt.im)), 'SPIRALS', true));
    }
  }

  if (needHighlight) {
    for (const path of highlightPaths) {
      if (!path || path.length < 2) continue;
      const pts = path.map(pt => ptToMm(pt.re, pt.im));
      const closed = Math.abs(pts[0].x - pts[pts.length - 1].x) < 1e-4
                  && Math.abs(pts[0].y - pts[pts.length - 1].y) < 1e-4;
      lines.push(...lwPolyline(pts, 'HIGHLIGHT', closed));
    }
  }

  lines.push('  0', 'ENDSEC', '  0', 'EOF');
  return lines.join('\n');
}

/**
 * Generates a DXF R2000 file for a single arc group outline (breakdown export).
 *
 * @param {Array<Array<{re: number, im: number}>>} outlines  - closed outlines in internal units (empty = no SPIRALS layer)
 * @param {Array<Array<{re: number, im: number}>>} highlightPaths - rim paths (empty = no HIGHLIGHT layer)
 * @param {number} scaleFactor   - mm per internal unit
 * @param {number} workpieceWmm  - workpiece width in mm
 * @param {number} workpieceHmm  - workpiece height in mm
 * @returns {string} DXF file contents
 */
export function generateSingleGroupDXF(outlines, highlightPaths, scaleFactor, workpieceWmm, workpieceHmm) {
  function ptToMm(re, im) {
    return {
      x: re * scaleFactor + workpieceWmm / 2,
      y: -(im * scaleFactor) + workpieceHmm / 2,
    };
  }

  const normalisedOutlines = outlines.length > 0
    ? (Array.isArray(outlines[0]) ? outlines : [outlines])
    : [];
  const hasSpirals = normalisedOutlines.length > 0;
  const hasHighlight = Array.isArray(highlightPaths) && highlightPaths.length > 0;
  const layerCount = (hasSpirals ? 1 : 0) + (hasHighlight ? 1 : 0);

  const lines = [];

  lines.push('  0', 'SECTION', '  2', 'HEADER');
  lines.push('  9', '$ACADVER', '  1', 'AC1015');
  lines.push('  9', '$INSUNITS', ' 70', '4');
  lines.push('  0', 'ENDSEC');

  lines.push('  0', 'SECTION', '  2', 'TABLES');
  lines.push('  0', 'TABLE', '  2', 'LAYER', '100', 'AcDbSymbolTable', ' 70', String(layerCount));
  if (hasSpirals) lines.push(...layerEntry('SPIRALS', 7));
  if (hasHighlight) lines.push(...layerEntry('HIGHLIGHT', 1));
  lines.push('  0', 'ENDTAB', '  0', 'ENDSEC');

  lines.push('  0', 'SECTION', '  2', 'ENTITIES');

  for (const outline of normalisedOutlines) {
    const pts = outline.map(pt => ptToMm(pt.re, pt.im));
    lines.push(...lwPolyline(pts, 'SPIRALS', true));
  }

  if (hasHighlight) {
    for (const path of highlightPaths) {
      if (!path || path.length < 2) continue;
      const hPts = path.map(pt => ptToMm(pt.re, pt.im));
      const closed = Math.abs(hPts[0].x - hPts[hPts.length - 1].x) < 1e-4
                  && Math.abs(hPts[0].y - hPts[hPts.length - 1].y) < 1e-4;
      lines.push(...lwPolyline(hPts, 'HIGHLIGHT', closed));
    }
  }

  lines.push('  0', 'ENDSEC', '  0', 'EOF');
  return lines.join('\n');
}
