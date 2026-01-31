/* Doyle Spiral engine implemented in JavaScript.
 *
 * This module ports the computational and rendering logic from the Python
 * implementation (src/doyle_spiral.py) to the browser.  It exposes a
 * high-level renderSpiral helper together with the DoyleSpiralEngine class
 * for direct control.
 */

const SVG_NS = 'http://www.w3.org/2000/svg';

const RING_TEMPLATE_CACHE = new Map();

// Performance and safety constants
const MAX_ITERATIONS_PER_FAMILY = 10000; // Maximum iterations per spiral family to prevent infinite loops
const EPSILON = 1e-9; // Small value to prevent division by zero
const TOLERANCE = 1e-6; // General tolerance for floating point comparisons
const INTERSECTION_TOLERANCE = 1e-3; // Tolerance for circle intersection detection

// Arc rendering constants
const ARC_SEGMENT_RATIO = 0.12; // Ratio of circle radius to desired segment length
const MIN_ARC_SEGMENT_LENGTH = 6; // Minimum segment length in pixels
const MAX_ARC_SEGMENT_LENGTH = 30; // Maximum segment length in pixels
const MIN_ARC_STEPS = 10; // Minimum number of steps for arc rendering
const MAX_ARC_STEPS = 44; // Maximum number of steps for arc rendering

// Circle intersection constants
const STANDARD_INTERSECTION_COUNT = 6; // Expected intersection count for hexagonal packing

// Default colors
const DEFAULT_OUTLINE_COLOR = '#000000'; // Black outline for group boundaries

// Validation constants
const MIN_P = 2; // Minimum value for p parameter
const MAX_P = 256; // Maximum value for p parameter (practical limit)
const MIN_Q = 2; // Minimum value for q parameter
const MAX_Q = 256; // Maximum value for q parameter (practical limit)
const MIN_MAX_DISTANCE = 10; // Minimum max_d value
const MAX_MAX_DISTANCE = 50000; // Maximum max_d value (practical limit)

// ------------------------------------------------------------
// Complex arithmetic helpers
// ------------------------------------------------------------

/**
 * Complex number utilities for geometric computations.
 * All methods are pure functions that don't modify inputs.
 * @namespace Complex
 */
const Complex = {
  /**
   * Creates a new complex number.
   * @param {number} [re=0] - Real part
   * @param {number} [im=0] - Imaginary part
   * @returns {{re: number, im: number}} Complex number
   */
  create(re = 0, im = 0) {
    return { re, im };
  },

  /**
   * Creates a copy of a complex number.
   * @param {{re: number, im: number}} z - Complex number to clone
   * @returns {{re: number, im: number}} New complex number
   */
  clone(z) {
    return { re: z.re, im: z.im };
  },

  /**
   * Adds two complex numbers.
   * @param {{re: number, im: number}} a - First operand
   * @param {{re: number, im: number}} b - Second operand
   * @returns {{re: number, im: number}} Sum a + b
   */
  add(a, b) {
    return { re: a.re + b.re, im: a.im + b.im };
  },

  /**
   * Subtracts two complex numbers.
   * @param {{re: number, im: number}} a - First operand
   * @param {{re: number, im: number}} b - Second operand
   * @returns {{re: number, im: number}} Difference a - b
   */
  sub(a, b) {
    return { re: a.re - b.re, im: a.im - b.im };
  },

  /**
   * Multiplies two complex numbers.
   * @param {{re: number, im: number}} a - First operand
   * @param {{re: number, im: number}} b - Second operand
   * @returns {{re: number, im: number}} Product a * b
   */
  mul(a, b) {
    return {
      re: a.re * b.re - a.im * b.im,
      im: a.re * b.im + a.im * b.re,
    };
  },

  mulScalar(a, s) {
    return { re: a.re * s, im: a.im * s };
  },

  div(a, b) {
    const denom = b.re * b.re + b.im * b.im;
    if (denom === 0) {
      throw new Error('Division by zero in complex division');
    }
    return {
      re: (a.re * b.re + a.im * b.im) / denom,
      im: (a.im * b.re - a.re * b.im) / denom,
    };
  },

  abs(a) {
    return Math.hypot(a.re, a.im);
  },

  angle(a) {
    return Math.atan2(a.im, a.re);
  },

  expi(theta) {
    return { re: Math.cos(theta), im: Math.sin(theta) };
  },

  conj(a) {
    return { re: a.re, im: -a.im };
  },

  equals(a, b, tol = 1e-9) {
    return Complex.abs(Complex.sub(a, b)) <= tol;
  },
};

Complex.ZERO = { re: 0, im: 0 };

function complexFrom(value) {
  if (typeof value === 'number') {
    return { re: value, im: 0 };
  }
  return value;
}

// ------------------------------------------------------------
// Utility helpers
// ------------------------------------------------------------

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function degToRad(angleDeg) {
  return (angleDeg * Math.PI) / 180;
}

