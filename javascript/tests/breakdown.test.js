import { describe, it, expect } from 'vitest';
import { getBreakdownRings, generateBreakdownSVG, countWorkpieces, getOuterBoundsRequired, centreOutline, getFittingGroups } from '../js/breakdown.js';
import { generateSingleGroupDXF } from '../js/dxf_export.js';
import { renderSpiral } from '../js/doyle_spiral_engine.js';

// Replicates the workpiece-file build logic from downloadBreakdownZip in app.js:
// overflow ring IDs are those NOT in fittingRings; workpiece gets every circle_* group
// whose ringIndex is NOT in overflowRingIds.
function buildWorkpieceSVG(arcGroups, scaleFactor, wpW, wpH) {
  const rings = getBreakdownRings(arcGroups, scaleFactor, wpW, wpH);
  const fittingIndices = new Set(rings.map(r => r.ringIndex));

  // overflow ring IDs = circle_* group IDs not in fitting set
  const overflowRingIds = new Set();
  for (const [key, g] of arcGroups.entries()) {
    if (!key.startsWith('circle_')) continue;
    if (g.ringIndex == null || g.ringIndex < 0) continue;
    if (!fittingIndices.has(g.ringIndex)) overflowRingIds.add(g.ringIndex);
  }

  const outlines = [];
  for (const [key, g] of arcGroups.entries()) {
    if (!key.startsWith('circle_')) continue;
    if (overflowRingIds.has(g.ringIndex)) continue;
    const o = g.getClosedOutline();
    if (o && o.length >= 2) outlines.push(o);
  }

  return { svg: generateBreakdownSVG(outlines, [], scaleFactor, wpW, wpH, []), outlines, overflowRingIds };
}

// Helper to build a mock arcGroups Map
function makeArcGroups(entries) {
  const map = new Map();
  for (const [key, ringIndex, outlinePoints] of entries) {
    map.set(key, {
      ringIndex,
      getClosedOutline: () => outlinePoints,
      arcs: [],
    });
  }
  return map;
}

// Square outline in internal units, centred at origin, half-size = size
function squareOutline(size) {
  return [
    { re: -size, im: -size },
    { re:  size, im: -size },
    { re:  size, im:  size },
    { re: -size, im:  size },
  ];
}

