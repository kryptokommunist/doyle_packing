import { describe, it, expect } from 'vitest';
import { getBreakdownRings, generateBreakdownSVG } from '../js/breakdown.js';
import { generateSingleGroupDXF } from '../js/dxf_export.js';

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
});

describe('generateBreakdownSVG', () => {
  const outline = squareOutline(10);
  const scale = 1;
  const w = 100;
  const h = 100;

  it('produces a valid SVG string', () => {
    const svg = generateBreakdownSVG(outline, [], scale, w, h, []);
    expect(svg).toMatch(/^<\?xml/);
    expect(svg).toContain('<svg');
    expect(svg).toContain('</svg>');
    expect(svg).toContain('<path');
  });

  it('sets correct viewBox from workpiece dimensions', () => {
    const svg = generateBreakdownSVG(outline, [], scale, w, h, []);
    expect(svg).toContain(`viewBox="0 0 ${w} ${h}"`);
  });

  it('includes highlight path in red when highlightPaths provided', () => {
    const rim = [squareOutline(12)];
    const svg = generateBreakdownSVG(outline, rim, scale, w, h, []);
    expect(svg).toContain('stroke="red"');
  });

  it('does not include red path when highlightPaths is empty', () => {
    const svg = generateBreakdownSVG(outline, [], scale, w, h, []);
    expect(svg).not.toContain('stroke="red"');
  });

  it('includes pattern lines when patternLines provided', () => {
    const patLines = [{ p1: { re: 0, im: 0 }, p2: { re: 5, im: 5 } }];
    const svg = generateBreakdownSVG(outline, [], scale, w, h, patLines);
    expect(svg).toContain('<line');
  });

  it('does not include line elements when patternLines is empty', () => {
    const svg = generateBreakdownSVG(outline, [], scale, w, h, []);
    expect(svg).not.toContain('<line');
  });
});

describe('generateSingleGroupDXF', () => {
  const outline = squareOutline(10);
  const scale = 1;
  const w = 100;
  const h = 100;

  it('contains LWPOLYLINE and SPIRALS layer', () => {
    const dxf = generateSingleGroupDXF(outline, [], scale, w, h);
    expect(dxf).toContain('LWPOLYLINE');
    expect(dxf).toContain('SPIRALS');
  });

  it('does not contain HIGHLIGHT layer when highlightPaths is empty', () => {
    const dxf = generateSingleGroupDXF(outline, [], scale, w, h);
    expect(dxf).not.toContain('HIGHLIGHT');
  });

  it('contains HIGHLIGHT layer when highlightPaths are provided', () => {
    const rim = [squareOutline(12)];
    const dxf = generateSingleGroupDXF(outline, rim, scale, w, h);
    expect(dxf).toContain('HIGHLIGHT');
  });

  it('has correct DXF structure (header, tables, entities)', () => {
    const dxf = generateSingleGroupDXF(outline, [], scale, w, h);
    expect(dxf).toContain('SECTION');
    expect(dxf).toContain('HEADER');
    expect(dxf).toContain('ENTITIES');
    expect(dxf).toContain('EOF');
  });

  it('sets mm units in header', () => {
    const dxf = generateSingleGroupDXF(outline, [], scale, w, h);
    expect(dxf).toContain('$INSUNITS');
    expect(dxf).toContain('4'); // 4 = millimetres
  });

  it('centres outline using workpiece dimensions', () => {
    // Point at (0, 0) should map to (w/2, h/2) = (50, 50)
    const centreOutline = [{ re: 0, im: 0 }, { re: 1, im: 0 }, { re: 0, im: 1 }];
    const dxf = generateSingleGroupDXF(centreOutline, [], scale, 100, 100);
    expect(dxf).toContain('50.000000'); // x = 0*1 + 50
  });
});
