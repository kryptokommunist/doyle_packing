/**
 * Breakdown export utilities — pure functions with no DOM/browser dependencies.
 * Imported by app.js and directly testable by vitest.
 */

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
 * Without pattern fill: rings are rotationally symmetric, so one file per ring
 * but the number of physical pieces equals the number of arc groups in that ring.
 * With pattern fill: each arc group is a unique file (different fill angle), so
 * count is the number of arc groups across all fitting rings.
 * Beyond-box rings: always one physical piece per arc group.
 *
 * @param {Map<string, {ringIndex: number|null, getClosedOutline: () => Array}>} arcGroups
 * @param {Array<{ringIndex: number}>} fittingRings
 * @param {boolean} withPattern
 * @returns {number}
 */
export function countWorkpieces(arcGroups, fittingRings, withPattern) {
  const fittingIndices = new Set(fittingRings.map(r => r.ringIndex));
  let count = 0;

  if (withPattern) {
    // One file per arc group in fitting rings (unique angle per group)
    for (const [key, group] of arcGroups.entries()) {
      if (!key.startsWith('circle_')) continue;
      const r = group.ringIndex;
      if (r === null || r === undefined || r < 0) continue;
      if (!fittingIndices.has(r)) continue;
      const outline = group.getClosedOutline();
      if (!outline || outline.length < 2) continue;
      count++;
    }
  } else {
    // Symmetric: count arc groups per ring (how many physical copies are cut)
    for (const { ringIndex } of fittingRings) {
      let groupCountInRing = 0;
      for (const [key, group] of arcGroups.entries()) {
        if (key.startsWith('circle_') && group.ringIndex === ringIndex) groupCountInRing++;
      }
      count += groupCountInRing || 1;
    }
  }

  // Beyond-box rings: one physical piece per arc group
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
 * Generates a standalone SVG string for a single arc group outline.
 * Outline is centred in the workpiece box.
 *
 * @param {Array<{re: number, im: number}>} outline
 * @param {Array<Array<{re: number, im: number}>>} highlightPaths
 * @param {number} scaleFactor
 * @param {number} workpieceWmm
 * @param {number} workpieceHmm
 * @param {Array<{p1: {re,im}, p2: {re,im}}>} patternLines
 * @returns {string}
 */
export function generateBreakdownSVG(outline, highlightPaths, scaleFactor, workpieceWmm, workpieceHmm, patternLines) {
  const pts = outline.map(pt => ({
    x: pt.re * scaleFactor + workpieceWmm / 2,
    y: -(pt.im * scaleFactor) + workpieceHmm / 2,
  }));
  const d = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(4)},${p.y.toFixed(4)}`).join(' ') + ' Z';

  let svgContent = `<path d="${d}" fill="none" stroke="black" stroke-width="0.2"/>`;

  if (Array.isArray(highlightPaths) && highlightPaths.length > 0) {
    for (const path of highlightPaths) {
      if (!path || path.length < 2) continue;
      const hPts = path.map(pt => ({
        x: pt.re * scaleFactor + workpieceWmm / 2,
        y: -(pt.im * scaleFactor) + workpieceHmm / 2,
      }));
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