describe('getBreakdownRings', () => {
  it('includes rings whose outlines fully fit within the workpiece box', () => {
    const arcGroups = makeArcGroups([
      ['circle_0', 0, squareOutline(10)],  // 10 internal units → 10mm with scale=1
      ['circle_1', 1, squareOutline(30)],  // 30mm — fits in 80mm box
      ['circle_2', 2, squareOutline(60)],  // 60mm — exceeds 80mm box (half=40)
    ]);
    const rings = getBreakdownRings(arcGroups, 1, 80, 80);
    expect(rings.map(r => r.ringIndex)).toEqual([0, 1]);
  });

  it('stops at the first ring that exceeds the box', () => {
    const arcGroups = makeArcGroups([
      ['circle_0', 0, squareOutline(5)],
      ['circle_1', 1, squareOutline(55)],  // exceeds 100mm/2 = 50
      ['circle_2', 2, squareOutline(10)],  // never reached
    ]);
    const rings = getBreakdownRings(arcGroups, 1, 100, 100);
    expect(rings.map(r => r.ringIndex)).toEqual([0]);
  });

  it('includes a ring whose outline exactly touches the box boundary (≤ check)', () => {
    const arcGroups = makeArcGroups([
      ['circle_0', 0, squareOutline(50)],  // exactly at boundary 50 ≤ 50
    ]);
    const rings = getBreakdownRings(arcGroups, 1, 100, 100);
    expect(rings).toHaveLength(1);
  });

  it('ignores non-circle_ keys', () => {
    const arcGroups = makeArcGroups([
      ['outer_0', 0, squareOutline(10)],
      ['circle_1', 0, squareOutline(10)],
    ]);
    const rings = getBreakdownRings(arcGroups, 1, 100, 100);
    expect(rings).toHaveLength(1);
    expect(rings[0].ringIndex).toBe(0);
  });

  it('returns empty array when no rings fit', () => {
    const arcGroups = makeArcGroups([
      ['circle_0', 0, squareOutline(100)],  // 100 > 10/2 = 5
    ]);
    const rings = getBreakdownRings(arcGroups, 1, 10, 10);
    expect(rings).toHaveLength(0);
  });

  it('applies scaleFactor correctly', () => {
    // Internal units are 10; with scaleFactor=2 that's 20mm each side → needs box ≥ 40mm
    const arcGroups = makeArcGroups([
      ['circle_0', 0, squareOutline(10)],
    ]);
    expect(getBreakdownRings(arcGroups, 2, 39, 39)).toHaveLength(0); // 10*2=20 > 39/2=19.5
    expect(getBreakdownRings(arcGroups, 2, 40, 40)).toHaveLength(1); // 10*2=20 ≤ 40/2=20
  });

  it('excludes a ring when any rotated clone exceeds the box even if the master fits', () => {
    // Master group for ring 1 has half-size 20 → fits in 50mm half-box.
    // Rotated clone of ring 1 has a point at (35, 35) → |re|=35 > 30, does NOT fit in 60mm box.
    // The ring must be excluded because not ALL groups fit.
    const arcGroups = makeArcGroups([
      ['circle_0',  0, squareOutline(10)],                          // ring 0 fits
      ['circle_1a', 1, squareOutline(20)],                          // ring 1 master: |re|,|im| ≤ 20 — fits
      ['circle_1b', 1, [{ re: 35, im: 0 }, { re: 0, im: 35 },      // ring 1 clone: |re|=35 > 30
                        { re: -35, im: 0 }, { re: 0, im: -35 }]],
    ]);
    const rings = getBreakdownRings(arcGroups, 1, 60, 60); // half=30
    // ring 1 clone has |re|=35 > 30 → ring 1 must not fit
    expect(rings.map(r => r.ringIndex)).toEqual([0]);
  });
});

describe('generateBreakdownSVG', () => {
  const outline = squareOutline(10);
  const scale = 1;
  const w = 100;
  const h = 100;

  it('produces a valid SVG string', () => {
    const svg = generateBreakdownSVG([outline], [], scale, w, h, []);
    expect(svg).toMatch(/^<\?xml/);
    expect(svg).toContain('<svg');
    expect(svg).toContain('</svg>');
    expect(svg).toContain('<path');
  });

  it('sets correct viewBox from workpiece dimensions', () => {
    const svg = generateBreakdownSVG([outline], [], scale, w, h, []);
    expect(svg).toContain(`viewBox="0 0 ${w} ${h}"`);
  });

  it('includes highlight path in red when highlightPaths provided', () => {
    const rim = [squareOutline(12)];
    const svg = generateBreakdownSVG([outline], rim, scale, w, h, []);
    expect(svg).toContain('stroke="red"');
  });

  it('does not include red path when highlightPaths is empty', () => {
    const svg = generateBreakdownSVG([outline], [], scale, w, h, []);
    expect(svg).not.toContain('stroke="red"');
  });

  it('includes pattern lines when patternLines provided', () => {
    const patLines = [{ p1: { re: 0, im: 0 }, p2: { re: 5, im: 5 } }];
    const svg = generateBreakdownSVG([outline], [], scale, w, h, patLines);
    expect(svg).toContain('<line');
  });

  it('does not include line elements when patternLines is empty', () => {
    const svg = generateBreakdownSVG([outline], [], scale, w, h, []);
    expect(svg).not.toContain('<line');
  });

  it('renders multiple outlines as separate path elements', () => {
    const outlineA = squareOutline(5);
    const outlineB = squareOutline(10);
    const svg = generateBreakdownSVG([outlineA, outlineB], [], scale, w, h, []);
    const pathCount = (svg.match(/<path /g) || []).length;
    expect(pathCount).toBe(2);
  });
});

