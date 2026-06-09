/**
 * Breakdown export utilities — pure functions with no DOM/browser dependencies.
 * Imported by app.js and directly testable by vitest.
 */

/**
 * Translates an outline so its centroid is at (0, 0).
 * Used to centre overflow group outlines before placing them in a workpiece file.
 *
 * @param {Array<{re: number, im: number}>} outline
 * @returns {Array<{re: number, im: number}>}
 */
export function centreOutline(outline) {
  if (!outline || outline.length === 0) return outline;
  const cx = outline.reduce((s, p) => s + p.re, 0) / outline.length;
  const cy = outline.reduce((s, p) => s + p.im, 0) / outline.length;
  return outline.map(p => ({ re: p.re - cx, im: p.im - cy }));
}

/**
 * Returns the minimum workpiece box (in mm) required to fit any single arc group
 * outline of the outermost visible ring (highest circle_* ringIndex), when that
 * outline is centered in the workpiece box (as it is in the exported file).
 *
 * The relevant measure is the outline's own width/height (max - min per axis),
 * not its absolute position in the spiral coordinate system.
 *
 * Returns null if no circle_* groups exist.
 *
 * @param {Map<string, {ringIndex: number|null, getClosedOutline: () => Array}>} arcGroups
 * @param {number} scaleFactor  - mm per internal unit
 * @returns {{w: number, h: number}|null}
 */
export function getOuterBoundsRequired(arcGroups, scaleFactor) {
  // Find the highest ring index
  let maxRing = -Infinity;
  for (const [key, group] of arcGroups.entries()) {
    if (!key.startsWith('circle_')) continue;
    const r = group.ringIndex;
    if (r === null || r === undefined || r < 0) continue;
    if (r > maxRing) maxRing = r;
  }
  if (!Number.isFinite(maxRing) || maxRing < 0) return null;

  // Measure the max outline dimensions (width/height) across all arc groups of that ring.
  // Each group is exported centered, so the relevant size is (maxRe - minRe) × scaleFactor.
  let maxW = 0;
  let maxH = 0;
  let found = false;
  for (const [key, group] of arcGroups.entries()) {
    if (!key.startsWith('circle_') || group.ringIndex !== maxRing) continue;
    const outline = group.getClosedOutline();
    if (!outline || outline.length < 2) continue;
    found = true;
    let minRe = Infinity, maxRe = -Infinity;
    let minIm = Infinity, maxIm = -Infinity;
    for (const pt of outline) {
      if (pt.re < minRe) minRe = pt.re;
      if (pt.re > maxRe) maxRe = pt.re;
      if (pt.im < minIm) minIm = pt.im;
      if (pt.im > maxIm) maxIm = pt.im;
    }
    const w = (maxRe - minRe) * scaleFactor;
    const h = (maxIm - minIm) * scaleFactor;
    if (w > maxW) maxW = w;
    if (h > maxH) maxH = h;
  }

  if (!found) return null;
  return { w: maxW, h: maxH };
}

/**
 * Returns arc groups for each ring that fully fits inside the workpiece box,
 * stopping at the first ring whose outline intersects or exceeds the box.
 *
 * @param {Map<string, {ringIndex: number|null, getClosedOutline: () => Array}>} arcGroups
 * @param {number} scaleFactor  - mm per internal unit
 * @param {number} workpieceWmm
 * @param {number} workpieceHmm
 * @returns {Array<{ringIndex: number, group: object, outline: Array}>}
 */
export function getBreakdownRings(arcGroups, scaleFactor, workpieceWmm, workpieceHmm) {
  const halfW = workpieceWmm / 2;
  const halfH = workpieceHmm / 2;

  const ringReps = new Map();
  for (const [key, group] of arcGroups.entries()) {
    if (!key.startsWith('circle_')) continue;
    const r = group.ringIndex;
    if (r === null || r === undefined || r < 0) continue;
    if (!ringReps.has(r)) ringReps.set(r, group);
  }

  const sortedRings = Array.from(ringReps.keys()).sort((a, b) => a - b);
  const result = [];
  for (const r of sortedRings) {
    const group = ringReps.get(r);
    const outline = group.getClosedOutline();
    if (!outline || outline.length < 2) continue;
    const fits = outline.every(pt =>
      Math.abs(pt.re) * scaleFactor <= halfW &&
      Math.abs(pt.im) * scaleFactor <= halfH
    );
    if (!fits) break;
    result.push({ ringIndex: r, group, outline });
  }
  return result;
}