function seededRandom(seed) {
  // Mulberry32 PRNG – deterministic for the same seed.
  let t = (seed + 0x6d2b79f5) >>> 0;
  return function () {
    t |= 0;
    t = (t + 0x6d2b79f5) | 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function colorFromSeed(seed) {
  const rng = seededRandom(seed);
  const r = Math.floor(rng() * 256);
  const g = Math.floor(rng() * 256);
  const b = Math.floor(rng() * 256);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

function polygonCentroid(points) {
  if (!points.length) {
    return { x: 0, y: 0 };
  }
  let cx = 0;
  let cy = 0;
  for (const p of points) {
    cx += p.x;
    cy += p.y;
  }
  const inv = 1 / points.length;
  return { x: cx * inv, y: cy * inv };
}

function pointOnSegment(point, a, b, tolerance = 1e-9) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const cross = (point.y - a.y) * dx - (point.x - a.x) * dy;
  if (Math.abs(cross) > tolerance) {
    return false;
  }
  const dot = (point.x - a.x) * dx + (point.y - a.y) * dy;
  if (dot < -tolerance) {
    return false;
  }
  const lenSq = dx * dx + dy * dy;
  if (dot > lenSq + tolerance) {
    return false;
  }
  return true;
}

function pointOnPolygonBoundary(point, polygon, tolerance = 1e-9) {
  for (let i = 0; i < polygon.length; i += 1) {
    const a = polygon[i];
    const b = polygon[(i + 1) % polygon.length];
    if (pointOnSegment(point, a, b, tolerance)) {
      return true;
    }
  }
  return false;
}

function polygonContains(point, polygon) {
  if (pointOnPolygonBoundary(point, polygon)) {
    return true;
  }
  // Ray-casting algorithm.
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const xi = polygon[i].x;
    const yi = polygon[i].y;
    const xj = polygon[j].x;
    const yj = polygon[j].y;
    const intersect =
      yi > point.y !== yj > point.y &&
      point.x <= ((xj - xi) * (point.y - yi)) / (yj - yi + 1e-12) + xi;
    if (intersect) {
      inside = !inside;
    }
  }
  return inside;
}

function polygonSignedArea(points) {
  if (!points || points.length < 3) {
    return 0;
  }
  let area = 0;
  for (let i = 0, j = points.length - 1; i < points.length; j = i, i += 1) {
    area += points[j].x * points[i].y - points[i].x * points[j].y;
  }
  return area / 2;
}

function normaliseVector(vec) {
  const length = Math.hypot(vec.x, vec.y);
  if (length < 1e-9) {
    return null;
  }
  return { x: vec.x / length, y: vec.y / length };
}

function normaliseAngle360(angleDeg) {
  if (!Number.isFinite(angleDeg)) {
    return 0;
  }
  let value = angleDeg % 360;
  if (value < 0) {
    value += 360;
  }
  return value;
}

function normaliseAngleRad(angle) {
  if (!Number.isFinite(angle)) {
    return 0;
  }
  const twoPi = Math.PI * 2;
  let value = angle % twoPi;
  if (value < 0) {
    value += twoPi;
  }
  return value;
}

function angularDistanceRad(a, b) {
  const normA = normaliseAngleRad(a);
  const normB = normaliseAngleRad(b);
  const diff = Math.abs(normA - normB);
  const twoPi = Math.PI * 2;
  return Math.min(diff, twoPi - diff);
}

function dedupeAngles(values, maxCount = 3) {
  const seen = new Set();
  const result = [];
  for (const value of values) {
    if (!Number.isFinite(value)) {
      continue;
    }
    const normalized = normaliseAngle360(value);
    const key = normalized.toFixed(6);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(value);
    if (result.length >= maxCount) {
      break;
    }
  }
  return result;
}

function buildPatternAnimationContext(arcGroups) {
  const metaList = [];
  const ringMap = new Map();
  let minRing = Infinity;
  let maxRing = -Infinity;

  for (const group of arcGroups.values()) {
    if (!group || (group.name && group.name.startsWith('outer_'))) {
      continue;
    }
    const outline = group.getClosedOutline();
    if (!outline || outline.length < 3) {
      continue;
    }
    const polygon = outline.map(pt => ({ x: pt.re, y: pt.im }));
    const centroid = polygonCentroid(polygon);
    if (!Number.isFinite(centroid.x) || !Number.isFinite(centroid.y)) {
      continue;
    }
    const ringIndex = Number.isFinite(group.ringIndex) ? group.ringIndex : 0;
    const radius = Math.hypot(centroid.x, centroid.y);
    const theta = Math.atan2(centroid.y, centroid.x);
    const meta = {
      id: group.id,
      group,
      ringIndex,
      centroid,
      radius,
      theta,
      neighbors: new Set(),
    };
    metaList.push(meta);
    if (!ringMap.has(ringIndex)) {
      ringMap.set(ringIndex, []);
    }
    ringMap.get(ringIndex).push(meta);
    if (ringIndex < minRing) {
      minRing = ringIndex;
    }
    if (ringIndex > maxRing) {
      maxRing = ringIndex;
    }
  }

  if (!metaList.length) {
    return {
      metaList: [],
      ringMap: new Map(),
      sortedRings: [],
      minRing: 0,
      maxRing: 0,
    };
  }

  const sortedRings = Array.from(ringMap.keys()).sort((a, b) => a - b);
  for (const ring of sortedRings) {
    const metas = ringMap.get(ring);
    metas.sort((a, b) => a.theta - b.theta);
    if (metas.length > 1) {
      for (let idx = 0; idx < metas.length; idx += 1) {
        const prev = metas[(idx - 1 + metas.length) % metas.length];
        const next = metas[(idx + 1) % metas.length];
        metas[idx].neighbors.add(prev);
        metas[idx].neighbors.add(next);
      }
    }
  }

  for (let idx = 0; idx < sortedRings.length; idx += 1) {
    const current = ringMap.get(sortedRings[idx]);
    const prevRing = idx > 0 ? ringMap.get(sortedRings[idx - 1]) : null;
    const nextRing = idx < sortedRings.length - 1 ? ringMap.get(sortedRings[idx + 1]) : null;
    if (prevRing) {
      linkRingNeighbors(current, prevRing, 2);
    }
    if (nextRing) {
      linkRingNeighbors(current, nextRing, 2);
    }
  }

  return { metaList, ringMap, sortedRings, minRing, maxRing };
}

function linkRingNeighbors(source, target, maxConnections = 2) {
  if (!source || !target || !source.length || !target.length) {
    return;
  }
  for (const meta of source) {
    const sorted = target
      .slice()
      .sort((a, b) => angularDistanceRad(meta.theta, a.theta) - angularDistanceRad(meta.theta, b.theta));
    const limit = Math.min(maxConnections, sorted.length);
    for (let idx = 0; idx < limit; idx += 1) {
      const neighbor = sorted[idx];
      meta.neighbors.add(neighbor);
      neighbor.neighbors.add(meta);
    }
  }
}

function computeBreadthFirstSteps(context) {
  const seeds = context.metaList.filter(meta => meta.ringIndex === context.minRing);
  const visited = new Set();
  const steps = new Map();
  let frontier = seeds.slice();
  let step = 0;
  const maxIterations = Math.max(context.metaList.length * 4, 1);

  while (frontier.length && step < maxIterations) {
    const next = [];
    for (const meta of frontier) {
      if (visited.has(meta)) {
        continue;
      }
      visited.add(meta);
      steps.set(meta.id, step);
    }
    for (const meta of frontier) {
      for (const neighbor of meta.neighbors) {
        if (!visited.has(neighbor)) {
          next.push(neighbor);
        }
      }
    }
    frontier = next;
    step += 1;
  }

  if (steps.size < context.metaList.length) {
    let fallbackStep = step;
    for (const meta of context.metaList) {
      if (steps.has(meta.id)) {
        continue;
      }
      steps.set(meta.id, fallbackStep);
      fallbackStep += 1;
    }
    step = fallbackStep;
  }

  const maxStep = steps.size ? Math.max(...steps.values()) : 0;
  return { steps, maxStep, seeds };
}

function patternAnimationRingCycle(context, opts = {}) {
  const assignments = new Map();
  const baseAngle = Number.isFinite(opts.baseAngle) ? opts.baseAngle : 0;
  for (const ring of context.sortedRings) {
    const metas = context.ringMap.get(ring) || [];
    metas.forEach((meta, index) => {
      const angle = ring * baseAngle + index * 8;
      assignments.set(meta.id, { primaryAngle: angle, angles: [angle] });
    });
  }
  return assignments;
}

function patternAnimationRingPingPong(context, opts = {}) {
  const assignments = new Map();
  const baseAngle = Number.isFinite(opts.baseAngle) ? opts.baseAngle : 0;
  for (const ring of context.sortedRings) {
    const metas = (context.ringMap.get(ring) || []).slice();
    const direction = ring % 2 === 0 ? 1 : -1;
    if (direction < 0) {
      metas.reverse();
    }
    metas.forEach((meta, index) => {
      const angle = ring * baseAngle + index * 10 + (direction < 0 ? 5 : 0);
      assignments.set(meta.id, { primaryAngle: angle, angles: [angle] });
    });
  }
  return assignments;
}

function patternAnimationRadialBloom(context, opts = {}) {
  const assignments = new Map();
  const baseAngle = Number.isFinite(opts.baseAngle) ? opts.baseAngle : 0;
  const maxRadius = context.metaList.reduce((acc, meta) => Math.max(acc, meta.radius), 0) || 1;
  context.metaList.forEach(meta => {
    const radiusRatio = meta.radius / maxRadius;
    const wobble = Math.sin(normaliseAngleRad(meta.theta) * 3) * 5;
    const angle = meta.ringIndex * baseAngle + radiusRatio * 90 + wobble;
    assignments.set(meta.id, { primaryAngle: angle, angles: [angle] });
  });
  return assignments;
}

function patternAnimationCAWavefront(context, opts = {}) {
  const assignments = new Map();
  const baseAngle = Number.isFinite(opts.baseAngle) ? opts.baseAngle : 0;
  const { steps } = computeBreadthFirstSteps(context);
  const stepGap = 12;
  context.metaList.forEach(meta => {
    const step = steps.get(meta.id) ?? 0;
    const jitter = (meta.neighbors.size % 3) * 2;
    const angle = meta.ringIndex * baseAngle + step * stepGap + jitter;
    assignments.set(meta.id, { primaryAngle: angle, angles: [angle] });
  });
  return assignments;
}

/**
 * Spiral vortex: angles follow the polar angle (theta) creating a spinning vortex effect.
 * Groups at the same angular position light up together, creating radial spokes that rotate.
 */
function patternAnimationSpiralVortex(context, opts = {}) {
  const assignments = new Map();
  const baseAngle = Number.isFinite(opts.baseAngle) ? opts.baseAngle : 0;
  context.metaList.forEach(meta => {
    // Convert theta to degrees and use it directly for angle
    const thetaDeg = normaliseAngle360(meta.theta * (180 / Math.PI));
    // Add ring-based offset for depth effect
    const ringOffset = meta.ringIndex * 3;
    const angle = thetaDeg + ringOffset + meta.ringIndex * baseAngle;
    assignments.set(meta.id, { primaryAngle: angle, angles: [angle] });
  });
  return assignments;
}

/**
 * Diamond pulse: creates a diamond/checkerboard pattern that pulses outward.
 * Alternates based on ring index and position within ring.
 */
function patternAnimationDiamondPulse(context, opts = {}) {
  const assignments = new Map();
  const baseAngle = Number.isFinite(opts.baseAngle) ? opts.baseAngle : 0;
  for (const ring of context.sortedRings) {
    const metas = context.ringMap.get(ring) || [];
    metas.forEach((meta, index) => {
      // Create checkerboard pattern: alternate based on ring + position parity
      const parity = (ring + index) % 2;
      const phase = parity * 45; // 45-degree offset between alternating cells
      const radialPulse = meta.radius * 15; // Pulse outward based on distance
      const angle = phase + radialPulse + meta.ringIndex * baseAngle;
      assignments.set(meta.id, { primaryAngle: angle, angles: [angle] });
    });
  }
  return assignments;
}

/**
 * Fibonacci spiral: angles follow a golden spiral pattern, creating organic flow.
 * Uses the golden angle (~137.5°) to distribute angles naturally.
 */
function patternAnimationFibonacciSpiral(context, opts = {}) {
  const assignments = new Map();
  const baseAngle = Number.isFinite(opts.baseAngle) ? opts.baseAngle : 0;
  const goldenAngle = 137.507764; // Golden angle in degrees

  // Sort by distance from center for consistent ordering
  const sorted = [...context.metaList].sort((a, b) => a.radius - b.radius);

  sorted.forEach((meta, index) => {
    // Each successive element rotates by the golden angle
    const fibAngle = (index * goldenAngle) % 360;
    // Add subtle ring-based variation
    const ringVar = Math.sin(meta.ringIndex * 0.5) * 10;
    const angle = fibAngle + ringVar + meta.ringIndex * baseAngle;
    assignments.set(meta.id, { primaryAngle: angle, angles: [angle] });
  });
  return assignments;
}

const PATTERN_ANIMATION_DEFINITIONS = {
  radial_bloom: { label: 'Radial bloom', generator: patternAnimationRadialBloom },
  ring_cycle: { label: 'Ring cycle chase', generator: patternAnimationRingCycle },
  ring_pingpong: { label: 'Alternating ring sweep', generator: patternAnimationRingPingPong },
  ca_wavefront: { label: 'Cellular wavefront', generator: patternAnimationCAWavefront },
  spiral_vortex: { label: 'Spiral vortex', generator: patternAnimationSpiralVortex },
  diamond_pulse: { label: 'Diamond pulse', generator: patternAnimationDiamondPulse },
  fibonacci_spiral: { label: 'Fibonacci spiral', generator: patternAnimationFibonacciSpiral },
};

const DEFAULT_PATTERN_ANIMATION = 'radial_bloom';

function normalisePatternAnimationId(value) {
  if (typeof value !== 'string') {
    return DEFAULT_PATTERN_ANIMATION;
  }
  const key = value.toLowerCase();
  return PATTERN_ANIMATION_DEFINITIONS[key] ? key : DEFAULT_PATTERN_ANIMATION;
}

function applyPatternAnimationToGroups(arcGroups, { animationId, baseAngle } = {}) {
  if (!arcGroups || typeof arcGroups.values !== 'function') {
    return new Map();
  }
  const resolvedId = normalisePatternAnimationId(animationId);
  const context = buildPatternAnimationContext(arcGroups);
  const baseAngleValue = Number.isFinite(baseAngle) ? baseAngle : 0;
  const generator = PATTERN_ANIMATION_DEFINITIONS[resolvedId]?.generator
    || PATTERN_ANIMATION_DEFINITIONS[DEFAULT_PATTERN_ANIMATION].generator;
  const rawAssignments = generator(context, {
    baseAngle: baseAngleValue,
  }) || new Map();
  const assignments = new Map();
  for (const meta of context.metaList) {
    const fallback = (meta.ringIndex ?? 0) * baseAngleValue;
    const entry = rawAssignments.get(meta.id) || { primaryAngle: fallback, angles: [fallback] };
    let angleList = Array.isArray(entry.angles) ? entry.angles.slice() : [];
    if (!angleList.length && Number.isFinite(entry.primaryAngle)) {
      angleList.push(entry.primaryAngle);
    }
    if (!angleList.length) {
      angleList.push(fallback);
    }
    const deduped = dedupeAngles(angleList, 3);
    const primary = Number.isFinite(entry.primaryAngle) ? entry.primaryAngle : deduped[0];
    assignments.set(meta.id, {
      primaryAngle: Number.isFinite(primary) ? primary : fallback,
      angles: deduped.length ? deduped : [fallback],
    });
  }
  return assignments;
}

function inwardNormal(direction, orientationSign) {
  if (orientationSign >= 0) {
    return { x: -direction.y, y: direction.x };
  }
  return { x: direction.y, y: -direction.x };
}

function intersectLines(point1, dir1, point2, dir2) {
  const det = dir1.x * dir2.y - dir1.y * dir2.x;
  if (Math.abs(det) < 1e-9) {
    return null;
  }
  const dx = point2.x - point1.x;
  const dy = point2.y - point1.y;
  const t = (dx * dir2.y - dy * dir2.x) / det;
  return {
    x: point1.x + dir1.x * t,
    y: point1.y + dir1.y * t,
  };
}

function sanitisePolygonPoints(points, tolerance = 1e-9) {
  if (!Array.isArray(points)) {
    return [];
  }
  const result = [];
  for (const pt of points) {
    if (!pt) {
      continue;
    }
    const current = { x: pt.x, y: pt.y };
    const previous = result[result.length - 1];
    if (previous && Math.hypot(current.x - previous.x, current.y - previous.y) <= tolerance) {
      continue;
    }
    result.push(current);
  }
  if (result.length > 1) {
    const first = result[0];
    const last = result[result.length - 1];
    if (Math.hypot(first.x - last.x, first.y - last.y) <= tolerance) {
      result.pop();
    }
  }
  return result;
}

function insetPolygon(points, offset) {
  if (!offset || offset <= 0) {
    return sanitisePolygonPoints(points);
  }

  const base = sanitisePolygonPoints(points);
  if (base.length < 3) {
    return [];
  }

  const orientation = polygonSignedArea(base) >= 0 ? 1 : -1;
  const insetPoints = [];
  const count = base.length;

  for (let i = 0; i < count; i += 1) {
    const prev = base[(i - 1 + count) % count];
    const curr = base[i];
    const next = base[(i + 1) % count];

    const prevDir = normaliseVector({ x: curr.x - prev.x, y: curr.y - prev.y });
    const nextDir = normaliseVector({ x: next.x - curr.x, y: next.y - curr.y });

    let normalPrev = prevDir ? inwardNormal(prevDir, orientation) : null;
    let normalNext = nextDir ? inwardNormal(nextDir, orientation) : null;

    if (!normalPrev && !normalNext) {
      insetPoints.push({ x: curr.x, y: curr.y });
      continue;
    }

    if (!normalPrev) {
      normalPrev = normalNext;
    }
    if (!normalNext) {
      normalNext = normalPrev;
    }

    const dir1 = prevDir || nextDir || { x: 1, y: 0 };
    const dir2 = nextDir || prevDir || { x: 0, y: 1 };

    const shiftedPrev = {
      x: curr.x + normalPrev.x * offset,
      y: curr.y + normalPrev.y * offset,
    };
    const shiftedNext = {
      x: curr.x + normalNext.x * offset,
      y: curr.y + normalNext.y * offset,
    };

    const intersection = intersectLines(shiftedPrev, dir1, shiftedNext, dir2);
    if (intersection) {
      insetPoints.push(intersection);
    } else {
      const avg = normaliseVector({
        x: normalPrev.x + normalNext.x,
        y: normalPrev.y + normalNext.y,
      });
      if (avg) {
        insetPoints.push({
          x: curr.x + avg.x * offset,
          y: curr.y + avg.y * offset,
        });
      }
    }
  }

  const cleaned = sanitisePolygonPoints(insetPoints);
  if (cleaned.length < 3) {
    return [];
  }
  if (Math.abs(polygonSignedArea(cleaned)) < 1e-6) {
    return [];
  }
  return cleaned;
}

function estimateArcSteps(circle, start, end) {
  if (!circle || circle.radius <= 0 || !start || !end) {
    return 12;
  }
  const center = circle.center || Complex.ZERO;
  const startAngle = Complex.angle(Complex.sub(start, center));
  const endAngle = Complex.angle(Complex.sub(end, center));
  let delta = (endAngle - startAngle) % (2 * Math.PI);
  if (delta < 0) {
    delta += 2 * Math.PI;
  }
  if (delta > Math.PI) {
    delta = 2 * Math.PI - delta;
  }
  const arcLength = Math.abs(delta) * circle.radius;
  if (!Number.isFinite(arcLength) || arcLength <= 0) {
    return 12;
  }
  const desiredSegmentLength = clamp(
    circle.radius * ARC_SEGMENT_RATIO,
    MIN_ARC_SEGMENT_LENGTH,
    MAX_ARC_SEGMENT_LENGTH
  );
  const rawSteps = Math.ceil(arcLength / desiredSegmentLength);
  return clamp(rawSteps, MIN_ARC_STEPS, MAX_ARC_STEPS);
}

function lineSegmentIntersection(p1, p2, p3, p4) {
  const x1 = p1.x;
  const y1 = p1.y;
  const x2 = p2.x;
  const y2 = p2.y;
  const x3 = p3.x;
  const y3 = p3.y;
  const x4 = p4.x;
  const y4 = p4.y;

  const denom = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
  if (Math.abs(denom) < 1e-12) {
    return null;
  }

  const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / denom;
  const u = -((x1 - x2) * (y1 - y3) - (y1 - y2) * (x1 - x3)) / denom;

  if (t < -1e-9 || t > 1 + 1e-9 || u < -1e-9 || u > 1 + 1e-9) {
    return null;
  }

  return {
    t,
    point: {
      x: x1 + t * (x2 - x1),
      y: y1 + t * (y2 - y1),
    },
  };
}

function findLinePolygonIntersections(start, end, polygon, lineDir, orientation) {
  const intersections = [];
  for (let i = 0; i < polygon.length; i += 1) {
    const p3 = polygon[i];
    const p4 = polygon[(i + 1) % polygon.length];
    const intersection = lineSegmentIntersection(start, end, p3, p4);
    if (intersection) {
      const edgeDir = { x: p4.x - p3.x, y: p4.y - p3.y };
      const edgeUnit = normaliseVector(edgeDir);
      if (!edgeUnit) {
        continue;
      }
      const inward = inwardNormal(edgeUnit, orientation);
      const dot = inward.x * lineDir.x + inward.y * lineDir.y;
      if (Math.abs(dot) <= 1e-9) {
        continue;
      }
      const classification = dot > 0 ? 1 : -1;
      intersections.push({
        ...intersection,
        edgeIndex: i,
        classification,
      });
    }
  }
  const ORDER_TOL = 1e-10;
  intersections.sort((a, b) => {
    const diff = a.t - b.t;
    if (Math.abs(diff) <= ORDER_TOL) {
      return b.classification - a.classification;
    }
    return diff;
  });
  return intersections;
}

function linesInPolygon(polygonPoints, spacing, angleDeg, offset = 0) {
  if (!polygonPoints || polygonPoints.length < 3) {
    return [];
  }

  const spacingAbs = Math.abs(spacing);
  if (spacingAbs < 1e-9) {
    return [];
  }

  const working = insetPolygon(polygonPoints, offset);
  if (!working || working.length < 3) {
    return [];
  }

  const angle = degToRad(angleDeg);
  const cosAngle = Math.cos(angle);
  const sinAngle = Math.sin(angle);

  const rotatePoint = point => ({
    x: point.x * cosAngle + point.y * sinAngle,
    y: -point.x * sinAngle + point.y * cosAngle,
  });

  const unrotatePoint = point => ({
    x: point.x * cosAngle - point.y * sinAngle,
    y: point.x * sinAngle + point.y * cosAngle,
  });

  const rotated = working.map(rotatePoint);
  const centroid = polygonCentroid(working);
  const centroidRot = rotatePoint(centroid);

  let minY = Infinity;
  let maxY = -Infinity;
  for (const pt of rotated) {
    if (pt.y < minY) {
      minY = pt.y;
    }
    if (pt.y > maxY) {
      maxY = pt.y;
    }
  }

  if (!Number.isFinite(minY) || !Number.isFinite(maxY) || maxY - minY < 1e-9) {
    return [];
  }

  const edges = [];
  const count = rotated.length;
  for (let i = 0; i < count; i += 1) {
    const a = rotated[i];
    const b = rotated[(i + 1) % count];
    const dy = b.y - a.y;
    if (Math.abs(dy) < 1e-9) {
      continue;
    }
    const minEdgeY = Math.min(a.y, b.y);
    const maxEdgeY = Math.max(a.y, b.y);
    edges.push({
      x1: a.x,
      y1: a.y,
      dx: b.x - a.x,
      dy,
      invDy: 1 / dy,
      minY: minEdgeY,
      maxY: maxEdgeY,
    });
  }

  if (!edges.length) {
    return [];
  }

  const effectiveSpacing = Math.max(spacingAbs, 1e-6);
  const startIndex = Math.floor((minY - centroidRot.y) / effectiveSpacing) - 1;
  const endIndex = Math.ceil((maxY - centroidRot.y) / effectiveSpacing) + 1;

  const segments = [];
  for (let idx = startIndex; idx <= endIndex; idx += 1) {
    const yLine = centroidRot.y + idx * effectiveSpacing;
    if (yLine < minY - effectiveSpacing || yLine > maxY + effectiveSpacing) {
      continue;
    }

    const intersections = [];
    for (const edge of edges) {
      if (yLine < edge.minY || yLine >= edge.maxY) {
        continue;
      }
      const t = (yLine - edge.y1) * edge.invDy;
      const x = edge.x1 + edge.dx * t;
      intersections.push(x);
    }

    if (intersections.length < 2) {
      continue;
    }

    intersections.sort((a, b) => a - b);

    for (let i = 0; i + 1 < intersections.length; i += 2) {
      const xStart = intersections[i];
      const xEnd = intersections[i + 1];
      if (!Number.isFinite(xStart) || !Number.isFinite(xEnd)) {
        continue;
      }
      if (Math.abs(xStart - xEnd) < 1e-6) {
        continue;
      }

      const startPoint = unrotatePoint({ x: xStart, y: yLine });
      const endPoint = unrotatePoint({ x: xEnd, y: yLine });
      segments.push([
        { x: startPoint.x, y: startPoint.y },
        { x: endPoint.x, y: endPoint.y },
      ]);
    }
  }

  return segments;
}

// ------------------------------------------------------------
// Geometry primitives
// ------------------------------------------------------------

let CIRCLE_ID = 0;

class CircleElement {
  constructor(center, radius, visible = true) {
    this.center = complexFrom(center);
    this.radius = radius;
    this.visible = visible;
    this.id = ++CIRCLE_ID;
    this.intersections = [];
    this.neighbours = new Set();
    this._intersectionKeys = null;
    this._orderedNeighbours = null;
  }

  _getIntersectionPoints(other, tol = 1e-6) {
    const x1 = this.center.re;
    const y1 = this.center.im;
    const x2 = other.center.re;
    const y2 = other.center.im;
    const dx = x2 - x1;
    const dy = y2 - y1;
    const dSq = dx * dx + dy * dy;
    const d = Math.sqrt(dSq);
    const r1 = this.radius;
    const r2 = other.radius;
    if (d > r1 + r2 + tol || d < Math.abs(r1 - r2) - tol || d < tol) {
      return [];
    }
    const a = (r1 * r1 - r2 * r2 + dSq) / (2 * d);
    const hSq = r1 * r1 - a * a;
    if (hSq < -tol) {
      return [];
    }
    const h = Math.sqrt(Math.max(hSq, 0));
    const ratio = a / d;
    const midX = x1 + dx * ratio;
    const midY = y1 + dy * ratio;
    const invD = d === 0 ? 0 : 1 / d;
    const ux = dx * invD;
    const uy = dy * invD;
    const perpX = -uy;
    const perpY = ux;
    const p1 = { re: midX + perpX * h, im: midY + perpY * h };
    if (h < tol) {
      return [p1];
    }
    const p2 = { re: midX - perpX * h, im: midY - perpY * h };
    return [p1, p2];
  }

  resetIntersections() {
    this.intersections = [];
    this.neighbours.clear();
    this._intersectionKeys = new Set();
    this._orderedNeighbours = null;
  }

  addIntersection(point, other) {
    if (!point || !other || !this._intersectionKeys) {
      return;
    }
    const key = `${point.re.toFixed(6)}_${point.im.toFixed(6)}`;
    if (this._intersectionKeys.has(key)) {
      return;
    }
    this._intersectionKeys.add(key);
    this.intersections.push([point, other]);
    this.neighbours.add(other);
  }

  finalizeIntersections(startReference = Complex.ZERO) {
    if (!this.intersections.length) {
      this._intersectionKeys = null;
      return;
    }

    const c = this.center;
    const reference = startReference || c;
    let startIdx = 0;
    let minDist = Infinity;
    for (let i = 0; i < this.intersections.length; i += 1) {
      const dist = Complex.abs(Complex.sub(this.intersections[i][0], reference));
      if (dist < minDist) {
        minDist = dist;
        startIdx = i;
      }
    }
    const startPoint = this.intersections[startIdx][0];
    const startAngle = Complex.angle(Complex.sub(startPoint, c));

    const clockwiseOffset = (angle) => {
      const offset = (startAngle - angle) % (2 * Math.PI);
      return offset < 0 ? offset + 2 * Math.PI : offset;
    };

    this.intersections.sort((a, b) => {
      const angA = Complex.angle(Complex.sub(a[0], c));
      const angB = Complex.angle(Complex.sub(b[0], c));
      return clockwiseOffset(angA) - clockwiseOffset(angB);
    });

    this._intersectionKeys = null;
  }

  computeIntersections(circles, startReference = Complex.ZERO, tol = 1e-3) {
    this.resetIntersections();

    for (const other of circles) {
      if (other === this) {
        continue;
      }
      const pts = this._getIntersectionPoints(other, tol);
      for (const pt of pts) {
        this.addIntersection(pt, other);
      }
    }

    this.finalizeIntersections(startReference);
  }

  getNeighbourCircles(k = null, spiralCenter = Complex.ZERO, clockwise = true, tieByDistance = true) {
    let neighbours = Array.from(this.neighbours);
    if (!neighbours.length) {
      return [];
    }
    const scRe = (spiralCenter && spiralCenter.re) || 0;
    const scIm = (spiralCenter && spiralCenter.im) || 0;
    const cacheable =
      k === null &&
      clockwise === true &&
      tieByDistance === true &&
      Math.abs(scRe) < 1e-9 &&
      Math.abs(scIm) < 1e-9;
    if (cacheable && this._orderedNeighbours) {
      return this._orderedNeighbours;
    }
    if (k !== null && neighbours.length > k) {
      neighbours.sort((a, b) => {
        const da = Complex.abs(Complex.sub(a.center, this.center));
        const db = Complex.abs(Complex.sub(b.center, this.center));
        return da - db;
      });
      neighbours = neighbours.slice(0, k);
    }
    const baseAngle = Complex.angle(Complex.sub(this.center, spiralCenter));
    const relativeAngle = (circle) => {
      const angle = Complex.angle(Complex.sub(circle.center, spiralCenter));
      let rel = (angle - baseAngle) % (2 * Math.PI);
      if (rel < 0) {
        rel += 2 * Math.PI;
      }
      return rel;
    };
    neighbours.sort((a, b) => {
      const ra = relativeAngle(a);
      const rb = relativeAngle(b);
      if (tieByDistance && Math.abs(ra - rb) < 1e-9) {
        const da = Complex.abs(Complex.sub(a.center, this.center));
        const db = Complex.abs(Complex.sub(b.center, this.center));
        return da - db;
      }
      return ra - rb;
    });
    if (clockwise) {
      neighbours.reverse();
    }
    if (cacheable) {
      this._orderedNeighbours = neighbours;
    }
    return neighbours;
  }
}

class ArcElement {
  static _shapeCache = new Map();

  static _shapeKey(steps, delta) {
    const quantised = Math.round(delta * 1e9) / 1e9;
    return `${steps}|${quantised}`;
  }

  static _getShape(steps, delta) {
    const key = ArcElement._shapeKey(steps, delta);
    if (ArcElement._shapeCache.has(key)) {
      return ArcElement._shapeCache.get(key);
    }
    const count = Math.max(1, steps | 0);
    const coords = new Float64Array(count * 2);
    if (count === 1) {
      coords[0] = 1;
      coords[1] = 0;
    } else {
      for (let i = 0; i < count; i += 1) {
        const t = i / (count - 1);
        const angle = delta * t;
        coords[i * 2] = Math.cos(angle);
        coords[i * 2 + 1] = Math.sin(angle);
      }
    }
    ArcElement._shapeCache.set(key, coords);
    return coords;
  }

  constructor(circle, start, end, steps = 40, visible = true) {
    this.circle = circle;
    this.start = complexFrom(start);
    this.end = complexFrom(end);
    this.steps = Math.max(1, steps | 0);
    this.visible = visible;
    this._pointsCache = null;
    this._template = null;
  }

  _invalidate() {
    this._pointsCache = null;
  }

  setStart(value) {
    const newValue = complexFrom(value);
    if (!this.start || !Complex.equals(this.start, newValue)) {
      this.start = newValue;
      this._invalidate();
    }
  }

  setEnd(value) {
    const newValue = complexFrom(value);
    if (!this.end || !Complex.equals(this.end, newValue)) {
      this.end = newValue;
      this._invalidate();
    }
  }

  setSteps(value) {
    const newValue = Math.max(1, value | 0);
    if (this.steps !== newValue) {
      this.steps = newValue;
      this._invalidate();
    }
  }

  applyTemplate(template, transform, arcIndex, { preserveCache = false } = {}) {
    if (!template || !transform || typeof arcIndex !== 'number') {
      this._template = null;
      if (!preserveCache) {
        this._invalidate();
      }
      return;
    }
    this._template = { template, transform, arcIndex };
    if (!preserveCache) {
      this._invalidate();
    }
  }

  getPoints() {
    if (this._pointsCache) {
      return this._pointsCache;
    }
    if (this._template) {
      const { template, transform, arcIndex } = this._template;
      const bases = template?.normalizedArcs?.[arcIndex];
      if (!bases || !transform) {
        this._template = null;
      } else {
        const { cos, sin, radius, center } = transform;
        const total = bases.length / 2;
        const points = new Array(total);
        for (let idx = 0; idx < bases.length; idx += 2) {
          const x = bases[idx];
          const y = bases[idx + 1];
          const rx = x * cos - y * sin;
          const ry = x * sin + y * cos;
          points[idx / 2] = {
            re: center.re + rx * radius,
            im: center.im + ry * radius,
          };
        }
        this._pointsCache = points;
        return points;
      }
    }
    const c = this.circle.center;
    const r = this.circle.radius;
    const a1 = Complex.angle(Complex.sub(this.start, c));
    const a2 = Complex.angle(Complex.sub(this.end, c));
    let delta = (a2 - a1 + 2 * Math.PI) % (2 * Math.PI);
    if (delta > Math.PI) {
      delta -= 2 * Math.PI;
    }
    const templatePoints = ArcElement._getShape(this.steps, delta);
    const cosA = Math.cos(a1);
    const sinA = Math.sin(a1);
    const points = new Array(templatePoints.length / 2);
    for (let idx = 0; idx < templatePoints.length; idx += 2) {
      const baseX = templatePoints[idx];
      const baseY = templatePoints[idx + 1];
      const rotX = baseX * cosA - baseY * sinA;
      const rotY = baseX * sinA + baseY * cosA;
      points[idx / 2] = {
        re: c.re + rotX * r,
        im: c.im + rotY * r,
      };
    }
    this._pointsCache = points;
    return points;
  }
}

class ArcGroup {
  static _idCounter = 0;

  constructor(name = null) {
    ArcGroup._idCounter += 1;
    this.id = ArcGroup._idCounter;
    this.name = name || `arcgroup_${this.id}`;
    this.arcs = [];
    this.debugFill = null;
    this.debugStroke = null;
    this.ringIndex = null;
    this.baseCircle = null;
    this._outlineCache = null;
    this._patternSegmentsCache = new Map();
    this.template = null;
    this.templateTransform = null;
    this.patternAngles = [];
    this.primaryPatternAngle = 0;
    this.cloneOf = null; // Reference to master group for symmetric optimization
    this._rotationCache = null; // Cache for rotation parameters (cos, sin, angle)
  }

  addArc(arc) {
    this.arcs.push(arc);
    this._outlineCache = null;
    if (this._patternSegmentsCache) {
      this._patternSegmentsCache.clear();
    }
  }

  extend(arcs) {
    for (const arc of arcs) {
      this.addArc(arc);
    }
  }

  isEmpty() {
    return this.arcs.length === 0;
  }

  setTemplate(template, transform, preserveCache = false) {
    this.template = template || null;
    this.templateTransform = transform || null;
    if (!preserveCache) {
      this._outlineCache = null;
      if (this._patternSegmentsCache) {
        this._patternSegmentsCache.clear();
      }
    }
  }

  _matchPoints(a, b, tol = 1e-6) {
    return Complex.abs(Complex.sub(a, b)) <= tol;
  }

  _tryAttachArc(ordered, pts, tol) {
    if (!ordered.length || !pts.length) {
      return null;
    }
    const startExisting = ordered[0];
    const endExisting = ordered[ordered.length - 1];
    const startArc = pts[0];
    const endArc = pts[pts.length - 1];

    if (this._matchPoints(endExisting, startArc, tol)) {
      return ordered.concat(pts.slice(1));
    }
    if (this._matchPoints(endExisting, endArc, tol)) {
      const reversed = pts.slice().reverse();
      return ordered.concat(reversed.slice(1));
    }
    if (this._matchPoints(startExisting, endArc, tol)) {
      return pts.slice(0, -1).concat(ordered);
    }
    if (this._matchPoints(startExisting, startArc, tol)) {
      const reversed = pts.slice().reverse();
      return reversed.slice(0, -1).concat(ordered);
    }
    return null;
  }

  _attachByProximity(ordered, pts) {
    if (!ordered.length) {
      return pts.slice();
    }
    const front = ordered[0];
    const back = ordered[ordered.length - 1];
    const start = pts[0];
    const end = pts[pts.length - 1];

    const dFront = Math.min(
      Complex.abs(Complex.sub(start, front)),
      Complex.abs(Complex.sub(end, front)),
    );
    const dBack = Math.min(
      Complex.abs(Complex.sub(start, back)),
      Complex.abs(Complex.sub(end, back)),
    );

    if (dFront < dBack) {
      if (Complex.abs(Complex.sub(end, front)) <= Complex.abs(Complex.sub(start, front))) {
        return pts.slice(0, -1).concat(ordered);
      }
      const reversed = pts.slice().reverse();
      return reversed.slice(0, -1).concat(ordered);
    }

    if (Complex.abs(Complex.sub(start, back)) <= Complex.abs(Complex.sub(end, back))) {
      return ordered.concat(pts.slice(1));
    }
    const reversed = pts.slice().reverse();
    return ordered.concat(reversed.slice(1));
  }

  getClosedOutline(tol = INTERSECTION_TOLERANCE) {
    if (this._outlineCache) {
      return this._outlineCache.slice();
    }

    // Symmetric optimization: if this is a clone, compute rotated version of master outline
    if (this.cloneOf && this.baseCircle && this.cloneOf.baseCircle) {
      const masterOutline = this.cloneOf.getClosedOutline(tol);
      if (masterOutline && masterOutline.length > 0) {
        // Cache rotation parameters to avoid recomputation
        if (!this._rotationCache) {
          const masterCenter = this.cloneOf.baseCircle.center;
          const myCenter = this.baseCircle.center;
          const masterAngle = Math.atan2(masterCenter.im, masterCenter.re);
          const myAngle = Math.atan2(myCenter.im, myCenter.re);
          const rotationAngle = myAngle - masterAngle;
          this._rotationCache = {
            angle: rotationAngle,
            cos: Math.cos(rotationAngle),
            sin: Math.sin(rotationAngle)
          };
        }

        const { cos: cosTheta, sin: sinTheta } = this._rotationCache;

        // Apply rotation to each point
        const rotatedOutline = [];
        for (const pt of masterOutline) {
          rotatedOutline.push({
            re: pt.re * cosTheta - pt.im * sinTheta,
            im: pt.re * sinTheta + pt.im * cosTheta
          });
        }

        this._outlineCache = rotatedOutline.slice();
        return rotatedOutline.slice();
      }
    }

    const templateArcCount = this.template?.arcPointCounts?.length
      ?? this.template?.normalizedArcs?.length
      ?? null;
    const useTemplate =
      this.template
      && this.templateTransform
      && this.template.normalizedOutline
      && templateArcCount !== null
      && templateArcCount === this.arcs.length;

    if (useTemplate) {
      const { normalizedOutline } = this.template;
      const { cos, sin, radius, center } = this.templateTransform;
      const points = [];
      for (let idx = 0; idx < normalizedOutline.length; idx += 2) {
        const x = normalizedOutline[idx];
        const y = normalizedOutline[idx + 1];
        const rx = x * cos - y * sin;
        const ry = x * sin + y * cos;
        points.push({ re: center.re + rx * radius, im: center.im + ry * radius });
      }
      this._outlineCache = points.slice();
      return points.slice();
    }
    if (!this.arcs.length) {
      return [];
    }
    const entries = this.arcs.map(arc => ({ arc, points: arc.getPoints().slice() }));
    entries.sort((a, b) => b.points.length - a.points.length);

    let ordered = entries[0].points.slice();
    const used = new Set([0]);

    while (true) {
      let attached = false;
      for (let idx = 1; idx < entries.length; idx += 1) {
        if (used.has(idx)) {
          continue;
        }
        const result = this._tryAttachArc(ordered, entries[idx].points, tol);
        if (result) {
          ordered = result;
          used.add(idx);
          attached = true;
          break;
        }
      }
      if (!attached) {
        break;
      }
    }

    for (let idx = 0; idx < entries.length; idx += 1) {
      if (used.has(idx)) {
        continue;
      }
      ordered = this._attachByProximity(ordered, entries[idx].points);
    }

    if (ordered.length && this._matchPoints(ordered[0], ordered[ordered.length - 1], tol)) {
      ordered[ordered.length - 1] = ordered[0];
    }

    this._outlineCache = ordered.slice();
    return ordered.slice();
  }

  _getPatternSegments(spacing, angleDeg, offset) {
    // Symmetric optimization: if this is a clone, rotate master's pattern segments
    if (this.cloneOf && this._rotationCache) {
      const masterSegments = this.cloneOf._getPatternSegments(spacing, angleDeg, offset);
      if (masterSegments && masterSegments.length > 0) {
        const { cos, sin } = this._rotationCache;
        const rotated = [];
        for (let i = 0; i < masterSegments.length; i++) {
          const [start, end] = masterSegments[i];
          rotated.push([
            { re: start.re * cos - start.im * sin, im: start.re * sin + start.im * cos },
            { re: end.re * cos - end.im * sin, im: end.re * sin + end.im * cos },
          ]);
        }
        return rotated;
      }
    }

    const template = this.template;
    const transform = this.templateTransform;
    if (!template || !transform) {
      return null;
    }
    const normalized = template.normalizedOutline;
    if (!normalized || !normalized.length) {
      return null;
    }
    const baseRadius =
      template.baseRadius ||
      transform.radius ||
      this.baseCircle?.radius ||
      this.arcs[0]?.circle?.radius ||
      null;
    if (!baseRadius || Math.abs(baseRadius) < 1e-9) {
      return null;
    }
    if (!template.patternCache) {
      template.patternCache = new Map();
    }
    if (!this._patternSegmentsCache) {
      this._patternSegmentsCache = new Map();
    }
    const rotationDeg =
      Math.atan2(transform.sin ?? 0, transform.cos ?? 1) * (180 / Math.PI);

    const a = angleDeg - rotationDeg;
    const normalizedAngleDeg = ((a % 180) + 180) % 180;

    const key = `${spacing.toFixed(6)}|${normalizedAngleDeg.toFixed(6)}|${offset.toFixed(6)}`;
    const cached = this._patternSegmentsCache.get(key);
    if (cached) {
      return cached;
    }
    let normalizedSegments = template.patternCache.get(key) || null;
    if (!normalizedSegments) {
      const transformRadius = transform.radius || baseRadius;
      const spacingNorm = spacing / baseRadius;
      const offsetClamped = Math.max(0, offset);

      if (
        !Number.isFinite(transformRadius)
        || transformRadius <= 1e-9
        || !Number.isFinite(spacingNorm)
        || Math.abs(spacingNorm) < 1e-9
      ) {
        normalizedSegments = [];
      } else {
        const insetRadius = transformRadius - offsetClamped;
        if (insetRadius <= 1e-9) {
          normalizedSegments = [];
        } else {
          const scale = insetRadius / transformRadius;
          const polygon = [];
          for (let idx = 0; idx < normalized.length; idx += 2) {
            polygon.push({ x: normalized[idx] * scale, y: normalized[idx + 1] * scale });
          }
          normalizedSegments = linesInPolygon(polygon, spacingNorm, normalizedAngleDeg, 0);
        }
      }

      if (normalizedSegments && normalizedSegments.length) {
        const filtered = [];
        for (const segment of normalizedSegments) {
          if (!segment || segment.length !== 2) {
            continue;
          }
          const [start, end] = segment;
          if (!start || !end) {
            continue;
          }
          const dx = end.x - start.x;
          const dy = end.y - start.y;
          if (!Number.isFinite(dx) || !Number.isFinite(dy)) {
            continue;
          }
          if (dx * dx + dy * dy <= 1e-12) {
            continue;
          }
          filtered.push(segment);
        }
        normalizedSegments = filtered;
      }
      template.patternCache.set(key, normalizedSegments);
    }
    if (!normalizedSegments || !normalizedSegments.length) {
      const empty = [];
      this._patternSegmentsCache.set(key, empty);
      return empty;
    }
    const { cos, sin, radius, center } = transform;
    const segments = [];
    for (let idx = 0; idx < normalizedSegments.length; idx += 1) {
      const [start, end] = normalizedSegments[idx];
      const dxNorm = end.x - start.x;
      const dyNorm = end.y - start.y;
      if (dxNorm * dxNorm + dyNorm * dyNorm <= 1e-12) {
        continue;
      }
      const sx = start.x * radius;
      const sy = start.y * radius;
      const ex = end.x * radius;
      const ey = end.y * radius;
      const p1 = {
        re: center.re + sx * cos - sy * sin,
        im: center.im + sx * sin + sy * cos,
      };
      const p2 = {
        re: center.re + ex * cos - ey * sin,
        im: center.im + ex * sin + ey * cos,
      };
      const dx = p2.re - p1.re;
      const dy = p2.im - p1.im;
      if (!Number.isFinite(dx) || !Number.isFinite(dy)) {
        continue;
      }
      if (dx * dx + dy * dy <= 1e-12) {
        continue;
      }
      segments.push([
        {
          re: p1.re,
          im: p1.im,
        },
        {
          re: p2.re,
          im: p2.im,
        },
      ]);
    }
    this._patternSegmentsCache.set(key, segments);
    return segments;
  }

  toSVGFill(context, {
    debug = false,
    fillOpacity = 0.25,
    patternFill = false,
    lineSettings = [3, 0],
    drawOutline = true,
    lineOffset = 0,
    patternType = 'lines',
    rectWidth = 2,
    patternSpacingOverride = null,
    patternOffsetOverride = null,
    outlineStrokeWidth = 0.6,
    patternStrokeWidth = 0.5,
  } = {}) {
    const outline = this.getClosedOutline();
    if (!outline.length) {
      return;
    }
    if (debug) {
      const fill = this.debugFill || colorFromSeed(this.id);
      const stroke = this.debugStroke || DEFAULT_OUTLINE_COLOR;
      context.drawGroupOutline(outline, {
        fill,
        stroke,
        strokeWidth: outlineStrokeWidth,
        fillOpacity,
      });
      return;
    }
    if (patternFill) {
      const stroke = this.debugStroke || DEFAULT_OUTLINE_COLOR;
      const [lineSpacingRaw, lineAngleDeg] = lineSettings;
      const scaleFactor = context?.scaleFactor ?? 0;
      const invScale = scaleFactor > 1e-9 ? 1 / scaleFactor : 0;
      const spacingForSegments = Number.isFinite(patternSpacingOverride)
        ? patternSpacingOverride
        : invScale > 0
          ? lineSpacingRaw * invScale
          : lineSpacingRaw;
      const offsetForSegmentsBase = Number.isFinite(patternOffsetOverride)
        ? patternOffsetOverride
        : invScale > 0
          ? lineOffset * invScale
          : lineOffset;
      let offsetForSegments = offsetForSegmentsBase;
      if (patternType === 'rectangles') {
        const rectWidthValue = Number.isFinite(rectWidth) ? Math.abs(rectWidth) : 0;
        if (rectWidthValue > 0) {
          offsetForSegments += rectWidthValue / 2;
        }
      }
      const segments = this._getPatternSegments(spacingForSegments, lineAngleDeg, offsetForSegments);
      context.drawGroupOutline(outline, {
        fill: 'pattern',
        stroke,
        strokeWidth: outlineStrokeWidth,
        linePatternSettings: [lineSpacingRaw, lineAngleDeg],
        drawOutline,
        lineOffset,
        patternSegments: segments,
        patternType,
        rectWidth,
        patternStrokeWidth,
      });
      return;
    }
    if (drawOutline) {
      context.drawGroupOutline(outline, {
        fill: null,
        stroke: DEFAULT_OUTLINE_COLOR,
        strokeWidth: outlineStrokeWidth,
      });
    }
  }
}

function buildContinuousPathsFromArcs(arcs, tol = 1e-6) {
  if (!arcs || !arcs.length) {
    return [];
  }
  const distance = (a, b) => {
    if (!a || !b) {
      return Number.POSITIVE_INFINITY;
    }
    const dx = (a.re ?? 0) - (b.re ?? 0);
    const dy = (a.im ?? 0) - (b.im ?? 0);
    return Math.hypot(dx, dy);
  };
  const dedupePoints = points => {
    if (!points || !points.length) {
      return [];
    }
    const filtered = [];
    for (const point of points) {
      if (!point) {
        continue;
      }
      if (!filtered.length || distance(filtered[filtered.length - 1], point) > tol) {
        filtered.push(point);
      }
    }
    if (
      filtered.length >= 2
      && distance(filtered[0], filtered[filtered.length - 1]) <= tol
    ) {
      filtered[filtered.length - 1] = filtered[0];
    }
    return filtered;
  };
  const entries = arcs
    .map(arc => (arc && typeof arc.getPoints === 'function' ? arc.getPoints().slice() : []))
    .map(points => points.filter(Boolean));
  const used = new Array(entries.length).fill(false);
  const sequences = [];

  for (let idx = 0; idx < entries.length; idx += 1) {
    if (used[idx] || entries[idx].length < 2) {
      continue;
    }
    used[idx] = true;
    let sequence = entries[idx].slice();
    let extended = true;
    while (extended) {
      extended = false;
      for (let j = 0; j < entries.length; j += 1) {
        if (used[j] || entries[j].length < 2) {
          continue;
        }
        const candidate = entries[j];
        const seqStart = sequence[0];
        const seqEnd = sequence[sequence.length - 1];
        const candStart = candidate[0];
        const candEnd = candidate[candidate.length - 1];
        if (distance(seqEnd, candStart) <= tol) {
          sequence = sequence.concat(candidate.slice(1));
          used[j] = true;
          extended = true;
          break;
        }
        if (distance(seqEnd, candEnd) <= tol) {
          const reversed = candidate.slice().reverse();
          sequence = sequence.concat(reversed.slice(1));
          used[j] = true;
          extended = true;
          break;
        }
        if (distance(seqStart, candEnd) <= tol) {
          sequence = candidate.slice(0, -1).concat(sequence);
          used[j] = true;
          extended = true;
          break;
        }
        if (distance(seqStart, candStart) <= tol) {
          const reversed = candidate.slice().reverse();
          sequence = reversed.slice(0, -1).concat(sequence);
          used[j] = true;
          extended = true;
          break;
        }
      }
    }
    const filtered = dedupePoints(sequence);
    if (filtered.length >= 2) {
      sequences.push(filtered);
    }
  }

  return sequences;
}

// ------------------------------------------------------------
// Drawing context
// ------------------------------------------------------------

class DrawingContext {
  constructor(width = 800, height = null, units = '') {
    const resolvedWidth = Number.isFinite(width) ? width : 800;
    const resolvedHeight = Number.isFinite(height) ? height : resolvedWidth;
    this.width = resolvedWidth;
    this.height = resolvedHeight;
    this.units = typeof units === 'string' ? units : '';
    this.scaleFactor = 1;
    this.hasDOM = typeof document !== 'undefined' && !!document.createElementNS;
    if (this.hasDOM) {
      this.svg = document.createElementNS(SVG_NS, 'svg');
      this.svg.setAttribute('xmlns', SVG_NS);
      this.svg.setAttribute('viewBox', this._viewBox());
      this.svg.setAttribute('width', this._formatLength(this.width));
      this.svg.setAttribute('height', this._formatLength(this.height));
      this.defs = document.createElementNS(SVG_NS, 'defs');
      this.mainGroup = document.createElementNS(SVG_NS, 'g');
      this.svg.appendChild(this.defs);
      this.svg.appendChild(this.mainGroup);
    } else {
      this.svg = null;
      this.defs = null;
      this.mainGroup = null;
      this._virtualDefs = [];
      this._virtualMain = [];
    }
  }

  /**
   * Calculates and sets the scale factor to normalize spiral elements to fit within the canvas.
   * The scale factor ensures the spiral maximally uses the available bounding box space.
   *
   * @param {Array} elements - Array of circle elements to normalize
   */
  setNormalizationScale(elements) {
    if (!elements || !elements.length) {
      this.scaleFactor = 1;
      return;
    }
    let maxExtent = 0;
    for (const circle of elements) {
      const z = circle.center;
      const r = circle.radius;
      maxExtent = Math.max(
        maxExtent,
        Math.abs(z.re) + r,
        Math.abs(z.im) + r,
      );
    }
    if (maxExtent === 0) {
      this.scaleFactor = 1;
      return;
    }
    const minDimension = Math.min(Math.abs(this.width), Math.abs(this.height));
    if (!Number.isFinite(minDimension) || minDimension <= 0) {
      this.scaleFactor = 1;
      return;
    }
    // Use full bounding box (divide by 2.0 instead of 2.1) to maximize space usage
    this.scaleFactor = (minDimension / 2.0) / maxExtent;
  }

  /**
   * Sets the scale factor using outer circle centers to define the bounding box.
   * The outer circles form a ring around the visible pattern, and their centers
   * define a bounding circle whose diameter determines the scale.
   *
   * @param {Array} outerCircles - Array of outer circle elements
   */
  setNormalizationScaleFromOuterCircles(outerCircles) {
    if (!outerCircles || !outerCircles.length) {
      this.scaleFactor = 1;
      return;
    }

    // Find maximum distance from origin to any outer circle center
    // This effectively finds the radius of the bounding circle
    let maxDistance = 0;
    for (const circle of outerCircles) {
      const center = circle.center;
      const dist = Math.sqrt(center.re * center.re + center.im * center.im);
      maxDistance = Math.max(maxDistance, dist);
    }

    if (maxDistance === 0) {
      this.scaleFactor = 1;
      return;
    }

    const minDimension = Math.min(Math.abs(this.width), Math.abs(this.height));
    if (!Number.isFinite(minDimension) || minDimension <= 0) {
      this.scaleFactor = 1;
      return;
    }

    // The bounding diameter is 2 * maxDistance, so radius is maxDistance
    this.scaleFactor = (minDimension / 2.0) / maxDistance;
  }

  _scaled(point) {
    return {
      x: point.re * this.scaleFactor,
      y: point.im * this.scaleFactor,
    };
  }

  _formatLength(value) {
    if (!Number.isFinite(value)) {
      return '0';
    }
    return this.units ? `${value}${this.units}` : String(value);
  }

  _viewBox() {
    return `${-this.width / 2} ${-this.height / 2} ${this.width} ${this.height}`;
  }

  _pushVirtual(tag, attributes, target = this._virtualMain) {
    if (!target) {
      return;
    }
    const attrString = Object.entries(attributes)
      .filter(([, value]) => value !== null && value !== undefined)
      .map(([key, value]) => `${key}="${String(value)}"`)
      .join(' ');
    target.push(`<${tag}${attrString ? ` ${attrString}` : ''} />`);
  }

  drawScaledCircle(circle, { color = '#4CB39B', opacity = 0.8 } = {}) {
    if (!circle.visible) {
      return;
    }
    const center = this._scaled(circle.center);
    const radius = circle.radius * this.scaleFactor;
    if (!this.hasDOM) {
      this._pushVirtual('circle', {
        cx: center.x.toFixed(4),
        cy: center.y.toFixed(4),
        r: radius.toFixed(4),
        fill: color,
        'fill-opacity': opacity.toString(),
      });
      return;
    }
    const element = document.createElementNS(SVG_NS, 'circle');
    element.setAttribute('cx', center.x.toFixed(4));
    element.setAttribute('cy', center.y.toFixed(4));
    element.setAttribute('r', radius.toFixed(4));
    element.setAttribute('fill', color);
    element.setAttribute('fill-opacity', opacity.toString());
    this.mainGroup.appendChild(element);
  }

  drawScaledArc(arc, { color = DEFAULT_OUTLINE_COLOR, width = 1.2 } = {}) {
    if (!arc.visible) {
      return;
    }
    const points = arc.getPoints();
    if (!points.length) {
      return;
    }
    const commands = [];
    points.forEach((pt, idx) => {
      const scaled = this._scaled(pt);
      const prefix = idx === 0 ? 'M' : 'L';
      commands.push(`${prefix}${scaled.x.toFixed(4)},${scaled.y.toFixed(4)}`);
    });
    if (!this.hasDOM) {
      this._pushVirtual('path', {
        d: commands.join(' '),
        fill: 'none',
        stroke: color,
        'stroke-width': width.toString(),
        'stroke-linecap': 'round',
        'stroke-linejoin': 'round',
      });
      return;
    }
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', commands.join(' '));
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', color);
    path.setAttribute('stroke-width', width.toString());
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('stroke-linejoin', 'round');
    this.mainGroup.appendChild(path);
  }

  drawScaled(shape, options = {}) {
    if (shape instanceof ArcElement) {
      this.drawScaledArc(shape, options);
    } else if (shape instanceof CircleElement) {
      this.drawScaledCircle(shape, options);
    }
  }

  drawPolyline(points, {
    color = DEFAULT_OUTLINE_COLOR,
    width = 1.2,
    close = false,
  } = {}) {
    if (!points || points.length < 2) {
      return;
    }
    const scaled = [];
    const distance = (a, b) => {
      if (!a || !b) {
        return Number.POSITIVE_INFINITY;
      }
      const dx = a.x - b.x;
      const dy = a.y - b.y;
      return Math.hypot(dx, dy);
    };
    for (const point of points) {
      if (!point) {
        continue;
      }
      const scaledPoint = this._scaled(point);
      if (!scaled.length || distance(scaled[scaled.length - 1], scaledPoint) > 1e-6) {
        scaled.push(scaledPoint);
      }
    }
    if (scaled.length < 2) {
      return;
    }
    let shouldClose = Boolean(close);
    const first = scaled[0];
    const last = scaled[scaled.length - 1];
    if (distance(first, last) <= 1e-6) {
      scaled.pop();
      shouldClose = true;
    }
    const commands = scaled.map((pt, idx) => {
      const prefix = idx === 0 ? 'M' : 'L';
      return `${prefix}${pt.x.toFixed(4)},${pt.y.toFixed(4)}`;
    });
    if (shouldClose) {
      commands.push('Z');
    }
    const attributes = {
      d: commands.join(' '),
      fill: 'none',
      stroke: color,
      'stroke-width': width.toString(),
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round',
    };
    if (!this.hasDOM) {
      this._pushVirtual('path', attributes);
      return;
    }
    const path = document.createElementNS(SVG_NS, 'path');
    for (const [key, value] of Object.entries(attributes)) {
      path.setAttribute(key, value);
    }
    this.mainGroup.appendChild(path);
  }

  drawGroupOutline(points, {
    fill = null,
    stroke = DEFAULT_OUTLINE_COLOR,
    strokeWidth = 1.0,
    fillOpacity = 1.0,
    linePatternSettings = [3, 0],
    drawOutline = true,
    lineOffset = 0,
    patternSegments = null,
    patternType = 'lines',
    rectWidth = 2,
    patternStrokeWidth = 0.5,
  } = {}) {
    if (!points || !points.length) {
      return;
    }
    // Pre-allocate array and reuse scaleFactor to reduce allocations
    const len = points.length;
    const scaled = new Array(len);
    const sf = this.scaleFactor;
    for (let i = 0; i < len; i++) {
      const pt = points[i];
      scaled[i] = { x: pt.re * sf, y: pt.im * sf };
    }
    const outlineStrokeWidth = Number.isFinite(strokeWidth) ? strokeWidth : 0;
    const outlineStrokeWidthStr = outlineStrokeWidth.toString();
    const patternStroke = Number.isFinite(patternStrokeWidth)
      ? Math.max(0, patternStrokeWidth)
      : 0;
    const patternStrokeStr = patternStroke.toString();

    const buildPathData = (pts, closePath = true) => {
      if (!pts.length) {
        return '';
      }
      // Optimize by building string directly instead of creating intermediate arrays
      let path = `M${pts[0].x.toFixed(4)},${pts[0].y.toFixed(4)}`;
      for (let i = 1; i < pts.length; i++) {
        path += ` L${pts[i].x.toFixed(4)},${pts[i].y.toFixed(4)}`;
      }
      if (closePath && pts.length > 1) {
        path += ' Z';
      }
      return path;
    };

    const createOutlineSegments = (pts, closeLoop = true) => {
      if (!pts || pts.length < 2) {
        return [];
      }
      const segments = [];
      for (let i = 0; i < pts.length - 1; i += 1) {
        const start = pts[i];
        const end = pts[i + 1];
        if (!start || !end) {
          continue;
        }
        if (Math.hypot(end.x - start.x, end.y - start.y) <= 1e-9) {
          continue;
        }
        segments.push([start, end]);
      }
      if (closeLoop && pts.length > 2) {
        const first = pts[0];
        const last = pts[pts.length - 1];
        if (
          first &&
          last &&
          Math.hypot(first.x - last.x, first.y - last.y) > 1e-9
        ) {
          segments.push([last, first]);
        }
      }
      return segments;
    };

    const emitOutlineSegments = (segments, color) => {
      if (!segments || !segments.length) {
        return;
      }
      const strokeColor = color || 'none';
      if (!this.hasDOM) {
        for (const [start, end] of segments) {
          this._pushVirtual('line', {
            x1: start.x.toFixed(4),
            y1: start.y.toFixed(4),
            x2: end.x.toFixed(4),
            y2: end.y.toFixed(4),
            stroke: strokeColor,
            'stroke-width': outlineStrokeWidthStr,
            'stroke-linecap': 'round',
          });
        }
        return;
      }
      for (const [start, end] of segments) {
        const line = document.createElementNS(SVG_NS, 'line');
        line.setAttribute('x1', start.x.toFixed(4));
        line.setAttribute('y1', start.y.toFixed(4));
        line.setAttribute('x2', end.x.toFixed(4));
        line.setAttribute('y2', end.y.toFixed(4));
        line.setAttribute('stroke', strokeColor);
        line.setAttribute('stroke-width', outlineStrokeWidthStr);
        line.setAttribute('stroke-linecap', 'round');
        this.mainGroup.appendChild(line);
      }
    };

    const shouldDrawOutlineSegments =
      drawOutline && stroke && outlineStrokeWidth > 0;
    const outlineSegments = shouldDrawOutlineSegments
      ? createOutlineSegments(scaled)
      : null;

    if (fill === 'pattern') {
      let segmentsToDraw = null;
      if (patternSegments !== null && patternSegments !== undefined) {
        segmentsToDraw = patternSegments.map(([start, end]) => [
          this._scaled(start),
          this._scaled(end),
        ]);
      } else {
        segmentsToDraw = linesInPolygon(
          scaled,
          linePatternSettings[0],
          linePatternSettings[1],
          lineOffset,
        );
      }
      if (outlineSegments) {
        emitOutlineSegments(outlineSegments, stroke);
      }
      if (segmentsToDraw && segmentsToDraw.length) {
        const lineColor = stroke || DEFAULT_OUTLINE_COLOR;
        const patternStyle = patternType === 'rectangles' ? 'rectangles' : 'lines';
        if (patternStyle === 'rectangles') {
          const widthValue = Number.isFinite(rectWidth) ? Math.abs(rectWidth) : 0;
          const scale = this.scaleFactor > 0 ? this.scaleFactor : 1;
          const scaledWidth = widthValue * scale;
          if (scaledWidth > 1e-6 && patternStroke > 0) {
            const halfWidth = scaledWidth / 2;
            for (const [p1, p2] of segmentsToDraw) {
              if (!p1 || !p2) {
                continue;
              }
              const dx = p2.x - p1.x;
              const dy = p2.y - p1.y;
              const length = Math.hypot(dx, dy);
              if (!Number.isFinite(length) || length <= 1e-6) {
                continue;
              }
              if (length <= 2 * halfWidth) {
                continue;
              }
              const invLength = 1 / length;
              const offsetX = -dy * invLength * halfWidth;
              const offsetY = dx * invLength * halfWidth;
              const rectPoints = [
                { x: p1.x + offsetX, y: p1.y + offsetY },
                { x: p2.x + offsetX, y: p2.y + offsetY },
                { x: p2.x - offsetX, y: p2.y - offsetY },
                { x: p1.x - offsetX, y: p1.y - offsetY },
              ];
              const rectPathData = buildPathData(rectPoints);
              const rectAttributes = {
                d: rectPathData,
                fill: 'none',
                stroke: '#ff0000',
                'stroke-width': patternStrokeStr,
              };
              if (!this.hasDOM) {
                this._pushVirtual('path', rectAttributes);
              } else {
                const path = document.createElementNS(SVG_NS, 'path');
                for (const [key, value] of Object.entries(rectAttributes)) {
                  path.setAttribute(key, value);
                }
                this.mainGroup.appendChild(path);
              }
            }
          }
        } else {
          if (patternStroke > 0) {
            for (const [p1, p2] of segmentsToDraw) {
              if (!this.hasDOM) {
                this._pushVirtual('line', {
                  x1: p1.x.toFixed(4),
                  y1: p1.y.toFixed(4),
                  x2: p2.x.toFixed(4),
                  y2: p2.y.toFixed(4),
                  stroke: lineColor,
                  'stroke-width': patternStrokeStr,
                  'stroke-linecap': 'round',
                });
              } else {
                const line = document.createElementNS(SVG_NS, 'line');
                line.setAttribute('x1', p1.x.toFixed(4));
                line.setAttribute('y1', p1.y.toFixed(4));
                line.setAttribute('x2', p2.x.toFixed(4));
                line.setAttribute('y2', p2.y.toFixed(4));
                line.setAttribute('stroke', lineColor);
                line.setAttribute('stroke-width', patternStrokeStr);
                line.setAttribute('stroke-linecap', 'round');
                this.mainGroup.appendChild(line);
              }
            }
          }
        }
      }
      return;
    }

    if (fill) {
      const pathData = buildPathData(scaled);
      if (!this.hasDOM) {
        const attrs = {
          d: pathData,
          fill,
          'fill-opacity': fillOpacity.toString(),
          stroke: 'none',
        };
        this._pushVirtual('path', attrs);
      } else {
        const path = document.createElementNS(SVG_NS, 'path');
        path.setAttribute('d', pathData);
        path.setAttribute('fill', fill);
        path.setAttribute('fill-opacity', fillOpacity.toString());
        path.setAttribute('stroke', 'none');
        this.mainGroup.appendChild(path);
      }
    }

    if (outlineSegments) {
      emitOutlineSegments(outlineSegments, stroke);
    }
  }

  toString() {
    if (this.hasDOM && this.svg) {
      return new XMLSerializer().serializeToString(this.svg);
    }
    const viewBox = this._viewBox();
    const defsContent = this._virtualDefs && this._virtualDefs.length
      ? `<defs>${this._virtualDefs.join('')}</defs>`
      : '';
    const mainContent = this._virtualMain && this._virtualMain.length
      ? `<g>${this._virtualMain.join('')}</g>`
      : '<g></g>';
    const widthAttr = this._formatLength(this.width);
    const heightAttr = this._formatLength(this.height);
    return `<svg xmlns="${SVG_NS}" viewBox="${viewBox}" width="${widthAttr}" height="${heightAttr}">${defsContent}${mainContent}</svg>`;
  }

  toElement() {
    if (!this.hasDOM) {
      return null;
    }
    return this.svg;
  }
}

// ------------------------------------------------------------
// Doyle mathematics and arc selection
// ------------------------------------------------------------

class DoyleMath {
  static d(z, t, p, q) {
    const w = Math.pow(z, p / q);
    const s = (p * t + 2 * Math.PI) / q;
    const dx = z * Math.cos(t) - w * Math.cos(s);
    const dy = z * Math.sin(t) - w * Math.sin(s);
    return dx * dx + dy * dy;
  }

  static s(z, p, q) {
    return Math.pow(z + Math.pow(z, p / q), 2);
  }

  static r(z, t, p, q) {
    return DoyleMath.d(z, t, p, q) / DoyleMath.s(z, p, q);
  }

  static solve(p, q) {
    const f = (z, t) => {
      const r01 = DoyleMath.r(z, t, 0, 1);
      const f1 = r01 - DoyleMath.r(z, t, p, q);
      const f2 = r01 - DoyleMath.r(Math.pow(z, p / q), (p * t + 2 * Math.PI) / q, 0, 1);
      return [f1, f2];
    };

    const jacobian = (z, t) => {
      const eps = 1e-6;
      const [f1, f2] = f(z, t);
      const [f1z, f2z] = f(z + eps, t);
      const [f1t, f2t] = f(z, t + eps);
      return [
        [(f1z - f1) / eps, (f1t - f1) / eps],
        [(f2z - f2) / eps, (f2t - f2) / eps],
      ];
    };

    let z = 2.0;
    let t = 0.0;
    let norm = Infinity;

    for (let iteration = 0; iteration < 80; iteration += 1) {
      const values = f(z, t);
      norm = Math.max(Math.abs(values[0]), Math.abs(values[1]));
      if (!Number.isFinite(norm)) {
        throw new Error('Doyle solver diverged');
      }
      if (norm < 1e-14) {
        break;
      }
      const J = jacobian(z, t);
      const det = J[0][0] * J[1][1] - J[0][1] * J[1][0];
      if (Math.abs(det) < 1e-12) {
        break;
      }
      const dz = (values[0] * J[1][1] - values[1] * J[0][1]) / det;
      const dt = (J[0][0] * values[1] - J[1][0] * values[0]) / det;
      let step = 1.0;
      let improved = false;
      for (let attempts = 0; attempts < 8; attempts += 1) {
        const nz = z - step * dz;
        const nt = t - step * dt;
        if (nz <= 0) {
          step *= 0.5;
          continue;
        }
        const newValues = f(nz, nt);
        const newNorm = Math.max(Math.abs(newValues[0]), Math.abs(newValues[1]));
        if (newNorm < norm) {
          z = nz;
          t = nt;
          norm = newNorm;
          improved = true;
          break;
        }
        step *= 0.5;
      }
      if (!improved) {
        break;
      }
    }

    const r = Math.sqrt(DoyleMath.r(z, t, 0, 1));
    const a = Complex.mulScalar(Complex.expi(t), z);
    const b = Complex.mulScalar(
      Complex.expi((p * t + 2 * Math.PI) / q),
      Math.pow(z, p / q),
    );
    return { a, b, r, mod_a: z, arg_a: t };
  }
}

class ArcSelector {
  static selectArcsForGaps(circle, spiralCenter, numGaps = 2, mode = 'closest') {
    const pts = circle.intersections.map(entry => entry[0]);
    const n = pts.length;
    if (n < 2) {
      return [];
    }
    const c = circle.center;
    const s = spiralCenter;
    const arcs = Array.from({ length: n }, (_, i) => [i, (i + 1) % n]);
    const midpoints = arcs.map(([i, j]) => (
      Complex.mulScalar(Complex.add(pts[i], pts[j]), 0.5)
    ));

    const lineVec = Complex.sub(s, c);

    if (mode === 'closest' || mode === 'farthest') {
      const distances = midpoints.map(m => {
        if (Complex.abs(lineVec) < 1e-6) {
          return Complex.abs(Complex.sub(m, s));
        }
        const prod = Complex.mul(Complex.conj(lineVec), Complex.sub(m, c));
        return Math.abs(prod.im) / Complex.abs(lineVec);
      });
      const pairs = arcs.map((arc, idx) => ({ arc, dist: distances[idx] }));
      pairs.sort((a, b) => (mode === 'farthest' ? b.dist - a.dist : a.dist - b.dist));
      const skip = Math.min(Math.max(numGaps, 0), pairs.length);
      return pairs.slice(skip).map(entry => entry.arc);
    }

    if (mode === 'alternating') {
      if (numGaps >= n) {
        return [];
      }
      const interval = Math.max(1, Math.floor(n / (numGaps + 1)));
      return arcs.filter((_, idx) => (idx % interval) !== 0);
    }

    if (mode === 'all') {
      return arcs;
    }

    if (mode === 'random') {
      const indices = Array.from({ length: n }, (_, i) => i);
      const rng = seededRandom(circle.id * 97 + 13);
      for (let i = indices.length - 1; i > 0; i -= 1) {
        const j = Math.floor(rng() * (i + 1));
        [indices[i], indices[j]] = [indices[j], indices[i]];
      }
      const skip = new Set(indices.slice(0, Math.min(numGaps, n)));
      return arcs.filter((_, idx) => !skip.has(idx));
    }

    const angles = midpoints.map(m => Complex.angle(Complex.sub(m, c)));
    const targetAngle = Complex.abs(lineVec) < 1e-6 ? 0 : Complex.angle(Complex.sub(s, c));

    if (mode === 'symmetric') {
      const angularDiffs = angles.map(a => Math.abs(Math.atan2(Math.sin(a - targetAngle), Math.cos(a - targetAngle))));
      const sortedIndices = angularDiffs.map((diff, idx) => ({ diff, idx })).sort((a, b) => a.diff - b.diff);
      const skipIndices = new Set();
      const numHalf = Math.floor(numGaps / 2);
      for (let i = 0; i < numHalf && i < sortedIndices.length; i += 1) {
        const idx = sortedIndices[i].idx;
        skipIndices.add(idx);
        const midpointPt = midpoints[idx];
        const oppositeAngle = Complex.angle(Complex.sub(midpointPt, c)) + Math.PI;
        let best = -1;
        let bestDiff = Infinity;
        for (let j = 0; j < n; j += 1) {
          const angle = Complex.angle(Complex.sub(pts[j], c));
          const diff = Math.abs(Math.atan2(Math.sin(angle - oppositeAngle), Math.cos(angle - oppositeAngle)));
          if (diff < bestDiff) {
            bestDiff = diff;
            best = j;
          }
        }
        for (let arcIdx = 0; arcIdx < arcs.length; arcIdx += 1) {
          if (arcs[arcIdx][0] === best) {
            skipIndices.add(arcIdx);
            break;
          }
        }
      }
      if (numGaps % 2 !== 0 && Complex.abs(lineVec) > 1e-6) {
        const intersectionDistances = circle.intersections.map(([pt]) => {
          const prod = Complex.mul(Complex.conj(lineVec), Complex.sub(pt, c));
          return Math.abs(prod.im) / Complex.abs(lineVec);
        });
        let minIdx = 0;
        let minVal = intersectionDistances[0];
        for (let i = 1; i < intersectionDistances.length; i += 1) {
          if (intersectionDistances[i] < minVal) {
            minVal = intersectionDistances[i];
            minIdx = i;
          }
        }
        for (let arcIdx = 0; arcIdx < arcs.length; arcIdx += 1) {
          if (arcs[arcIdx][0] === minIdx) {
            skipIndices.add(arcIdx);
            break;
          }
        }
      }
      return arcs.filter((_, idx) => !skipIndices.has(idx));
    }

    if (mode === 'angular') {
      const angularDiffs = angles.map(a => Math.abs(Math.atan2(Math.sin(a - targetAngle), Math.cos(a - targetAngle))));
      const pairs = arcs.map((arc, idx) => ({ arc, diff: angularDiffs[idx] }));
      pairs.sort((a, b) => a.diff - b.diff);
      const skip = Math.min(Math.max(numGaps, 0), pairs.length);
      return pairs.slice(skip).map(entry => entry.arc);
    }

    throw new Error(`Unknown arc selection mode "${mode}"`);
  }
}

// ------------------------------------------------------------
// Doyle spiral engine
// ------------------------------------------------------------

/**
 * DoyleSpiralEngine generates and renders Doyle spirals based on Apollonian circle packings.
 *
 * @class DoyleSpiralEngine
 * @param {number} p - First parameter for Doyle spiral generation (controls spiral structure)
 * @param {number} q - Second parameter for Doyle spiral generation (controls spiral structure)
 * @param {number} t - Time/evolution parameter for animating the spiral
 * @param {Object} options - Additional configuration options
 * @param {number} options.maxDistance - Maximum distance for circle generation (affects spiral extent)
 * @param {string} options.arcMode - Arc selection mode: 'closest', 'furthest', or 'average'
 * @param {number} options.numGaps - Number of gaps in the spiral pattern
 */
class DoyleSpiralEngine {
  constructor(p = 7, q = 32, t = 0, {
    maxDistance = 2000,
    arcMode = 'closest',
    numGaps = 2,
  } = {}) {
    // Validate parameters
    if (!Number.isFinite(p) || p < MIN_P || p > MAX_P) {
      throw new Error(`Parameter p must be between ${MIN_P} and ${MAX_P}, got ${p}`);
    }
    if (!Number.isFinite(q) || q < MIN_Q || q > MAX_Q) {
      throw new Error(`Parameter q must be between ${MIN_Q} and ${MAX_Q}, got ${q}`);
    }
    if (!Number.isFinite(t)) {
      throw new Error(`Parameter t must be a finite number, got ${t}`);
    }
    if (!Number.isFinite(maxDistance) || maxDistance < MIN_MAX_DISTANCE || maxDistance > MAX_MAX_DISTANCE) {
      throw new Error(
        `Parameter maxDistance must be between ${MIN_MAX_DISTANCE} and ${MAX_MAX_DISTANCE}, got ${maxDistance}`
      );
    }

    this.p = p;
    this.q = q;
    this.t = t;
    this.maxDistance = maxDistance;
    this.arcMode = arcMode;
    this.numGaps = numGaps;
    this.root = DoyleMath.solve(p, q);
    this.circles = [];
    this.outerCircles = [];
    this._generated = false;
    this.arcGroups = new Map();
    this.fillPatternAngle = 0;
    this.fillPatternAnimationId = DEFAULT_PATTERN_ANIMATION;
    this._ringTemplates = new Map();
  }

  /**
   * Generates all circles in the Doyle spiral based on the current parameters.
   * Creates both forward and backward spirals for each family.
   *
   * @throws {Error} If iteration limit is exceeded (prevents infinite loops)
   */
  generateCircles() {
    const { r, a, b, mod_a: modA, arg_a: argA } = this.root;
    const scale = Math.pow(modA, this.t);
    const alpha = argA * this.t;
    const minD = 1 / Math.max(scale, EPSILON);
    const unit = Complex.expi(alpha);

    const circles = [];
    let start = Complex.clone(a);
    const absA = Complex.abs(a);

    for (let family = 0; family < this.q; family += 1) {
      let qv = Complex.clone(start);
      let modQ = Complex.abs(qv);
      let iterations = 0;

      // Forward spiral
      while (modQ * scale < this.maxDistance && iterations < MAX_ITERATIONS_PER_FAMILY) {
        const scaled = Complex.mulScalar(Complex.mul(qv, unit), scale);
        circles.push(new CircleElement(scaled, r * scale * modQ));
        qv = Complex.mul(qv, a);
        modQ *= absA;
        iterations++;
      }

      if (iterations >= MAX_ITERATIONS_PER_FAMILY) {
        throw new Error(
          `Circle generation exceeded iteration limit (${MAX_ITERATIONS_PER_FAMILY} per family). ` +
          `Try reducing p (${this.p}), q (${this.q}), or max_d (${this.maxDistance}).`
        );
      }

      // Backward spiral
      qv = Complex.div(start, a);
      modQ = Complex.abs(qv);
      iterations = 0;

      while (modQ > minD && iterations < MAX_ITERATIONS_PER_FAMILY) {
        const scaled = Complex.mulScalar(Complex.mul(qv, unit), scale);
        circles.push(new CircleElement(scaled, r * scale * modQ));
        qv = Complex.div(qv, a);
        modQ /= absA;
        iterations++;
      }

      if (iterations >= MAX_ITERATIONS_PER_FAMILY) {
        throw new Error(
          `Circle generation exceeded iteration limit (${MAX_ITERATIONS_PER_FAMILY} per family). ` +
          `Try reducing p (${this.p}), q (${this.q}), or increasing max_d (${this.maxDistance}).`
        );
      }

      start = Complex.mul(start, b);
    }

    this.circles = circles;
    this._generated = true;
  }

  /**
   * Generates outer boundary circles for the spiral.
   * These circles help define the outer edge of the pattern.
   *
   * @throws {Error} If iteration limit is exceeded
   */
  generateOuterCircles() {
    const { r, a, b, mod_a: modA, arg_a: argA } = this.root;
    const scale = Math.pow(modA, this.t);
    const unit = Complex.expi(argA * this.t);
    const absA = Complex.abs(a);
    let start = Complex.clone(a);
    const outer = [];

    for (let family = 0; family < this.q; family += 1) {
      let qv = Complex.clone(start);
      let iterations = 0;

      // Find outer circle boundary
      while (Complex.abs(qv) * scale < this.maxDistance && iterations < MAX_ITERATIONS_PER_FAMILY) {
        qv = Complex.mul(qv, a);
        iterations++;
      }

      if (iterations >= MAX_ITERATIONS_PER_FAMILY) {
        throw new Error(
          `Outer circle generation exceeded iteration limit (${MAX_ITERATIONS_PER_FAMILY} per family). ` +
          `Try reducing p (${this.p}), q (${this.q}), or max_d (${this.maxDistance}).`
        );
      }

      const modQ = Complex.abs(qv);
      if (modQ * scale < this.maxDistance * absA * 2) {
        const scaled = Complex.mulScalar(Complex.mul(qv, unit), scale);
        outer.push(new CircleElement(scaled, r * scale * modQ, false));
      }
      start = Complex.mul(start, b);
    }

    this.outerCircles = outer;
  }

  /**
   * Computes intersection points between all circles in the spiral.
   * Uses spatial indexing for efficient intersection detection.
   */
  computeAllIntersections() {
    const all = this.circles.concat(this.outerCircles);
    if (!all.length) {
      return;
    }
    const tol = INTERSECTION_TOLERANCE;

    for (const circle of all) {
      circle.resetIntersections();
    }

    const sorted = all
      .slice()
      .sort((a, b) => a.center.re - b.center.re);
    const tolSq = tol * tol;
    const total = sorted.length;
    const xs = new Float64Array(total);
    const ys = new Float64Array(total);
    const radii = new Float64Array(total);
    const radiiSq = new Float64Array(total);
    const suffixMaxRadius = new Float64Array(total);

    for (let idx = 0; idx < total; idx += 1) {
      const entry = sorted[idx];
      xs[idx] = entry.center.re;
      ys[idx] = entry.center.im;
      radii[idx] = entry.radius;
      radiiSq[idx] = entry.radius * entry.radius;
    }
    let runningMax = 0;
    for (let idx = total - 1; idx >= 0; idx -= 1) {
      if (radii[idx] > runningMax) {
        runningMax = radii[idx];
      }
      suffixMaxRadius[idx] = runningMax;
    }

    for (let i = 0; i < total; i += 1) {
      const circle = sorted[i];
      const x1 = xs[i];
      const y1 = ys[i];
      const r1 = radii[i];
      const r1Sq = radiiSq[i];
      const maxReachBase = r1 + tol;

      for (let j = i + 1; j < total; j += 1) {
        const other = sorted[j];
        const dx = xs[j] - x1;
        const r2 = radii[j];
        const r2Sq = radiiSq[j];
        const breakReach = maxReachBase + suffixMaxRadius[j];
        if (dx > breakReach) {
          break;
        }
        const reach = r1 + r2 + tol;
        const dy = ys[j] - y1;
        // Quick rejection: use reach squared to avoid sqrt
        const reachSq = reach * reach;
        const distSq = dx * dx + dy * dy;

        if (distSq <= tolSq || distSq > reachSq) {
          continue;
        }

        const dist = Math.sqrt(distSq);

        const diffR = Math.abs(r1 - r2);
        if (dist < diffR - tol) {
          continue;
        }

        const a = (r1Sq - r2Sq + distSq) / (2 * dist);
        let hSq = r1Sq - a * a;
        if (hSq < 0) {
          if (hSq < -tol) {
            continue;
          }
          hSq = 0;
        }
        const h = hSq === 0 ? 0 : Math.sqrt(hSq);

        const ratio = a / dist;
        const midX = x1 + dx * ratio;
        const midY = y1 + dy * ratio;
        const invD = 1 / dist;
        const ux = dx * invD;
        const uy = dy * invD;
        const perpX = -uy;
        const perpY = ux;

        const p1 = { re: midX + perpX * h, im: midY + perpY * h };
        circle.addIntersection(p1, other);
        other.addIntersection(p1, circle);

        if (h > tol) {
          const p2 = { re: midX - perpX * h, im: midY - perpY * h };
          circle.addIntersection(p2, other);
          other.addIntersection(p2, circle);
        }
      }
    }

    for (const circle of all) {
      circle.finalizeIntersections(Complex.ZERO);
    }
  }

  createGroupForCircle(circle, name = null) {
    const key = name || `circle_${circle.id}`;
    const group = new ArcGroup(key);
    this.arcGroups.set(key, group);
    return group;
  }

  addArcToGroup(key, arc) {
    if (!this.arcGroups.has(key)) {
      this.arcGroups.set(key, new ArcGroup(key));
    }
    this.arcGroups.get(key).addArc(arc);
  }

  _computeRingIndices() {
    const radii = this.circles.map(c => Number(c.radius.toFixed(6)));
    const unique = Array.from(new Set(radii)).sort((a, b) => a - b);
    const mapping = new Map();
    unique.forEach((radius, idx) => mapping.set(radius, idx));
    return mapping;
  }

  _ringTemplateKey(ringIndex, arcsToDraw) {
    const signature = (arcsToDraw || [])
      .map(pair => (Array.isArray(pair) ? `${pair[0]}-${pair[1]}` : String(pair)))
      .join('|');
    return `${ringIndex}|${this.arcMode}|${this.numGaps}|${signature}`;
  }

  _normalisePointsForTemplate(points, center, radius) {
    if (!points || !points.length || !center || !radius) {
      return null;
    }
    const invRadius = 1 / radius;
    const out = new Float64Array(points.length * 2);
    for (let idx = 0; idx < points.length; idx += 1) {
      const diff = Complex.sub(points[idx], center);
      out[idx * 2] = diff.re * invRadius;
      out[idx * 2 + 1] = diff.im * invRadius;
    }
    return out;
  }

  _buildRingTemplate(circle, group, arcs, arcsToDraw) {
    if (!circle || !group || !arcs || !arcs.length) {
      return null;
    }
    const center = circle.center;
    const radius = circle.radius || 1;
    const normalizedArcs = [];
    const arcPointCounts = [];
    for (const arc of arcs) {
      const pts = arc.getPoints();
      const normalised = this._normalisePointsForTemplate(pts, center, radius);
      normalizedArcs.push(normalised);
      arcPointCounts.push((pts && pts.length) || 0);
    }
    const outlinePoints = group.getClosedOutline();
    const normalizedOutline = this._normalisePointsForTemplate(outlinePoints, center, radius);
    let referenceVector = { re: 1, im: 0 };
    if (normalizedArcs.length && normalizedArcs[0] && normalizedArcs[0].length >= 2) {
      const x = normalizedArcs[0][0];
      const y = normalizedArcs[0][1];
      const len = Math.hypot(x, y);
      if (len > 1e-9) {
        referenceVector = { re: x / len, im: y / len };
      }
    }
    return {
      normalizedArcs,
      normalizedOutline,
      referenceVector,
      referenceArcIndex: 0,
      arcPointCounts,
      signature: (arcsToDraw || []).map(([i, j]) => `${i}-${j}`).join('|'),
      baseRadius: radius,
      patternCache: new Map(),
    };
  }

  _computeTemplateTransform(template, circle, arcsToDraw) {
    if (!template || !circle || !arcsToDraw || !arcsToDraw.length) {
      return null;
    }
    const refIdx = Math.min(template.referenceArcIndex || 0, arcsToDraw.length - 1);
    const [startIdx] = arcsToDraw[refIdx];
    const entry = circle.intersections[startIdx];
    if (!entry || !entry[0]) {
      return null;
    }
    const startPoint = entry[0];
    const center = circle.center;
    const vec = Complex.sub(startPoint, center);
    const len = Math.hypot(vec.re, vec.im);
    if (len < 1e-9) {
      return { cos: 1, sin: 0, radius: circle.radius, center };
    }
    const normActual = { re: vec.re / len, im: vec.im / len };
    const base = template.referenceVector || { re: 1, im: 0 };
    const dot = clamp(base.re * normActual.re + base.im * normActual.im, -1, 1);
    const cross = base.re * normActual.im - base.im * normActual.re;
    const norm = Math.hypot(dot, cross);
    const cos = norm > 1e-12 ? dot / norm : 1;
    const sin = norm > 1e-12 ? cross / norm : 0;
    return {
      cos,
      sin,
      radius: circle.radius,
      center,
    };
  }

  _createArcGroupsForCircles(radiusToRing, spiralCenter, debugGroups, addFillPattern, drawGroupOutline, context, outlineStrokeWidth = 0) {
    for (const circle of this.circles) {
      if (circle.intersections.length !== 6) {
        continue;
      }
      const arcsToDraw = ArcSelector.selectArcsForGaps(circle, spiralCenter, this.numGaps, this.arcMode);
      if (!arcsToDraw.length) {
        continue;
      }
      const key = `circle_${circle.id}`;
      const group = this.createGroupForCircle(circle, key);
      const ring = radiusToRing.get(Number(circle.radius.toFixed(6)));
      group.ringIndex = ring !== undefined ? ring : null;
      group.baseCircle = circle;
      if (debugGroups) {
        group.debugFill = colorFromSeed(circle.id);
        group.debugStroke = DEFAULT_OUTLINE_COLOR;
      }
      const arcs = [];
      for (const [i, j] of arcsToDraw) {
        const start = circle.intersections[i][0];
        const end = circle.intersections[j][0];
        const steps = estimateArcSteps(circle, start, end);
        const arc = new ArcElement(circle, start, end, steps, true);
        if (!addFillPattern && drawGroupOutline) {
          context.drawScaledArc(arc, { color: DEFAULT_OUTLINE_COLOR, width: outlineStrokeWidth });
        }
        group.addArc(arc);
        arcs.push(arc);
      }

      group.templateKey = this._ringTemplateKey(group.ringIndex ?? -1, arcsToDraw);
      group.originalArcsToDraw = arcsToDraw;
    }
  }

  /**
   * Groups circles by their ring index based on radius.
   * @private
   * @param {Map<number, number>} radiusToRing - Map from quantized radius to ring index
   * @returns {Map<number, Array>} Map from ring index to array of circles
   */
  _groupCirclesByRing(radiusToRing) {
    const ringCircles = new Map();
    for (const circle of this.circles) {
      // Only process circles with standard hexagonal packing
      if (circle.intersections.length !== STANDARD_INTERSECTION_COUNT) {
        continue;
      }
      const ring = radiusToRing.get(Number(circle.radius.toFixed(6)));
      if (ring === undefined) continue;

      if (!ringCircles.has(ring)) {
        ringCircles.set(ring, []);
      }
      ringCircles.get(ring).push(circle);
    }
    return ringCircles;
  }

  /**
   * Sorts circles by their angular position around the origin.
   * @private
   * @param {Array} circles - Array of circles to sort
   */
  _sortCirclesByAngle(circles) {
    circles.sort((a, b) => {
      const angleA = Math.atan2(a.center.im, a.center.re);
      const angleB = Math.atan2(b.center.im, b.center.re);
      return angleA - angleB;
    });
  }

  /**
   * Creates arcs for a circle and adds them to its group.
   * @private
   * @param {Object} circle - Circle to create arcs for
   * @param {Object} group - ArcGroup to add arcs to
   * @param {Array} arcsToDraw - Array of [start, end] index pairs
   * @param {boolean} addFillPattern - Whether pattern fill is enabled
   * @param {boolean} drawGroupOutline - Whether to draw outline
   * @param {Object} context - Drawing context
   * @param {number} outlineStrokeWidth - Stroke width for outlines
   */
  _createArcsForGroup(circle, group, arcsToDraw, addFillPattern, drawGroupOutline, context, outlineStrokeWidth) {
    for (const [idx, jdx] of arcsToDraw) {
      const start = circle.intersections[idx][0];
      const end = circle.intersections[jdx][0];
      const steps = estimateArcSteps(circle, start, end);
      const arc = new ArcElement(circle, start, end, steps, true);

      // Draw outline if needed (but not in pattern fill mode)
      if (!addFillPattern && drawGroupOutline) {
        context.drawScaledArc(arc, { color: DEFAULT_OUTLINE_COLOR, width: outlineStrokeWidth });
      }

      group.addArc(arc);
    }
  }

  /**
   * Creates arc groups using rotational symmetry optimization (when p == q).
   * Exploits rotational symmetry: each ring has identical shapes at different angles.
   * Master groups compute outlines once; clone groups rotate the master outline.
   *
   * @private
   * @param {Map<number, number>} radiusToRing - Map from quantized radius to ring index
   * @param {Object} spiralCenter - Center point of spiral (usually origin)
   * @param {boolean} debugGroups - Whether to enable debug rendering
   * @param {boolean} addFillPattern - Whether pattern fill is enabled
   * @param {boolean} drawGroupOutline - Whether to draw outlines
   * @param {Object} context - Drawing context for SVG generation
   * @param {number} [outlineStrokeWidth=0] - Stroke width for outlines
   */
  _createArcGroupsSymmetric(radiusToRing, spiralCenter, debugGroups, addFillPattern, drawGroupOutline, context, outlineStrokeWidth = 0) {
    const ringCircles = this._groupCirclesByRing(radiusToRing);

    // Process each ring independently
    for (const [ringIndex, circles] of ringCircles.entries()) {
      if (!circles.length) continue;

      // Sort by angle for consistent processing
      this._sortCirclesByAngle(circles);

      // Track the master group for this ring (used for outline sharing)
      let masterGroup = null;

      // Create arc groups for all circles in this ring
      for (let i = 0; i < circles.length; i++) {
        const circle = circles[i];

        // Each circle selects its own arcs based on position
        // (Critical: arc selection depends on angle relative to spiral center)
        const arcsToDraw = ArcSelector.selectArcsForGaps(circle, spiralCenter, this.numGaps, this.arcMode);
        if (!arcsToDraw.length) continue;

        // Create the arc group
        const key = `circle_${circle.id}`;
        const group = this.createGroupForCircle(circle, key);
        group.ringIndex = ringIndex;
        group.baseCircle = circle;

        // Configure debug rendering if enabled
        if (debugGroups) {
          group.debugFill = colorFromSeed(circle.id);
          group.debugStroke = DEFAULT_OUTLINE_COLOR;
        }

        // Create all arcs for this circle
        this._createArcsForGroup(circle, group, arcsToDraw, addFillPattern, drawGroupOutline, context, outlineStrokeWidth);

        // Set template metadata
        const templateKey = this._ringTemplateKey(ringIndex, arcsToDraw);
        group.templateKey = templateKey;
        group.originalArcsToDraw = arcsToDraw;

        // Set up master/clone relationship for outline computation optimization
        if (i === 0) {
          // First circle in ring is the master
          masterGroup = group;
          // Pre-warm cache: compute outline immediately to avoid cascading misses
          masterGroup.getClosedOutline();
        } else if (masterGroup && arcsToDraw.length === masterGroup.originalArcsToDraw.length) {
          // Subsequent circles with matching arc count are clones
          // They will rotate the master's outline instead of computing from scratch
          group.cloneOf = masterGroup;
        }
      }
    }
  }

  _drawOuterClosureArcs(
    spiralCenter,
    debugGroups,
    redOutline,
    addFillPattern,
    drawGroupOutline,
    context,
    outlineStrokeWidth = 0,
    highlightStrokeWidth = 0,
  ) {
    for (const circle of this.outerCircles) {
      if (circle.intersections.length < 2) {
        continue;
      }
      const pts = circle.intersections.map(entry => entry[0]);
      const distances = [];
      for (let i = 0; i < pts.length; i += 1) {
        const j = (i + 1) % pts.length;
        const midpoint = Complex.mulScalar(Complex.add(pts[i], pts[j]), 0.5);
        const dist = Complex.abs(Complex.sub(midpoint, spiralCenter));
        distances.push({ dist, i, j });
      }
      distances.sort((a, b) => a.dist - b.dist);
      const arcsForCircle = [];
      for (let idx = 1; idx < Math.min(3, distances.length); idx += 1) {
        const { i, j } = distances[idx];
        const steps = estimateArcSteps(circle, pts[i], pts[j]);
        const arc = new ArcElement(circle, pts[i], pts[j], steps, true);
        arcsForCircle.push(arc);
        const key = `outer_${circle.id}`;
        if (!this.arcGroups.has(key)) {
          const group = new ArcGroup(key);
          group.ringIndex = -1;
          if (debugGroups) {
            group.debugFill = colorFromSeed(circle.id + 1000);
            group.debugStroke = DEFAULT_OUTLINE_COLOR;
          }
          this.arcGroups.set(key, group);
        }
        this.arcGroups.get(key).addArc(arc);
      }
      if (arcsForCircle.length && (redOutline || (!addFillPattern && drawGroupOutline))) {
        const paths = buildContinuousPathsFromArcs(arcsForCircle);
        const shouldDrawBaseOutline = !addFillPattern && drawGroupOutline && outlineStrokeWidth > 0;
        if (shouldDrawBaseOutline) {
          for (const path of paths) {
            context.drawPolyline(path, { color: DEFAULT_OUTLINE_COLOR, width: outlineStrokeWidth });
          }
        }
        if (redOutline && highlightStrokeWidth > 0) {
          for (const path of paths) {
            context.drawPolyline(path, { color: '#ff0000', width: highlightStrokeWidth });
          }
        }
      }
    }
  }

  _extendGroupsWithNeighbours(spiralCenter) {
    const groups = Array.from(this.arcGroups.values()).filter(group => group.name.startsWith('circle_'));
    if (!groups.length) {
      return;
    }
    const preferenceMap = new Map([
      ['-1', 'start'],
      ['-2', 'end'],
      ['-5', 'end'],
      ['-6', 'start'],
    ]);
    for (const circle of this.circles) {
      const key = `circle_${circle.id}`;
      const group = this.arcGroups.get(key);
      if (!group) {
        continue;
      }
      const neighbours = circle.getNeighbourCircles();
      if (neighbours.length !== 6) {
        continue;
      }
      for (const k of [-1, -2, -5, -6]) {
        const idx = ((k % neighbours.length) + neighbours.length) % neighbours.length;
        const neighbour = neighbours[idx];
        const arcs = ArcSelector.selectArcsForGaps(neighbour, spiralCenter, 0, 'all');
        if (!arcs.length) {
          continue;
        }
        const preference = preferenceMap.get(k.toString()) || 'start';
        let sharedIndex = -1;
        for (let intersectionIdx = 0; intersectionIdx < neighbour.intersections.length; intersectionIdx += 1) {
          if (neighbour.intersections[intersectionIdx][1] === circle) {
            sharedIndex = intersectionIdx;
            break;
          }
        }
        if (sharedIndex === -1) {
          continue;
        }
        let arcIndex = -1;
        if (preference === 'end') {
          arcIndex = arcs.findIndex(([, endIdx]) => endIdx === sharedIndex);
        }
        if (arcIndex === -1) {
          arcIndex = arcs.findIndex(([startIdx]) => startIdx === sharedIndex);
        }
        if (arcIndex === -1) {
          arcIndex = 0;
        }
        const [i, j] = arcs[arcIndex];
        const start = neighbour.intersections[i][0];
        const end = neighbour.intersections[j][0];
        const steps = estimateArcSteps(neighbour, start, end);
        const arc = new ArcElement(neighbour, start, end, steps, true);
        group.addArc(arc);
      }
    }
  }

  _finalizeRingTemplates() {
    if (!this.arcGroups.size) {
      return;
    }
    this._ringTemplates = new Map();
    const grouped = new Map();
    for (const [key, group] of this.arcGroups.entries()) {
      if (!key.startsWith('circle_')) {
        continue;
      }
      const templateKey = group.templateKey;
      if (!templateKey) {
        continue;
      }
      if (!grouped.has(templateKey)) {
        grouped.set(templateKey, []);
      }
      grouped.get(templateKey).push(group);
    }

    for (const [templateKey, groups] of grouped.entries()) {
      if (!groups.length) {
        continue;
      }
      const representative = groups.find(g => g.arcs.length) || groups[0];
      if (!representative || !representative.arcs.length) {
        continue;
      }
      const baseCircle = representative.baseCircle || representative.arcs[0]?.circle || null;
      if (!baseCircle) {
        continue;
      }
      const arcsToDraw = representative.originalArcsToDraw || [];
      const cacheKey = `${this.p}|${this.q}|${this.t}|${this.arcMode}|${this.numGaps}|${templateKey}`;
      let template = RING_TEMPLATE_CACHE.get(cacheKey) || null;
      if (!template) {
        template = this._buildRingTemplate(
          baseCircle,
          representative,
          representative.arcs,
          arcsToDraw,
        );
        if (!template) {
          continue;
        }
        RING_TEMPLATE_CACHE.set(cacheKey, template);
      }
      this._ringTemplates.set(templateKey, template);
      for (const group of groups) {
        const circle = group.baseCircle || group.arcs[0]?.circle || null;
        if (!circle) {
          continue;
        }
        const groupArcs = group.originalArcsToDraw || arcsToDraw;
        const transform = this._computeTemplateTransform(template, circle, groupArcs);
        if (!transform) {
          continue;
        }
        if (group._patternSegmentsCache) {
          group._patternSegmentsCache.clear();
        }
        group.setTemplate(template, transform, false);
        for (let idx = 0; idx < group.arcs.length; idx += 1) {
          group.arcs[idx].applyTemplate(template, transform, idx, { preserveCache: false });
        }
      }
    }
  }

  _renderArramBoyle(context, {
    debugGroups = false,
    addFillPattern = false,
    fillPatternSpacing = 5.0,
    fillPatternAngle = 0.0,
    fillPatternAnimation = DEFAULT_PATTERN_ANIMATION,
    redOutline = false,
    drawGroupOutline = true,
    fillPatternOffset = 0.0,
    fillPatternType = 'lines',
    fillPatternRectWidth = 2.0,
    highlightRimWidth = 1.2,
    groupOutlineWidth = 0.6,
    patternStrokeWidth = 0.5,
    useSymmetric = true,
  } = {}) {
    this.generateOuterCircles();
    this.computeAllIntersections();
    // Use outer circle centers to define the bounding box - this ensures
    // the petal tips align with the viewport boundary
    context.setNormalizationScaleFromOuterCircles(this.outerCircles);
    this.fillPatternAngle = fillPatternAngle;
    this.fillPatternAnimationId = normalisePatternAnimationId(fillPatternAnimation);
    this.arcGroups.clear();
    this._ringTemplates = new Map();

    const highlightStrokeWidth = Number.isFinite(highlightRimWidth)
      ? Math.max(0, highlightRimWidth)
      : 0;
    const outlineStrokeWidth = Number.isFinite(groupOutlineWidth)
      ? Math.max(0, groupOutlineWidth)
      : 0;
    const patternStroke = Number.isFinite(patternStrokeWidth)
      ? Math.max(0, patternStrokeWidth)
      : 0;

    const spiralCenter = Complex.ZERO;
    const radiusToRing = this._computeRingIndices();

    // Use symmetric optimization when p == q
    const canUseSymmetric = useSymmetric && this.p === this.q;

    if (canUseSymmetric) {
      this._createArcGroupsSymmetric(
        radiusToRing,
        spiralCenter,
        debugGroups,
        addFillPattern,
        drawGroupOutline,
        context,
        outlineStrokeWidth,
      );
    } else {
      this._createArcGroupsForCircles(
        radiusToRing,
        spiralCenter,
        debugGroups,
        addFillPattern,
        drawGroupOutline,
        context,
        outlineStrokeWidth,
      );
    }
    this._drawOuterClosureArcs(
      spiralCenter,
      debugGroups,
      redOutline,
      addFillPattern,
      drawGroupOutline,
      context,
      outlineStrokeWidth,
      highlightStrokeWidth,
    );
    this._extendGroupsWithNeighbours(spiralCenter);
    this._finalizeRingTemplates();

    const patternAssignments = applyPatternAnimationToGroups(this.arcGroups, {
      animationId: this.fillPatternAnimationId,
      baseAngle: fillPatternAngle,
    });

    for (const group of this.arcGroups.values()) {
      const ringIdx = Number.isFinite(group.ringIndex) ? group.ringIndex : 0;
      const defaultAngle = ringIdx * fillPatternAngle;
      const assignment = patternAssignments.get(group.id) || null;
      if (assignment) {
        group.primaryPatternAngle = assignment.primaryAngle;
        group.patternAngles = assignment.angles.slice();
      } else {
        group.primaryPatternAngle = defaultAngle;
        group.patternAngles = [defaultAngle];
      }
    }

    const scaleFactor = context.scaleFactor;
    const invScale = scaleFactor > 1e-9 ? 1 / scaleFactor : 0;
    const spacingInternal = Math.max(0, fillPatternSpacing);
    const offsetInternal = Math.max(0, fillPatternOffset);
    const rectWidthInternal = Math.max(0, fillPatternRectWidth);
    const spacingForGroups = invScale > 0 ? spacingInternal * invScale : 0;
    const offsetForGroups = invScale > 0 ? offsetInternal * invScale : 0;
    const rectWidthForGroups = invScale > 0 ? rectWidthInternal * invScale : 0;

    const ringIndices = Array.from(this.arcGroups.values())
      .filter(group => group.ringIndex !== null && group.ringIndex !== undefined)
      .map(group => group.ringIndex);
    const maxIndex = ringIndices.length ? Math.max(...ringIndices) : null;

    if (debugGroups) {
      for (const [key, group] of this.arcGroups.entries()) {
        if (key.startsWith('outer_')) {
          continue;
        }
        group.toSVGFill(context, {
          debug: true,
          fillOpacity: 0.25,
          outlineStrokeWidth: outlineStrokeWidth,
        });
      }
    }

    if (addFillPattern) {
      for (const [key, group] of this.arcGroups.entries()) {
        if (key.startsWith('outer_')) continue;
        const ringIdx = group.ringIndex ?? 0;
        const angle = Number.isFinite(group.primaryPatternAngle)
          ? group.primaryPatternAngle : ringIdx * fillPatternAngle;
        group.toSVGFill(context, {
          debug: false, patternFill: true, lineSettings: [spacingInternal, angle],
          drawOutline: drawGroupOutline, lineOffset: offsetInternal,
          patternType: fillPatternType, rectWidth: rectWidthForGroups,
          patternSpacingOverride: spacingForGroups, patternOffsetOverride: offsetForGroups,
          outlineStrokeWidth, patternStrokeWidth: patternStroke,
        });
      }
    }

    if (redOutline && maxIndex !== null) {
      for (const [key, group] of this.arcGroups.entries()) {
        if (!key.startsWith('circle_')) {
          continue;
        }
        if (group.ringIndex !== maxIndex) {
          continue;
        }
        const highlightArcs = [];
        for (let i = 0; i < group.arcs.length; i += 1) {
          if (i === 3 || i === 2) {
            highlightArcs.push(group.arcs[i]);
          }
        }
        const paths = buildContinuousPathsFromArcs(highlightArcs);
        for (const path of paths) {
          context.drawPolyline(path, { color: '#ff0000', width: highlightStrokeWidth });
        }
      }
    }
  }

  _renderDoyle(context) {
    context.setNormalizationScale(this.circles);
    for (const circle of this.circles) {
      context.drawScaled(circle);
    }
  }

  render(mode = 'doyle', {
    size = 800,
    debugGroups = false,
    addFillPattern = false,
    fillPatternSpacing = 5.0,
    fillPatternAngle = 0.0,
    fillPatternAnimation = DEFAULT_PATTERN_ANIMATION,
    redOutline = false,
    drawGroupOutline = true,
    fillPatternOffset = 0.0,
    fillPatternType = 'lines',
    fillPatternRectWidth = 2.0,
    highlightRimWidth = 1.2,
    groupOutlineWidth = 0.6,
    patternStrokeWidth = 0.5,
    boundingBoxWidth = null,
    boundingBoxHeight = null,
    lengthUnits = '',
    useSymmetric = true,
  } = {}) {
    if (!this._generated) {
      this.generateCircles();
    }
    const fallbackSize = Number.isFinite(size) && size > 0 ? size : 800;
    const resolvedWidth = Number.isFinite(boundingBoxWidth) && boundingBoxWidth > 0
      ? boundingBoxWidth
      : fallbackSize;
    const resolvedHeight = Number.isFinite(boundingBoxHeight) && boundingBoxHeight > 0
      ? boundingBoxHeight
      : fallbackSize;
    const context = new DrawingContext(resolvedWidth, resolvedHeight, lengthUnits);
    this.arcGroups.clear();

    if (mode === 'doyle') {
      this._renderDoyle(context);
      return { svg: context.toElement(), svgString: context.toString(), geometry: null };
    }
    if (mode === 'arram_boyle') {
      this._renderArramBoyle(context, {
        debugGroups,
        addFillPattern,
        fillPatternSpacing,
        fillPatternAngle,
        fillPatternAnimation,
        redOutline,
        drawGroupOutline,
        fillPatternOffset,
        fillPatternType,
        fillPatternRectWidth,
        highlightRimWidth,
        groupOutlineWidth,
        patternStrokeWidth,
        useSymmetric,
      });
      return {
        svg: context.toElement(),
        svgString: context.toString(),
        geometry: this.toJSON(),
      };
    }
    throw new Error(`Unknown render mode "${mode}"`);
  }

  toJSON() {
    if (!this.arcGroups.size) {
      throw new Error('Arc groups are not available. Render in arram_boyle mode first.');
    }
    const exportData = {
      spiral_params: {
        p: this.p,
        q: this.q,
        t: this.t,
        max_d: this.maxDistance,
        arc_mode: this.arcMode,
        num_gaps: this.numGaps,
      },
      arcgroups: [],
      pattern_animation: this.fillPatternAnimationId || DEFAULT_PATTERN_ANIMATION,
    };
    for (const [key, group] of this.arcGroups.entries()) {
      if (key.startsWith('outer_')) {
        continue;
      }
      const outline = group.getClosedOutline();
      const outlinePoints = outline.map(pt => [pt.re, pt.im]);
      const ringIdx = group.ringIndex ?? 0;
      const fallbackAngle = ringIdx * this.fillPatternAngle;
      const patternAngles = Array.isArray(group.patternAngles) && group.patternAngles.length
        ? group.patternAngles.slice(0, 3)
        : [fallbackAngle];
      const primaryAngle = Number.isFinite(group.primaryPatternAngle)
        ? group.primaryPatternAngle
        : patternAngles[0];
      exportData.arcgroups.push({
        id: group.id,
        name: group.name,
        ring_index: group.ringIndex,
        line_angle: normaliseAngle360(primaryAngle),
        line_patterns: patternAngles.map(angle => normaliseAngle360(angle)),
        outline: outlinePoints,
        arc_count: group.arcs.length,
      });
    }
    return exportData;
  }
}

// ------------------------------------------------------------
// High level helpers
// ------------------------------------------------------------

/**
 * Normalizes and validates spiral parameters.
 * Converts user input into a consistent format with validated ranges.
 *
 * @param {Object} [params={}] - Raw parameters from user input
 * @param {number} [params.p] - First spiral parameter (families)
 * @param {number} [params.q] - Second spiral parameter (circles per family)
 * @param {number} [params.t] - Rotation parameter (-1 to 1)
 * @param {string} [params.mode] - Rendering mode ('arram_boyle' or 'classic')
 * @param {string} [params.arc_mode] - Arc selection mode
 * @param {number} [params.num_gaps] - Number of gaps in each circle
 * @param {number} [params.size] - Canvas size in pixels
 * @param {boolean} [params.add_fill_pattern] - Whether to add pattern fills
 * @param {boolean} [params.draw_group_outline] - Whether to draw group outlines
 * @param {boolean} [params.use_symmetric] - Enable symmetric optimization for p==q
 * @returns {Object} Normalized parameters with all defaults applied
 */
function normaliseParams(params = {}) {
  const patternTypeRaw = typeof params.fill_pattern_type === 'string'
    ? params.fill_pattern_type.toLowerCase()
    : 'lines';
  const fillPatternType = patternTypeRaw === 'rectangles' ? 'rectangles' : 'lines';
  const spacingRaw = Number(params.fill_pattern_spacing ?? 8);
  const offsetRaw = Number(params.fill_pattern_offset ?? 0);
  const rectWidthValue = Number(params.fill_pattern_rect_width ?? 2);
  const boundingWidthRaw = Number(params.bounding_box_width_mm ?? 200);
  const boundingHeightRaw = Number(params.bounding_box_height_mm ?? boundingWidthRaw);
  const highlightWidthRaw = Number(params.highlight_rim_width ?? 1.2);
  const outlineWidthRaw = Number(params.group_outline_width ?? 0.6);
  const patternStrokeRaw = Number(params.pattern_stroke_width ?? 0.5);
  const fillPatternSpacing = Number.isFinite(spacingRaw) ? Math.max(0.001, spacingRaw) : 8;
  const fillPatternOffset = Number.isFinite(offsetRaw) ? Math.max(0, offsetRaw) : 0;
  const rectWidthMm = Math.max(0, Number.isFinite(rectWidthValue) ? rectWidthValue : 2);
  const boundingWidthMm = Number.isFinite(boundingWidthRaw) && boundingWidthRaw > 0.0001
    ? boundingWidthRaw
    : 200;
  const boundingHeightMm = Number.isFinite(boundingHeightRaw) && boundingHeightRaw > 0.0001
    ? boundingHeightRaw
    : boundingWidthMm;
  const highlightRimWidth = Number.isFinite(highlightWidthRaw) ? Math.max(0, highlightWidthRaw) : 1.2;
  const groupOutlineWidth = Number.isFinite(outlineWidthRaw) ? Math.max(0, outlineWidthRaw) : 0.6;
  const patternStrokeWidth = Number.isFinite(patternStrokeRaw) ? Math.max(0, patternStrokeRaw) : 0.5;
  return {
    p: Number(params.p ?? 16),
    q: Number(params.q ?? 16),
    t: Number(params.t ?? 0),
    mode: params.mode || 'arram_boyle',
    arc_mode: params.arc_mode || 'closest',
    num_gaps: Number(params.num_gaps ?? 2),
    size: Number(params.size ?? 800),
    debug_groups: Boolean(params.debug_groups ?? false),
    add_fill_pattern: Boolean(params.add_fill_pattern ?? false),
    fill_pattern_spacing: fillPatternSpacing,
    fill_pattern_angle: Number(params.fill_pattern_angle ?? 0),
    fill_pattern_offset: fillPatternOffset,
    fill_pattern_type: fillPatternType,
    fill_pattern_rect_width: rectWidthMm,
    fill_pattern_animation: normalisePatternAnimationId(params.fill_pattern_animation),
    highlight_rim_width: highlightRimWidth,
    group_outline_width: groupOutlineWidth,
    pattern_stroke_width: patternStrokeWidth,
    red_outline: Boolean(params.red_outline ?? false),
    draw_group_outline: params.draw_group_outline !== undefined ? Boolean(params.draw_group_outline) : true,
    max_d: Number(params.max_d ?? 2000),
    bounding_box_width_mm: boundingWidthMm,
    bounding_box_height_mm: boundingHeightMm,
    use_symmetric: params.use_symmetric !== undefined ? Boolean(params.use_symmetric) : true,
  };
}

/**
 * High-level function to render a Doyle spiral with the specified parameters.
 * This is the main entry point for generating spiral SVGs.
 *
 * @param {Object} params - Rendering parameters (will be normalized)
 * @param {number} params.p - First spiral parameter (default: 16)
 * @param {number} params.q - Second spiral parameter (default: 16)
 * @param {number} params.t - Time/evolution parameter (default: 0)
 * @param {number} params.max_d - Maximum distance for circle generation (default: 2000)
 * @param {string} params.mode - Rendering mode: 'arram_boyle' or 'classic'
 * @param {number} params.size - Canvas size in pixels (default: 800)
 * @param {number} params.bounding_box_width_mm - Bounding box width in mm (default: 200)
 * @param {number} params.bounding_box_height_mm - Bounding box height in mm (default: 200)
 * @param {string|null} overrideMode - Optional mode override
 * @returns {Object} Result object containing engine, svg, geometry, and metadata
 * @throws {Error} If parameters are invalid or generation exceeds limits
 */
function renderSpiral(params = {}, overrideMode = null) {
  const opts = normaliseParams(params);
  const engine = new DoyleSpiralEngine(opts.p, opts.q, opts.t, {
    maxDistance: opts.max_d,
    arcMode: opts.arc_mode,
    numGaps: opts.num_gaps,
  });
  const mode = overrideMode || opts.mode;
  const result = engine.render(mode, {
    size: opts.size,
    debugGroups: opts.debug_groups,
    addFillPattern: opts.add_fill_pattern,
    fillPatternSpacing: opts.fill_pattern_spacing,
    fillPatternAngle: opts.fill_pattern_angle,
    redOutline: opts.red_outline,
    drawGroupOutline: opts.draw_group_outline,
    fillPatternOffset: opts.fill_pattern_offset,
    fillPatternType: opts.fill_pattern_type,
    fillPatternRectWidth: opts.fill_pattern_rect_width,
    fillPatternAnimation: opts.fill_pattern_animation,
    highlightRimWidth: opts.highlight_rim_width,
    groupOutlineWidth: opts.group_outline_width,
    patternStrokeWidth: opts.pattern_stroke_width,
    boundingBoxWidth: opts.bounding_box_width_mm,
    boundingBoxHeight: opts.bounding_box_height_mm,
    lengthUnits: 'mm',
    useSymmetric: opts.use_symmetric,
  });
  return {
    engine,
    mode,
    svg: result.svg,
    svgString: result.svgString,
    geometry: result.geometry,
    params: opts,
  };
}

function computeGeometry(params = {}) {
  return renderSpiral({ ...params, mode: 'arram_boyle' }, 'arram_boyle');
}

export {
  ArcElement,
  ArcGroup,
  ArcSelector,
  CircleElement,
  DoyleSpiralEngine,
  renderSpiral,
  computeGeometry,
  normaliseParams,
};