describe('generateSingleGroupDXF', () => {
  const outline = squareOutline(10);
  const scale = 1;
  const w = 100;
  const h = 100;

  it('contains LWPOLYLINE and SPIRALS layer', () => {
    const dxf = generateSingleGroupDXF([outline], [], scale, w, h);
    expect(dxf).toContain('LWPOLYLINE');
    expect(dxf).toContain('SPIRALS');
  });

  it('does not contain HIGHLIGHT layer when highlightPaths is empty', () => {
    const dxf = generateSingleGroupDXF([outline], [], scale, w, h);
    expect(dxf).not.toContain('HIGHLIGHT');
  });

  it('contains HIGHLIGHT layer when highlightPaths are provided', () => {
    const rim = [squareOutline(12)];
    const dxf = generateSingleGroupDXF([outline], rim, scale, w, h);
    expect(dxf).toContain('HIGHLIGHT');
  });

  it('has correct DXF structure (header, tables, entities)', () => {
    const dxf = generateSingleGroupDXF([outline], [], scale, w, h);
    expect(dxf).toContain('SECTION');
    expect(dxf).toContain('HEADER');
    expect(dxf).toContain('ENTITIES');
    expect(dxf).toContain('EOF');
  });

  it('sets mm units in header', () => {
    const dxf = generateSingleGroupDXF([outline], [], scale, w, h);
    expect(dxf).toContain('$INSUNITS');
    expect(dxf).toContain('4'); // 4 = millimetres
  });

  it('centres outline using workpiece dimensions', () => {
    // Point at (0, 0) should map to (w/2, h/2) = (50, 50)
    const centreOutline = [{ re: 0, im: 0 }, { re: 1, im: 0 }, { re: 0, im: 1 }];
    const dxf = generateSingleGroupDXF([centreOutline], [], scale, 100, 100);
    expect(dxf).toContain('50.000000'); // x = 0*1 + 50
  });

  it('renders multiple outlines as separate LWPOLYLINE entities', () => {
    const outlineA = squareOutline(5);
    const outlineB = squareOutline(10);
    const dxf = generateSingleGroupDXF([outlineA, outlineB], [], scale, w, h);
    const count = (dxf.match(/LWPOLYLINE/g) || []).length;
    expect(count).toBe(2);
  });
});

