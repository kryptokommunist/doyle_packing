import { renderSpiral, __TESTING__ } from '../javascript/js/doyle_spiral_engine.js';

const { insetPolygon, polygonSignedArea } = __TESTING__;

function polygonArea(points) {
  if (!points || points.length < 3) {
    return 0;
  }
  return polygonSignedArea(points);
}

function collectInsetStats(params, offset) {
  const { geometry } = renderSpiral({ ...params, mode: 'arram_boyle' });
  const rings = new Map();
  for (const group of geometry.arcgroups) {
    const ring = group.ring_index;
    if (ring === null || ring === undefined) {
      continue;
    }
    if (!rings.has(ring)) {
      rings.set(ring, { total: 0, collapsed: 0, areas: [] });
    }
    const entry = rings.get(ring);
    entry.total += 1;
    const points = group.outline.map(([x, y]) => ({ x, y }));
    const inset = insetPolygon(points, offset);
    if (!inset.length) {
      entry.collapsed += 1;
      continue;
    }
    const area = Math.abs(polygonArea(inset));
    if (area <= 0) {
      entry.collapsed += 1;
    } else {
      entry.areas.push(area);
    }
  }
  return rings;
}

function evaluateUniformity(rings, tolerance) {
  const summary = [];
  let ok = true;
  for (const [ring, data] of rings.entries()) {
    const { total, collapsed, areas } = data;
    const positives = areas.length;
    const hasMixedStates = positives > 0 && collapsed > 0;
    let spread = 0;
    if (positives > 1) {
      const min = Math.min(...areas);
      const max = Math.max(...areas);
      const mean = areas.reduce((acc, value) => acc + value, 0) / positives;
      spread = mean === 0 ? 0 : Math.abs(max - min) / mean;
      if (spread > tolerance) {
        ok = false;
      }
    }
    if (hasMixedStates) {
      ok = false;
    }
    summary.push({ ring, total, collapsed, positives, spread, hasMixedStates });
  }
  summary.sort((a, b) => a.ring - b.ring);
  return { ok, summary };
}

const scenarios = [
  { label: 'balanced (p=16, q=16, t=0)', params: { p: 16, q: 16, t: 0 } },
  { label: 'asymmetric (p=9, q=7, t=0.2)', params: { p: 9, q: 7, t: 0.2 } },
];

const offsets = [0.5, 2.5, 4.0];
const tolerance = 2e-4;
let allPassed = true;

for (const scenario of scenarios) {
  console.log(`Scenario ${scenario.label}`);
  for (const offset of offsets) {
    const rings = collectInsetStats(scenario.params, offset);
    const { ok, summary } = evaluateUniformity(rings, tolerance);
    let collapsedOnly = 0;
    for (const entry of summary) {
      if (entry.positives === 0) {
        collapsedOnly += 1;
        continue;
      }
      const state = entry.hasMixedStates ? 'mixed' : 'uniform';
      const spreadStr = entry.positives > 1 ? entry.spread.toExponential(3) : '0.000e+0';
      console.log(
        `  offset=${offset.toFixed(1)} ring=${entry.ring} total=${entry.total} ` +
          `positives=${entry.positives} collapsed=${entry.collapsed} spread=${spreadStr} state=${state}`,
      );
    }
    if (collapsedOnly && collapsedOnly === summary.length) {
      console.log(`  offset=${offset.toFixed(1)} all ${collapsedOnly} rings collapsed (no inset area)`);
    }
    if (!ok) {
      console.error(
        `  \u2716 inset uniformity failed tolerance ${tolerance.toExponential(1)} for offset ${offset.toFixed(1)}`,
      );
      allPassed = false;
    } else {
      console.log(
        `  \u2714 inset uniformity within tolerance ${tolerance.toExponential(1)} for offset ${offset.toFixed(1)}`,
      );
    }
  }
}

if (!allPassed) {
  process.exitCode = 1;
}