/**
 * Counts total physical workpieces for a breakdown export.
 *
 * All fitting rings are nested into one combined workpiece file = 1 workpiece.
 * Beyond-box rings: one physical workpiece per arc group.
 *
 * @param {Map<string, {ringIndex: number|null, getClosedOutline: () => Array}>} arcGroups
 * @param {Array<{ringIndex: number}>} fittingRings
 * @param {boolean} _withPattern  - reserved, does not affect count (same combined file)
 * @returns {number}
 */
export function countWorkpieces(arcGroups, fittingRings, _withPattern) {
  // Fitting rings are always one combined workpiece
  let count = fittingRings.length > 0 ? 1 : 0;

  // Beyond-box rings: one physical piece per arc group
  const fittingIndices = new Set(fittingRings.map(r => r.ringIndex));
  for (const [key, group] of arcGroups.entries()) {
    if (!key.startsWith('circle_')) continue;
    const r = group.ringIndex;
    if (r === null || r === undefined || r < 0) continue;
    if (fittingIndices.has(r)) continue;
    const outline = group.getClosedOutline();
    if (!outline || outline.length < 2) continue;
    count++;
  }

  return count;
}

/**
 * Generates a standalone SVG string for one or more arc group outlines.
 * All outlines are centred in the workpiece box.
 *
 * @param {Array<Array<{re: number, im: number}>>} outlines  - one or more closed outlines
 * @param {Array<Array<{re: number, im: number}>>} highlightPaths
 * @param {number} scaleFactor
 * @param {number} workpieceWmm
 * @param {number} workpieceHmm
 * @param {Array<{p1: {re,im}, p2: {re,im}}>} patternLines
 * @returns {string}
 */
export function generateBreakdownSVG(outlines, highlightPaths, scaleFactor, workpieceWmm, workpieceHmm, patternLines) {
  function toSvgPt(pt) {
    return {
      x: pt.re * scaleFactor + workpieceWmm / 2,
      y: -(pt.im * scaleFactor) + workpieceHmm / 2,
    };
  }

  const normalised = Array.isArray(outlines[0]) ? outlines : [outlines];
  let svgContent = normalised.map(outline => {
    const pts = outline.map(toSvgPt);
    const d = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(4)},${p.y.toFixed(4)}`).join(' ') + ' Z';
    return `<path d="${d}" fill="none" stroke="black" stroke-width="0.2"/>`;
  }).join('\n  ');

  if (Array.isArray(highlightPaths) && highlightPaths.length > 0) {
    for (const path of highlightPaths) {
      if (!path || path.length < 2) continue;
      const hPts = path.map(toSvgPt);
      const hd = hPts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(4)},${p.y.toFixed(4)}`).join(' ');
      svgContent += `\n  <path d="${hd}" fill="none" stroke="red" stroke-width="0.4"/>`;
    }
  }

  if (Array.isArray(patternLines) && patternLines.length > 0) {
    for (const seg of patternLines) {
      if (!seg || !seg.p1 || !seg.p2) continue;
      const x1 = (seg.p1.re * scaleFactor + workpieceWmm / 2).toFixed(4);
      const y1 = (-(seg.p1.im * scaleFactor) + workpieceHmm / 2).toFixed(4);
      const x2 = (seg.p2.re * scaleFactor + workpieceWmm / 2).toFixed(4);
      const y2 = (-(seg.p2.im * scaleFactor) + workpieceHmm / 2).toFixed(4);
      svgContent += `\n  <line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="black" stroke-width="0.1"/>`;
    }
  }

  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${workpieceWmm} ${workpieceHmm}" width="${workpieceWmm}mm" height="${workpieceHmm}mm">\n  ${svgContent}\n</svg>`;
}