describe('countWorkpieces', () => {
  function makeMultiGroupArcGroups(entries) {
    const map = new Map();
    for (const [key, ringIndex, outlinePoints] of entries) {
      map.set(key, {
        ringIndex,
        id: key,
        getClosedOutline: () => outlinePoints,
        arcs: [],
      });
    }
    return map;
  }

  it('returns 1 when workpiece box exactly matches ring 0 bounding box and only ring 0 fits', () => {
    // One arc group for ring 0 only; workpiece box exactly matches its bounding box.
    // half-size=10, scale=1 → outline extents are 10mm; workpiece=20×20mm (half=10).
    // Ring 0 fits exactly (≤ check). No other rings exist → no overflow → count = 1.
    const arcGroups = makeMultiGroupArcGroups([
      ['circle_0', 0, squareOutline(10)],
    ]);
    const fittingRings = getBreakdownRings(arcGroups, 1, 20, 20);
    expect(fittingRings.map(r => r.ringIndex)).toEqual([0]);
    expect(countWorkpieces(arcGroups, fittingRings, false)).toBe(1);
  });

  it('returns 1 for any number of fitting rings (all combined into one workpiece file)', () => {
    const arcGroups = makeMultiGroupArcGroups([
      ['circle_0',  0, squareOutline(5)],
      ['circle_1a', 1, squareOutline(10)],
      ['circle_1b', 1, squareOutline(10)],
    ]);
    const fittingRings = getBreakdownRings(arcGroups, 1, 100, 100);
    expect(fittingRings.map(r => r.ringIndex)).toEqual([0, 1]);
    // All fitting rings → 1 combined file = 1 workpiece
    expect(countWorkpieces(arcGroups, fittingRings, false)).toBe(1);
  });

  it('counts overflow groups (beyond-box rings) as individual workpieces on top of the 1 fitting workpiece', () => {
    const arcGroups = makeMultiGroupArcGroups([
      ['circle_0',  0, squareOutline(5)],
      ['circle_1a', 1, squareOutline(60)],  // 60 > 50 — does not fit
      ['circle_1b', 1, squareOutline(60)],
    ]);
    const fittingRings = getBreakdownRings(arcGroups, 1, 100, 100);
    expect(fittingRings.map(r => r.ringIndex)).toEqual([0]);
    // 1 fitting workpiece + 2 overflow arc groups = 3
    expect(countWorkpieces(arcGroups, fittingRings, false)).toBe(3);
  });

  it('file count equals workpiece count (fitting=1 combined, overflow=1 per group)', () => {
    // 1 fitting ring + 2 overflow groups → 3 workpieces = 3 files
    const arcGroups = makeMultiGroupArcGroups([
      ['circle_0',  0, squareOutline(5)],
      ['circle_1a', 1, squareOutline(60)],
      ['circle_1b', 1, squareOutline(60)],
    ]);
    const fittingRings = getBreakdownRings(arcGroups, 1, 100, 100);
    const count = countWorkpieces(arcGroups, fittingRings, false);
    // 1 combined workpiece file + 2 overflow files = 3
    expect(count).toBe(3);
  });

  it('pattern fill flag does not change count (fitting still = 1 combined)', () => {
    const arcGroups = makeMultiGroupArcGroups([
      ['circle_0a', 0, squareOutline(5)],
      ['circle_0b', 0, squareOutline(5)],
    ]);
    const fittingRings = getBreakdownRings(arcGroups, 1, 100, 100);
    expect(countWorkpieces(arcGroups, fittingRings, true)).toBe(1);
    expect(countWorkpieces(arcGroups, fittingRings, false)).toBe(1);
  });

  it('returns 0 for empty arcGroups', () => {
    const arcGroups = makeMultiGroupArcGroups([]);
    const fittingRings = getBreakdownRings(arcGroups, 1, 100, 100);
    expect(countWorkpieces(arcGroups, fittingRings, false)).toBe(0);
  });
});

describe('getOuterBoundsRequired', () => {
  function makeArcGroupsForBounds(circleEntries) {
    const map = new Map();
    for (const [key, ringIndex, outlinePoints] of circleEntries) {
      map.set(key, { ringIndex, getClosedOutline: () => outlinePoints, arcs: [] });
    }
    return map;
  }

  it('returns null when no circle_ groups exist', () => {
    expect(getOuterBoundsRequired(new Map(), 1)).toBeNull();
  });

  it('returns correct minimum box based on outermost ring (highest ringIndex)', () => {
    // ring 0 half-size=5, ring 1 half-size=20 → outermost is ring 1 → box = 40×40mm
    const arcGroups = makeArcGroupsForBounds([
      ['circle_0', 0, squareOutline(5)],
      ['circle_1', 1, squareOutline(20)],
    ]);
    const result = getOuterBoundsRequired(arcGroups, 1);
    expect(result).not.toBeNull();
    expect(result.w).toBeCloseTo(40);
    expect(result.h).toBeCloseTo(40);
  });

  it('scales extents by scaleFactor', () => {
    // ring 1 half-size=10 in internal units, scale=3 → extents ±30mm → box = 60×60mm
    const arcGroups = makeArcGroupsForBounds([
      ['circle_1', 1, squareOutline(10)],
    ]);
    const result = getOuterBoundsRequired(arcGroups, 3);
    expect(result.w).toBeCloseTo(60);
    expect(result.h).toBeCloseTo(60);
  });

  it('takes the maximum extent across all arc groups of the outermost ring', () => {
    // ring 2 has two groups with different sizes — should use the larger
    const arcGroups = makeArcGroupsForBounds([
      ['circle_2a', 2, squareOutline(10)],
      ['circle_2b', 2, squareOutline(25)],  // larger — dominates
    ]);
    const result = getOuterBoundsRequired(arcGroups, 1);
    expect(result.w).toBeCloseTo(50);
    expect(result.h).toBeCloseTo(50);
  });

  it('ignores lower rings when computing outermost bounds', () => {
    // ring 1 is large but ring 2 is smaller; ring 2 is the outermost
    const arcGroups = makeArcGroupsForBounds([
      ['circle_1', 1, squareOutline(50)],  // not the outermost
      ['circle_2', 2, squareOutline(10)],  // outermost ring
    ]);
    const result = getOuterBoundsRequired(arcGroups, 1);
    expect(result.w).toBeCloseTo(20);
    expect(result.h).toBeCloseTo(20);
  });

  it('indicates too-small box when workpiece < required outermost extent', () => {
    // outermost ring extent = 40×40mm; workpiece = 30×30mm → required.w > 30
    const arcGroups = makeArcGroupsForBounds([['circle_1', 1, squareOutline(20)]]);
    const required = getOuterBoundsRequired(arcGroups, 1);
    expect(required.w).toBeGreaterThan(30);
  });

  it('accepts a workpiece box that exactly matches the required size', () => {
    // outermost ring extent = 40×40mm; workpiece = 40×40mm → required.w ≤ 40
    const arcGroups = makeArcGroupsForBounds([['circle_1', 1, squareOutline(20)]]);
    const required = getOuterBoundsRequired(arcGroups, 1);
    expect(required.w <= 40).toBe(true);
  });
});

