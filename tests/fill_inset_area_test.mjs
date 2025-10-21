import { DoyleSpiralEngine, insetPolygon } from '../javascript/js/doyle_spiral_engine.js';

function polygonAreaXY(points) {
  if (!points || points.length < 3) {
    return 0;
  }
  let area = 0;
  for (let i = 0; i < points.length; i += 1) {
    const current = points[i];
    const next = points[(i + 1) % points.length];
    area += current.x * next.y - next.x * current.y;
  }
  return area / 2;
}

function computeScaleFactor(engine, size) {
  const elements = [...engine.circles];
  if (Array.isArray(engine.outerCircles)) {
    elements.push(...engine.outerCircles);
  }
  if (!elements.length) {
    return 1;
  }
  let maxExtent = 0;
  for (const circle of elements) {
    const center = circle.center;
    const radius = circle.radius;
    maxExtent = Math.max(
      maxExtent,
      Math.abs(center.re) + radius,
      Math.abs(center.im) + radius,
    );
  }
  if (maxExtent === 0) {
    return 1;
  }
  return (size / 2.1) / maxExtent;
}

function toScaledPoints(outline, scaleFactor) {
  return outline.map(pt => ({ x: pt.re * scaleFactor, y: pt.im * scaleFactor }));
}

function uniqueOutline(points) {
  if (!points || !points.length) {
    return [];
  }
  const cleaned = [];
  for (const pt of points) {
    const prev = cleaned[cleaned.length - 1];
    if (prev && Math.hypot(pt.re - prev.re, pt.im - prev.im) <= 1e-9) {
      continue;
    }
    cleaned.push(pt);
  }
  if (cleaned.length > 1) {
    const first = cleaned[0];
    const last = cleaned[cleaned.length - 1];
    if (Math.hypot(first.re - last.re, first.im - last.im) <= 1e-9) {
      cleaned.pop();
    }
  }
  return cleaned;
}

function collectInsetAreas({ p, q, size = 600, offset = 2 }) {
  const engine = new DoyleSpiralEngine(p, q, 0, {
    maxDistance: 2000,
    arcMode: 'closest',
    numGaps: 2,
  });
  engine.render('arram_boyle', {
    size,
    debugGroups: false,
    addFillPattern: false,
    drawGroupOutline: false,
    redOutline: false,
    fillPatternOffset: offset,
  });

  const scaleFactor = computeScaleFactor(engine, size);
  const rings = new Map();

  for (const [key, group] of engine.arcGroups.entries()) {
    if (key.startsWith('outer_')) {
      continue;
    }
    if (group.ringIndex === null || group.ringIndex === undefined) {
      continue;
    }
    const outline = uniqueOutline(group.getClosedOutline());
    if (outline.length < 3) {
      continue;
    }
    const scaled = toScaledPoints(outline, scaleFactor);
    const inset = insetPolygon(scaled, offset);
    if (!inset || inset.length < 3) {
      continue;
    }
    const area = Math.abs(polygonAreaXY(inset));
    if (!Number.isFinite(area) || area <= 0) {
      continue;
    }
    if (!rings.has(group.ringIndex)) {
      rings.set(group.ringIndex, []);
    }
    rings.get(group.ringIndex).push(area);
  }

  return rings;
}

function summarise(rings) {
  const stats = [];
  for (const [ringIndex, areas] of rings.entries()) {
    if (!areas.length) {
      continue;
    }
    const min = Math.min(...areas);
    const max = Math.max(...areas);
    const sum = areas.reduce((acc, value) => acc + value, 0);
    const mean = sum / areas.length;
    const spread = mean === 0 ? 0 : Math.abs(max - min) / mean;
    stats.push({ ringIndex, count: areas.length, min, max, mean, spread });
  }
  stats.sort((a, b) => a.ringIndex - b.ringIndex);
  return stats;
}

function runScenario({ label, p, q, offset, size }, tolerance) {
  const rings = collectInsetAreas({ p, q, offset, size });
  const stats = summarise(rings);
  let ok = true;
  console.log(`Scenario ${label} (p=${p}, q=${q}, offset=${offset})`);
  if (!stats.length) {
    console.warn('  No inset areas recorded.');
    return false;
  }
  for (const entry of stats) {
    console.log(
      `  ring ${entry.ringIndex}: count=${entry.count}, spread=${entry.spread.toExponential(3)}`,
    );
    if (entry.spread > tolerance) {
      ok = false;
    }
  }
  if (!ok) {
    console.error(`  \u2716 Inset area spread exceeded tolerance ${tolerance}`);
  } else {
    console.log(`  \u2714 Within tolerance ${tolerance}`);
  }
  return ok;
}

const tolerance = 5e-3;
const scenarios = [
  { label: 'balanced', p: 12, q: 12, offset: 2.0, size: 600 },
  { label: 'asymmetric', p: 14, q: 10, offset: 1.5, size: 600 },
];

let allPassed = true;
for (const scenario of scenarios) {
  const ok = runScenario(scenario, tolerance);
  allPassed = allPassed && ok;
}

if (!allPassed) {
  process.exitCode = 1;
}
