import { DoyleSpiralEngine } from '../templates/js/doyle_spiral_engine.js';

function polygonAreaComplex(points) {
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

function sanitiseXY(points, tolerance = 1e-9) {
  if (!Array.isArray(points)) {
    return [];
  }
  const cleaned = [];
  for (const pt of points) {
    if (!pt) {
      continue;
    }
    const current = { x: pt.x, y: pt.y };
    const prev = cleaned[cleaned.length - 1];
    if (prev && Math.hypot(current.x - prev.x, current.y - prev.y) < tolerance) {
      continue;
    }
    cleaned.push(current);
  }
  if (cleaned.length > 1) {
    const first = cleaned[0];
    const last = cleaned[cleaned.length - 1];
    if (Math.hypot(first.x - last.x, first.y - last.y) < tolerance) {
      cleaned.pop();
    }
  }
  return cleaned;
}

function inwardNormal(direction, orientationSign) {
  if (orientationSign >= 0) {
    return { x: -direction.y, y: direction.x };
  }
  return { x: direction.y, y: -direction.x };
}

function normaliseVector(vec) {
  const length = Math.hypot(vec.x, vec.y);
  if (length < 1e-9) {
    return null;
  }
  return { x: vec.x / length, y: vec.y / length };
}

function clipPolygonAgainstHalfPlane(points, normal, constant, tolerance = 1e-9) {
  if (!Array.isArray(points) || points.length === 0) {
    return [];
  }
  const inside = point => normal.x * point.x + normal.y * point.y >= constant - tolerance;
  const output = [];
  for (let i = 0; i < points.length; i += 1) {
    const current = points[i];
    const next = points[(i + 1) % points.length];
    const currentInside = inside(current);
    const nextInside = inside(next);
    if (currentInside && nextInside) {
      output.push({ x: next.x, y: next.y });
      continue;
    }
    const dir = { x: next.x - current.x, y: next.y - current.y };
    const denom = normal.x * dir.x + normal.y * dir.y;
    if (Math.abs(denom) < 1e-12) {
      if (currentInside) {
        output.push({ x: next.x, y: next.y });
      }
      continue;
    }
    const t = (constant - (normal.x * current.x + normal.y * current.y)) / denom;
    const intersection = { x: current.x + dir.x * t, y: current.y + dir.y * t };
    if (currentInside && !nextInside) {
      output.push(intersection);
    } else if (!currentInside && nextInside) {
      output.push(intersection);
      output.push({ x: next.x, y: next.y });
    }
  }
  return sanitiseXY(output, tolerance);
}

function insetPolygonXY(points, offset, tolerance = 1e-9) {
  if (!offset || offset <= 0) {
    return sanitiseXY(points, tolerance);
  }
  const base = sanitiseXY(points, tolerance);
  if (base.length < 3) {
    return [];
  }
  const orientation = polygonAreaXY(base) >= 0 ? 1 : -1;
  let working = base;
  for (let i = 0; i < base.length; i += 1) {
    const a = base[i];
    const b = base[(i + 1) % base.length];
    const dir = normaliseVector({ x: b.x - a.x, y: b.y - a.y });
    if (!dir) {
      continue;
    }
    const normal = inwardNormal(dir, orientation);
    const constant = normal.x * a.x + normal.y * a.y + offset;
    working = clipPolygonAgainstHalfPlane(working, normal, constant, tolerance);
    if (working.length < 3) {
      return [];
    }
  }
  return sanitiseXY(working, tolerance);
}

function computeRingMetrics(p, q, insetOffset = 0) {
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
  const insetRings = insetOffset > 0 ? new Map() : null;
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
    const area = Math.abs(polygonAreaComplex(outline));
    if (!rings.has(group.ringIndex)) {
      rings.set(group.ringIndex, []);
    }
    rings.get(group.ringIndex).push(area);
    if (insetRings) {
      const xy = outline.map(pt => ({ x: pt.re, y: pt.im }));
      const inset = insetPolygonXY(xy, insetOffset);
      const insetArea = Math.abs(polygonAreaXY(inset));
      const diff = area - insetArea;
      if (!insetRings.has(group.ringIndex)) {
        insetRings.set(group.ringIndex, []);
      }
      insetRings.get(group.ringIndex).push(diff);
    }
  }
  return { base: rings, insetDiffs: insetRings };
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

function runScenario({ label, p, q }, tolerance, insetOffset, insetTolerance) {
  const metrics = computeRingMetrics(p, q, insetOffset);
  const stats = summarise(metrics.base);
  let ok = true;
  for (const entry of stats) {
    if (entry.spread > tolerance) {
      ok = false;
    }
  }
  console.log(`Scenario ${label} (p=${p}, q=${q})`);
  for (const entry of stats) {
    console.log(
      `  base ring ${entry.ringIndex}: count=${entry.count}, spread=${entry.spread.toExponential(3)}`,
    );
  }
  if (metrics.insetDiffs) {
    const insetStats = summarise(metrics.insetDiffs);
    for (const entry of insetStats) {
      if (entry.spread > insetTolerance) {
        ok = false;
      }
      console.log(
        `  inset ring ${entry.ringIndex}: count=${entry.count}, spread=${entry.spread.toExponential(3)}`,
      );
    }
  }
  if (!ok) {
    console.error(`  \u2716 Area spread exceeded tolerance ${tolerance}`);
  } else {
    console.log(`  \u2714 Within tolerance ${tolerance}`);
  }
  return ok;
}

const tolerance = 1e-3;
const insetOffset = 1.0;
const insetTolerance = 1e-3;
const scenarios = [
  { label: 'p=q+1', p: 7, q: 6 },
  { label: 'p=q', p: 6, q: 6 },
];

let allPassed = true;
for (const scenario of scenarios) {
  const ok = runScenario(scenario, tolerance, insetOffset, insetTolerance);
  allPassed = allPassed && ok;
}

if (!allPassed) {
  process.exitCode = 1;
}