describe('centreOutline', () => {
  it('returns outline unchanged when already centred at origin', () => {
    const outline = squareOutline(10);
    const result = centreOutline(outline);
    for (let i = 0; i < outline.length; i++) {
      expect(result[i].re).toBeCloseTo(outline[i].re);
      expect(result[i].im).toBeCloseTo(outline[i].im);
    }
  });

  it('shifts an off-centre outline so its centroid is at (0, 0)', () => {
    // Outline centred at (100, 50), half-size 10
    const outline = [
      { re: 90, im: 40 }, { re: 110, im: 40 },
      { re: 110, im: 60 }, { re: 90, im: 60 },
    ];
    const result = centreOutline(outline);
    const cx = result.reduce((s, p) => s + p.re, 0) / result.length;
    const cy = result.reduce((s, p) => s + p.im, 0) / result.length;
    expect(cx).toBeCloseTo(0);
    expect(cy).toBeCloseTo(0);
  });

  it('preserves the shape (relative distances between points unchanged)', () => {
    const outline = [
      { re: 100, im: 200 }, { re: 120, im: 200 },
      { re: 120, im: 220 }, { re: 100, im: 220 },
    ];
    const result = centreOutline(outline);
    // Width and height should be the same: 20 × 20
    const minRe = Math.min(...result.map(p => p.re));
    const maxRe = Math.max(...result.map(p => p.re));
    const minIm = Math.min(...result.map(p => p.im));
    const maxIm = Math.max(...result.map(p => p.im));
    expect(maxRe - minRe).toBeCloseTo(20);
    expect(maxIm - minIm).toBeCloseTo(20);
  });

  it('overflow group SVG: outline centred at (wpW/2, wpH/2) after transform', () => {
    // Outline centred at spiral position (100, 50), half-size 10
    const offCentreOutline = [
      { re: 90, im: 40 }, { re: 110, im: 40 },
      { re: 110, im: 60 }, { re: 90, im: 60 },
    ];
    const centred = centreOutline(offCentreOutline);
    const w = 100, h = 100, scale = 1;
    const svg = generateBreakdownSVG([centred], [], scale, w, h, []);
    // After transform x = re*1 + 50, the bounding box midpoint should be ≈ 50
    // Extract all x coordinates from the path d attribute
    const xMatches = [...svg.matchAll(/[ML]([\d.-]+),([\d.-]+)/g)];
    const xs = xMatches.map(m => parseFloat(m[1]));
    const midX = (Math.min(...xs) + Math.max(...xs)) / 2;
    expect(midX).toBeCloseTo(w / 2, 0);
  });
});

