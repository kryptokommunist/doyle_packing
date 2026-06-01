/**
 * DXF export for Doyle Spiral outlines.
 *
 * Produces a DXF R2000 file with one LWPOLYLINE per arc group, with coordinates
 * in millimetres matching the bounding box the user configured.
 *
 * The engine works in an internal coordinate space where the spiral fits inside
 * a unit-ish radius.  scaleFactor converts from that space to SVG pixels.
 * We then divide by pixelsPerMm to reach mm.
 */

/**
 * @param {Map<string, ArcGroup>} arcGroups - from engine.arcGroups
 * @param {number} scaleFactor             - from the render result (SVG pixels per internal unit)
 * @param {number} canvasSizePx            - SVG canvas width/height in pixels
 * @param {number} boundingWidthMm         - desired output width in mm
 * @param {number} boundingHeightMm        - desired output height in mm
 * @returns {string} DXF file contents
 */
export function generateDXF(arcGroups, scaleFactor, canvasSizePx, boundingWidthMm, boundingHeightMm) {
  const pixelsPerMm = canvasSizePx / Math.max(boundingWidthMm, boundingHeightMm);
  const toMm = v => v * scaleFactor / pixelsPerMm;

  // DXF Y axis is up; SVG Y axis is down.  Flip Y so geometry isn't mirrored.
  const centerPx = canvasSizePx / 2;
  const centerMmX = boundingWidthMm / 2;
  const centerMmY = boundingHeightMm / 2;

  function ptToMm(re, im) {
    // internal → SVG pixel (origin at centre, Y down)
    const px = re * scaleFactor + centerPx;
    const py = im * scaleFactor + centerPx; // square canvas
    // SVG pixel → mm (flip Y so DXF is right-way-up)
    const x = (px / canvasSizePx) * boundingWidthMm;
    const y = ((canvasSizePx - py) / canvasSizePx) * boundingHeightMm;
    return { x, y };
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
  // LAYER table
  lines.push('  0', 'TABLE');
  lines.push('  2', 'LAYER');
  lines.push(' 70', '1');
  lines.push('  0', 'LAYER');
  lines.push('  2', 'SPIRALS');
  lines.push(' 70', '0');
  lines.push(' 62', '7'); // white
  lines.push('  6', 'Continuous');
  lines.push('  0', 'ENDTAB');
  lines.push('  0', 'ENDSEC');

  // ── ENTITIES ────────────────────────────────────────────────────────────
  lines.push('  0', 'SECTION');
  lines.push('  2', 'ENTITIES');

  let entityCount = 0;
  for (const [key, group] of arcGroups.entries()) {
    if (key.startsWith('outer_')) continue;

    const outline = group.getClosedOutline();
    if (!outline || outline.length < 2) continue;

    const pts = outline.map(pt => ptToMm(pt.re, pt.im));

    lines.push('  0', 'LWPOLYLINE');
    lines.push('  8', 'SPIRALS');     // layer
    lines.push(' 70', '1');           // closed flag
    lines.push(' 90', String(pts.length)); // vertex count

    for (const { x, y } of pts) {
      lines.push(' 10', x.toFixed(6));
      lines.push(' 20', y.toFixed(6));
    }
    entityCount++;
  }

  lines.push('  0', 'ENDSEC');
  lines.push('  0', 'EOF');

  return lines.join('\n');
}
