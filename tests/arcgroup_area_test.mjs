import { DoyleSpiralEngine } from '../templates/js/doyle_spiral_engine.js';

function polygonArea(points) {
  if (!points || points.length < 3) {
    return 0;
  }
  let area = 0;
  for (let i = 0; i < points.length; i += 1) {
    const current = points[i];
    const next = points[(i + 1) % points.length];
    area += current.re * next.im - next.re * current.im;
  }
  return area / 2;
}

function uniqueOutline(points) {
  if (!points || points.length === 0) {
    return [];
  }
  const cleaned = [];
  for (let i = 0; i < points.length; i += 1) {
    const pt = points[i];
    const prev = cleaned[cleaned.length - 1];
    if (prev && Math.hypot(pt.re - prev.re, pt.im - prev.im) < 1e-9) {
      continue;
    }
    cleaned.push(pt);
  }
  if (cleaned.length > 1) {
    const first = cleaned[0];
    const last = cleaned[cleaned.length - 1];
    if (Math.hypot(first.re - last.re, first.im - last.im) < 1e-9) {
      cleaned.pop();
    }
  }
  return cleaned;
}

function computeRingAreas(p, q) {
  const engine = new DoyleSpiralEngine(p, q, 0, {
    maxDistance: 2000,
    arcMode: 'closest',
    numGaps: 2,
  });
  engine.render('arram_boyle', {
    size: 600,
    debugGroups: false,
    addFillPattern: false,
    drawGroupOutline: false,
    redOutline: false,
  });
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
    const area = Math.abs(polygonArea(outline));
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

function runScenario({ label, p, q }, tolerance) {
  const rings = computeRingAreas(p, q);
  const stats = summarise(rings);
  let ok = true;
  for (const entry of stats) {
    if (entry.spread > tolerance) {
      ok = false;
    }
  }
  console.log(`Scenario ${label} (p=${p}, q=${q})`);
  for (const entry of stats) {
    console.log(
      `  ring ${entry.ringIndex}: count=${entry.count}, spread=${entry.spread.toExponential(3)}`,
    );
  }
  if (!ok) {
    console.error(`  \u2716 Area spread exceeded tolerance ${tolerance}`);
  } else {
    console.log(`  \u2714 Within tolerance ${tolerance}`);
  }
  return ok;
}

const tolerance = 1e-3;
const scenarios = [
  { label: 'p=q+1', p: 7, q: 6 },
  { label: 'p=q', p: 6, q: 6 },
];

let allPassed = true;
for (const scenario of scenarios) {
  const ok = runScenario(scenario, tolerance);
  allPassed = allPassed && ok;
}

if (!allPassed) {
  process.exitCode = 1;
}