describe('generateBreakdownSVG multi-outline (fitting workpiece)', () => {
  it('includes all arc group outlines for fitting rings', () => {
    // Two outlines in spiral coords (ring 0 and ring 1 representative)
    const outline0 = squareOutline(5);
    const outline1 = squareOutline(10);
    const svg = generateBreakdownSVG([outline0, outline1], [], 1, 100, 100, []);
    const pathCount = (svg.match(/<path /g) || []).length;
    expect(pathCount).toBe(2);
  });

  it('three fitting ring groups all appear as separate paths', () => {
    const outlines = [squareOutline(3), squareOutline(5), squareOutline(8)];
    const svg = generateBreakdownSVG(outlines, [], 1, 100, 100, []);
    const pathCount = (svg.match(/<path /g) || []).length;
    expect(pathCount).toBe(3);
  });

  it('highlight rim is the closed outline of each outermost fitting ring group (not inner rings)', () => {
    // Simulate: ring 0 group (inner) + ring 1 group A + ring 1 group B (outermost ring)
    // Only ring 1 groups should have their outlines added as highlight paths
    const ring0Outline = squareOutline(3);
    const ring1OutlineA = squareOutline(8);
    const ring1OutlineB = squareOutline(8);

    // Build highlight paths as the export loop does: push gOutline for isOutermost groups only
    const highlightPaths = [ring1OutlineA, ring1OutlineB];
    const allOutlines = [ring0Outline, ring1OutlineA, ring1OutlineB];

    const svg = generateBreakdownSVG(allOutlines, highlightPaths, 1, 100, 100, []);

    // 3 black paths (outlines) + 2 red paths (highlight rim = outermost ring groups)
    const redPaths = (svg.match(/stroke="red"/g) || []).length;
    const blackPaths = (svg.match(/stroke="black"/g) || []).length;
    expect(redPaths).toBe(2);
    expect(blackPaths).toBe(3);
  });

  it('no highlight rim paths when outermost is ring 0 (single ring, no rim)', () => {
    // Ring 0 is the only fitting ring — its groups get no highlight (ringIndex <= 0 check)
    // In the export loop: isOutermost=true but ring 0 is excluded by ringIndex check
    // Here we test that passing empty highlightPaths produces no red strokes
    const svg = generateBreakdownSVG([squareOutline(5)], [], 1, 100, 100, []);
    expect(svg).not.toContain('stroke="red"');
  });
});

describe('getFittingGroups', () => {
  // arcGroups where ring 1 has a clone whose outline exceeds the 60mm box (half=30)
  // ring 0: 1 group, fits; ring 1: master fits (half=20), clone does NOT fit (re=35 > 30)
  // getBreakdownRings → only ring 0 fits; getFittingGroups → 1 group (ring 0's only group)
  function makeCloneArcGroups() {
    return makeArcGroups([
      ['circle_0',  0, squareOutline(10)],
      ['circle_1a', 1, squareOutline(20)],
      ['circle_1b', 1, [{ re: 35, im: 0 }, { re: 0, im: 35 },
                        { re: -35, im: 0 }, { re: 0, im: -35 }]],
    ]);
  }

  it('returns only groups whose ring index is in the fitting set', () => {
    const arcGroups = makeCloneArcGroups();
    const fittingRings = getBreakdownRings(arcGroups, 1, 60, 60); // ring 1 excluded
    expect(fittingRings.map(r => r.ringIndex)).toEqual([0]);
    const groups = getFittingGroups(arcGroups, fittingRings);
    expect(groups.every(g => g.ringIndex === 0)).toBe(true);
    expect(groups).toHaveLength(1);
  });

  it('workpiece SVG path count equals number of fitting groups', () => {
    const arcGroups = makeCloneArcGroups();
    const fittingRings = getBreakdownRings(arcGroups, 1, 60, 60);
    const fittingGroups = getFittingGroups(arcGroups, fittingRings);
    const outlines = fittingGroups.map(g => g.outline);
    const svg = generateBreakdownSVG(outlines, [], 1, 250, 250, []);
    const pathCount = (svg.match(/<path /g) || []).length;
    expect(pathCount).toBe(fittingGroups.length);
  });

  it('includes all groups when every ring fits', () => {
    // ring 0: 1 group, ring 1: 2 groups — all within 100mm box (half=50)
    const arcGroups = makeArcGroups([
      ['circle_0',  0, squareOutline(5)],
      ['circle_1a', 1, squareOutline(10)],
      ['circle_1b', 1, squareOutline(10)],
    ]);
    const fittingRings = getBreakdownRings(arcGroups, 1, 100, 100);
    expect(fittingRings.map(r => r.ringIndex)).toEqual([0, 1]);
    const groups = getFittingGroups(arcGroups, fittingRings);
    expect(groups).toHaveLength(3);
  });

  it('returns empty array when no rings fit', () => {
    const arcGroups = makeArcGroups([['circle_0', 0, squareOutline(100)]]);
    const fittingRings = getBreakdownRings(arcGroups, 1, 10, 10);
    expect(getFittingGroups(arcGroups, fittingRings)).toHaveLength(0);
  });
});

describe('workpiece SVG contains no overflow ring groups', () => {
  // Setup: ring 0 (1 group, fits), ring 1 (2 clone groups, fit), ring 2 (2 groups, overflow)
  function makeThreeRingGroups() {
    return makeArcGroups([
      ['circle_0',  0, squareOutline(5)],
      ['circle_1a', 1, squareOutline(15)],
      ['circle_1b', 1, squareOutline(15)],
      ['circle_2a', 2, squareOutline(60)],  // 60 > 50 — overflow
      ['circle_2b', 2, squareOutline(60)],
    ]);
  }

  it('workpiece SVG path count equals only the non-overflow circle_ groups', () => {
    const arcGroups = makeThreeRingGroups();
    const { svg, outlines, overflowRingIds } = buildWorkpieceSVG(arcGroups, 1, 100, 100);

    // Overflow should be ring 2 only
    expect([...overflowRingIds]).toEqual([2]);

    // Non-overflow circle_ groups: ring 0 (1) + ring 1 (2) = 3
    expect(outlines).toHaveLength(3);

    const pathCount = (svg.match(/<path /g) || []).length;
    expect(pathCount).toBe(3);
  });

  it('workpiece SVG contains no paths for overflow ring IDs', () => {
    // Verify by checking that the overflow outlines (ring 2, half-size 60) do NOT appear.
    // After transform x = re*1 + 50, a point at re=60 → x=110 which exceeds wpW=100.
    // None of the paths in the workpiece SVG should have x > wpW.
    const arcGroups = makeThreeRingGroups();
    const { svg } = buildWorkpieceSVG(arcGroups, 1, 100, 100);

    const xMatches = [...svg.matchAll(/[ML]([\d.]+),([\d.]+)/g)];
    const xs = xMatches.map(m => parseFloat(m[1]));
    expect(xs.every(x => x <= 100)).toBe(true);
  });

  it('when all rings fit, workpiece contains every circle_ group and overflow set is empty', () => {
    const arcGroups = makeArcGroups([
      ['circle_0',  0, squareOutline(5)],
      ['circle_1a', 1, squareOutline(10)],
      ['circle_1b', 1, squareOutline(10)],
    ]);
    const { svg, outlines, overflowRingIds } = buildWorkpieceSVG(arcGroups, 1, 100, 100);

    expect(overflowRingIds.size).toBe(0);
    expect(outlines).toHaveLength(3);
    const pathCount = (svg.match(/<path /g) || []).length;
    expect(pathCount).toBe(3);
  });

  it('when no rings fit, workpiece has no outlines and overflow contains everything', () => {
    const arcGroups = makeArcGroups([
      ['circle_0', 0, squareOutline(100)],  // 100 > 5 — overflow immediately
    ]);
    const { outlines, overflowRingIds } = buildWorkpieceSVG(arcGroups, 1, 10, 10);

    expect(overflowRingIds.has(0)).toBe(true);
    expect(outlines).toHaveLength(0);
  });

  it('overflow ring IDs exactly match the ring IDs used in individual file names', () => {
    // The individual files are named ring_${g.ringIndex}_group_${g.id}.
    // overflowRingIds must equal the set of ringIndex values from overflow groups.
    const arcGroups = makeArcGroups([
      ['circle_0',  0, squareOutline(5)],
      ['circle_2a', 2, squareOutline(60)],  // overflow
      ['circle_2b', 2, squareOutline(60)],  // overflow
    ]);
    const rings = getBreakdownRings(arcGroups, 1, 100, 100);
    const fittingIndices = new Set(rings.map(r => r.ringIndex));

    // Simulate overflow file generation: collect ring IDs used in filenames
    const fileRingIds = new Set();
    for (const [key, g] of arcGroups.entries()) {
      if (!key.startsWith('circle_')) continue;
      if (!fittingIndices.has(g.ringIndex)) fileRingIds.add(g.ringIndex);
    }

    const { overflowRingIds } = buildWorkpieceSVG(arcGroups, 1, 100, 100);
    expect([...overflowRingIds].sort()).toEqual([...fileRingIds].sort());
  });
});

describe('workpiece SVG with real engine: p=q=16, bbox=1000mm, workpiece=250mm', () => {
  // Render with draw_group_outline so arcGroups are populated
  const res = renderSpiral({
    p: 16, q: 16, depth: 4,
    bounding_box_width_mm: 1000,
    bounding_box_height_mm: 1000,
    mode: 'arram_boyle',
    draw_group_outline: true,
  }, 'arram_boyle');

  const wpW = 250, wpH = 250;
  const sf = res.scaleFactor;
  const arcGroups = res.engine.arcGroups;

  it('engine produces arc groups', () => {
    expect(arcGroups.size).toBeGreaterThan(0);
  });

  it('workpiece SVG path count equals circle_ groups NOT in overflow', () => {
    const rings = getBreakdownRings(arcGroups, sf, wpW, wpH);
    const fittingIndices = new Set(rings.map(r => r.ringIndex));

    const overflowRingIds = new Set();
    let expectedPaths = 0;
    for (const [key, g] of arcGroups.entries()) {
      if (!key.startsWith('circle_')) continue;
      if (g.ringIndex == null || g.ringIndex < 0) continue;
      const o = g.getClosedOutline();
      if (!o || o.length < 2) continue;
      if (!fittingIndices.has(g.ringIndex)) {
        overflowRingIds.add(g.ringIndex);
      } else {
        expectedPaths++;
      }
    }

    const { svg, outlines } = buildWorkpieceSVG(arcGroups, sf, wpW, wpH);
    expect(outlines).toHaveLength(expectedPaths);

    const pathCount = (svg.match(/<path /g) || []).length;
    expect(pathCount).toBe(expectedPaths);
  });

  it('workpiece SVG contains no outline points outside the workpiece box', () => {
    const { svg } = buildWorkpieceSVG(arcGroups, sf, wpW, wpH);
    const xMatches = [...svg.matchAll(/[ML]([\d.-]+),([\d.-]+)/g)];
    const xs = xMatches.map(m => parseFloat(m[1]));
    const ys = xMatches.map(m => parseFloat(m[2]));
    expect(xs.every(x => x >= -0.01 && x <= wpW + 0.01)).toBe(true);
    expect(ys.every(y => y >= -0.01 && y <= wpH + 0.01)).toBe(true);
  });

  it('overflow ring IDs are all greater than any fitting ring ID', () => {
    const rings = getBreakdownRings(arcGroups, sf, wpW, wpH);
    if (rings.length === 0) return; // nothing to check
    const maxFitting = Math.max(...rings.map(r => r.ringIndex));

    const { overflowRingIds } = buildWorkpieceSVG(arcGroups, sf, wpW, wpH);
    for (const id of overflowRingIds) {
      expect(id).toBeGreaterThan(maxFitting);
    }
  });
});
