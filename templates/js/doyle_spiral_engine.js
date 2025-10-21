/* Doyle Spiral engine implemented in JavaScript.
 *
 * This module ports the computational and rendering logic from the Python
 * implementation (src/doyle_spiral.py) to the browser.  It exposes a
 * high-level renderSpiral helper together with the DoyleSpiralEngine class
 * for direct control.
 */

const SVG_NS = 'http://www.w3.org/2000/svg';

// ------------------------------------------------------------
// Complex arithmetic helpers
// ------------------------------------------------------------

const Complex = {
  create(re = 0, im = 0) {
    return { re, im };
  },

  clone(z) {
    return { re: z.re, im: z.im };
  },

  add(a, b) {
    return { re: a.re + b.re, im: a.im + b.im };
  },

  sub(a, b) {
    return { re: a.re - b.re, im: a.im - b.im };
  },

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

function pointOnSegment(point, a, b, tolerance = 1e-6) {
  const cross = (point.x - a.x) * (b.y - a.y) - (point.y - a.y) * (b.x - a.x);
  if (Math.abs(cross) > tolerance) {
    return false;
  }
  const dot = (point.x - a.x) * (point.x - b.x) + (point.y - a.y) * (point.y - b.y);
  return dot <= tolerance;
}

function polygonContains(point, polygon, tolerance = 1e-6) {
  // Ray-casting algorithm with explicit boundary checks.
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const xi = polygon[i].x;
    const yi = polygon[i].y;
    const xj = polygon[j].x;
    const yj = polygon[j].y;
    if (pointOnSegment(point, polygon[i], polygon[j], tolerance)) {
      return true;
    }
    const intersects =
      (yi > point.y) !== (yj > point.y) &&
      point.x <= ((xj - xi) * (point.y - yi)) / (yj - yi + 1e-12) + xi + tolerance;
    if (intersects) {
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

function findLinePolygonIntersections(start, end, polygon) {
  const intersections = [];
  for (let i = 0; i < polygon.length; i += 1) {
    const p3 = polygon[i];
    const p4 = polygon[(i + 1) % polygon.length];
    const intersection = lineSegmentIntersection(start, end, p3, p4);
    if (intersection) {
      intersections.push(intersection);
    }
  }
  intersections.sort((a, b) => a.t - b.t);
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
  const lineDir = { x: Math.cos(angle), y: Math.sin(angle) };
  const perpDir = { x: -lineDir.y, y: lineDir.x };

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of working) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }

  const bboxDiag = Math.hypot(maxX - minX, maxY - minY);
  if (!Number.isFinite(bboxDiag) || bboxDiag <= 0) {
    return [];
  }
  const centroid = polygonCentroid(working);
  const span = { x: lineDir.x * bboxDiag * 2, y: lineDir.y * bboxDiag * 2 };
  const startBase = { x: centroid.x - span.x, y: centroid.y - span.y };
  const endBase = { x: centroid.x + span.x, y: centroid.y + span.y };

  const effectiveSpacing = Math.max(spacingAbs, 1e-6);
  const numLines = Math.floor(bboxDiag / effectiveSpacing) + 3;
  const segments = [];
  for (let i = -numLines; i <= numLines; i += 1) {
    const offsetX = perpDir.x * effectiveSpacing * i;
    const offsetY = perpDir.y * effectiveSpacing * i;
    const start = { x: startBase.x + offsetX, y: startBase.y + offsetY };
    const end = { x: endBase.x + offsetX, y: endBase.y + offsetY };
    const intersections = findLinePolygonIntersections(start, end, working);
    for (let j = 0; j < intersections.length - 1; j += 2) {
      const p1 = intersections[j].point;
      const p2 = intersections[j + 1].point;
      if (Math.hypot(p1.x - p2.x, p1.y - p2.y) <= 1e-6) {
        continue;
      }
      const mid = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
      if (polygonContains(mid, working)) {
        segments.push([p1, p2]);
      }
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
  }

  _getIntersectionPoints(other, tol = 1e-6) {
    const d = Complex.abs(Complex.sub(this.center, other.center));
    const r1 = this.radius;
    const r2 = other.radius;
    if (d > r1 + r2 + tol || d < Math.abs(r1 - r2) - tol || d < tol) {
      return [];
    }
    const a = (r1 * r1 - r2 * r2 + d * d) / (2 * d);
    const hSq = r1 * r1 - a * a;
    if (hSq < -tol) {
      return [];
    }
    const h = Math.sqrt(Math.max(hSq, 0));
    const mid = Complex.add(
      this.center,
      Complex.mulScalar(Complex.sub(other.center, this.center), a / d),
    );
    const perpUnit = Complex.mulScalar(Complex.sub(other.center, this.center), 1 / d);
    const perp = { re: -perpUnit.im, im: perpUnit.re };
    const p1 = Complex.add(mid, Complex.mulScalar(perp, h));
    if (h < tol) {
      return [p1];
    }
    const p2 = Complex.sub(mid, Complex.mulScalar(perp, h));
    return [p1, p2];
  }

  computeIntersections(circles, startReference = Complex.ZERO, tol = 1e-3) {
    this.intersections = [];
    this.neighbours.clear();
    const seen = new Set();

    for (const other of circles) {
      if (other === this) {
        continue;
      }
      const pts = this._getIntersectionPoints(other, tol);
      for (const pt of pts) {
        const key = `${pt.re.toFixed(6)}_${pt.im.toFixed(6)}`;
        if (!seen.has(key)) {
          this.intersections.push([pt, other]);
          seen.add(key);
          this.neighbours.add(other);
        }
      }
    }

    if (!this.intersections.length) {
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
  }

  getNeighbourCircles(k = null, spiralCenter = Complex.ZERO, clockwise = true, tieByDistance = true) {
    let neighbours = Array.from(this.neighbours);
    if (!neighbours.length) {
      return [];
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
    return neighbours;
  }
}

class ArcElement {
  constructor(circle, start, end, steps = 40, visible = true) {
    this.circle = circle;
    this.start = complexFrom(start);
    this.end = complexFrom(end);
    this.steps = Math.max(1, steps | 0);
    this.visible = visible;
    this._pointsCache = null;
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

  getPoints() {
    if (this._pointsCache) {
      return this._pointsCache;
    }
    const c = this.circle.center;
    const r = this.circle.radius;
    const a1 = Complex.angle(Complex.sub(this.start, c));
    const a2 = Complex.angle(Complex.sub(this.end, c));
    let delta = (a2 - a1 + 2 * Math.PI) % (2 * Math.PI);
    if (delta > Math.PI) {
      delta -= 2 * Math.PI;
    }
    const points = [];
    if (this.steps === 1) {
      points.push(Complex.add(c, Complex.mulScalar(Complex.expi(a1), r)));
    } else {
      for (let i = 0; i < this.steps; i += 1) {
        const t = i / (this.steps - 1);
        const angle = a1 + delta * t;
        const point = Complex.add(c, Complex.mulScalar(Complex.expi(angle), r));
        points.push(point);
      }
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
    this._outlineCache = null;
  }

  addArc(arc) {
    this.arcs.push(arc);
    this._outlineCache = null;
  }

  extend(arcs) {
    for (const arc of arcs) {
      this.addArc(arc);
    }
  }

  isEmpty() {
    return this.arcs.length === 0;
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

  getClosedOutline(tol = 1e-3) {
    if (this._outlineCache) {
      return this._outlineCache.slice();
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

  toSVGFill(context, {
    debug = false,
    fillOpacity = 0.25,
    patternFill = false,
    lineSettings = [3, 0],
    drawOutline = true,
    lineOffset = 0,
  } = {}) {
    const outline = this.getClosedOutline();
    if (!outline.length) {
      return;
    }
    if (debug) {
      const fill = this.debugFill || colorFromSeed(this.id);
      const stroke = this.debugStroke || '#000000';
      context.drawGroupOutline(outline, {
        fill,
        stroke,
        strokeWidth: 0.8,
        fillOpacity,
      });
      return;
    }
    if (patternFill) {
      const stroke = this.debugStroke || '#000000';
      context.drawGroupOutline(outline, {
        fill: 'pattern',
        stroke,
        strokeWidth: 0.8,
        linePatternSettings: lineSettings,
        drawOutline,
        lineOffset,
      });
      return;
    }
    if (drawOutline) {
      context.drawGroupOutline(outline, {
        fill: null,
        stroke: '#000000',
        strokeWidth: 0.6,
      });
    }
  }
}

// ------------------------------------------------------------
// Drawing context
// ------------------------------------------------------------

class DrawingContext {
  constructor(size = 800) {
    this.size = size;
    this.scaleFactor = 1;
    this.svg = document.createElementNS(SVG_NS, 'svg');
    this.svg.setAttribute('xmlns', SVG_NS);
    this.svg.setAttribute('viewBox', `${-size / 2} ${-size / 2} ${size} ${size}`);
    this.svg.setAttribute('width', size);
    this.svg.setAttribute('height', size);
    this.defs = document.createElementNS(SVG_NS, 'defs');
    this.mainGroup = document.createElementNS(SVG_NS, 'g');
    this.svg.appendChild(this.defs);
    this.svg.appendChild(this.mainGroup);
  }

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
    this.scaleFactor = (this.size / 2.1) / maxExtent;
  }

  _scaled(point) {
    return {
      x: point.re * this.scaleFactor,
      y: point.im * this.scaleFactor,
    };
  }

  drawScaledCircle(circle, { color = '#4CB39B', opacity = 0.8 } = {}) {
    if (!circle.visible) {
      return;
    }
    const center = this._scaled(circle.center);
    const radius = circle.radius * this.scaleFactor;
    const element = document.createElementNS(SVG_NS, 'circle');
    element.setAttribute('cx', center.x.toFixed(4));
    element.setAttribute('cy', center.y.toFixed(4));
    element.setAttribute('r', radius.toFixed(4));
    element.setAttribute('fill', color);
    element.setAttribute('fill-opacity', opacity.toString());
    this.mainGroup.appendChild(element);
  }

  drawScaledArc(arc, { color = '#000000', width = 1.2 } = {}) {
    if (!arc.visible) {
      return;
    }
    const points = arc.getPoints();
    if (!points.length) {
      return;
    }
    const path = document.createElementNS(SVG_NS, 'path');
    const commands = [];
    points.forEach((pt, idx) => {
      const scaled = this._scaled(pt);
      const prefix = idx === 0 ? 'M' : 'L';
      commands.push(`${prefix}${scaled.x.toFixed(4)},${scaled.y.toFixed(4)}`);
    });
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

  drawGroupOutline(points, {
    fill = null,
    stroke = '#000000',
    strokeWidth = 1.0,
    fillOpacity = 1.0,
    linePatternSettings = [3, 0],
    drawOutline = true,
    lineOffset = 0,
  } = {}) {
    if (!points || !points.length) {
      return;
    }
    const scaled = points.map(pt => this._scaled(pt));

    if (fill === 'pattern') {
      const segments = linesInPolygon(
        scaled,
        linePatternSettings[0],
        linePatternSettings[1],
        lineOffset,
      );
      if (drawOutline) {
        const polygon = document.createElementNS(SVG_NS, 'polygon');
        polygon.setAttribute('points', scaled.map(p => `${p.x.toFixed(4)},${p.y.toFixed(4)}`).join(' '));
        polygon.setAttribute('fill', 'none');
        polygon.setAttribute('stroke', stroke || 'none');
        polygon.setAttribute('stroke-width', strokeWidth.toString());
        polygon.setAttribute('stroke-linejoin', 'round');
        this.mainGroup.appendChild(polygon);
      }
      const lineColor = stroke || '#000000';
      for (const [p1, p2] of segments) {
        const line = document.createElementNS(SVG_NS, 'line');
        line.setAttribute('x1', p1.x.toFixed(4));
        line.setAttribute('y1', p1.y.toFixed(4));
        line.setAttribute('x2', p2.x.toFixed(4));
        line.setAttribute('y2', p2.y.toFixed(4));
        line.setAttribute('stroke', lineColor);
        line.setAttribute('stroke-width', '0.5');
        line.setAttribute('stroke-linecap', 'round');
        this.mainGroup.appendChild(line);
      }
      return;
    }

    const polygon = document.createElementNS(SVG_NS, 'polygon');
    polygon.setAttribute('points', scaled.map(p => `${p.x.toFixed(4)},${p.y.toFixed(4)}`).join(' '));
    if (fill) {
      polygon.setAttribute('fill', fill);
      polygon.setAttribute('fill-opacity', fillOpacity.toString());
    } else {
      polygon.setAttribute('fill', 'none');
    }
    if (stroke) {
      polygon.setAttribute('stroke', stroke);
      polygon.setAttribute('stroke-width', strokeWidth.toString());
      polygon.setAttribute('stroke-linejoin', 'round');
    } else {
      polygon.setAttribute('stroke', 'none');
    }
    this.mainGroup.appendChild(polygon);
  }

  toString() {
    return new XMLSerializer().serializeToString(this.svg);
  }

  toElement() {
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
      return pairs.slice(Math.min(numGaps, pairs.length)).map(entry => entry.arc);
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
      return pairs.slice(Math.min(numGaps, pairs.length)).map(entry => entry.arc);
    }

    throw new Error(`Unknown arc selection mode "${mode}"`);
  }
}

// ------------------------------------------------------------
// Doyle spiral engine
// ------------------------------------------------------------

class DoyleSpiralEngine {
  constructor(p = 7, q = 32, t = 0, {
    maxDistance = 2000,
    arcMode = 'closest',
    numGaps = 2,
  } = {}) {
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
  }

  generateCircles() {
    const { r, a, b, mod_a: modA, arg_a: argA } = this.root;
    const scale = Math.pow(modA, this.t);
    const alpha = argA * this.t;
    const minD = 1 / Math.max(scale, 1e-9);
    const unit = Complex.expi(alpha);

    const circles = [];
    let start = Complex.clone(a);
    const absA = Complex.abs(a);

    for (let family = 0; family < this.q; family += 1) {
      let qv = Complex.clone(start);
      let modQ = Complex.abs(qv);
      while (modQ * scale < this.maxDistance) {
        const scaled = Complex.mulScalar(Complex.mul(qv, unit), scale);
        circles.push(new CircleElement(scaled, r * scale * modQ));
        qv = Complex.mul(qv, a);
        modQ *= absA;
      }
      qv = Complex.div(start, a);
      modQ = Complex.abs(qv);
      while (modQ > minD) {
        const scaled = Complex.mulScalar(Complex.mul(qv, unit), scale);
        circles.push(new CircleElement(scaled, r * scale * modQ));
        qv = Complex.div(qv, a);
        modQ /= absA;
      }
      start = Complex.mul(start, b);
    }

    this.circles = circles;
    this._generated = true;
  }

  generateOuterCircles() {
    const { r, a, b, mod_a: modA, arg_a: argA } = this.root;
    const scale = Math.pow(modA, this.t);
    const unit = Complex.expi(argA * this.t);
    const absA = Complex.abs(a);
    let start = Complex.clone(a);
    const outer = [];

    for (let family = 0; family < this.q; family += 1) {
      let qv = Complex.clone(start);
      while (Complex.abs(qv) * scale < this.maxDistance) {
        qv = Complex.mul(qv, a);
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

  computeAllIntersections() {
    const all = this.circles.concat(this.outerCircles);
    if (!all.length) {
      return;
    }
    const tol = 1e-3;
    for (let i = 0; i < all.length; i += 1) {
      const circle = all[i];
      const candidates = [];
      for (let j = 0; j < all.length; j += 1) {
        if (i === j) {
          continue;
        }
        const other = all[j];
        const dist = Complex.abs(Complex.sub(circle.center, other.center));
        if (dist <= circle.radius + other.radius + tol) {
          candidates.push(other);
        }
      }
      circle.computeIntersections(candidates, Complex.ZERO, tol);
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

  _createArcGroupsForCircles(radiusToRing, spiralCenter, debugGroups, addFillPattern, drawGroupOutline, context) {
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
      if (debugGroups) {
        group.debugFill = colorFromSeed(circle.id);
        group.debugStroke = '#000000';
      }
      for (const [i, j] of arcsToDraw) {
        const start = circle.intersections[i][0];
        const end = circle.intersections[j][0];
        const arc = new ArcElement(circle, start, end, 40, true);
        if (!addFillPattern && drawGroupOutline) {
          context.drawScaled(arc);
        }
        group.addArc(arc);
      }
    }
  }

  _drawOuterClosureArcs(spiralCenter, debugGroups, redOutline, addFillPattern, drawGroupOutline, context) {
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
      for (let idx = 1; idx < Math.min(3, distances.length); idx += 1) {
        const { i, j } = distances[idx];
        const arc = new ArcElement(circle, pts[i], pts[j], 40, true);
        if (redOutline || (!addFillPattern && drawGroupOutline)) {
          const color = redOutline ? '#ff0000' : '#000000';
          context.drawScaled(arc, { color, width: 1.2 });
        }
        const key = `outer_${circle.id}`;
        if (!this.arcGroups.has(key)) {
          const group = new ArcGroup(key);
          group.ringIndex = -1;
          if (debugGroups) {
            group.debugFill = colorFromSeed(circle.id + 1000);
            group.debugStroke = '#000000';
          }
          this.arcGroups.set(key, group);
        }
        this.arcGroups.get(key).addArc(arc);
      }
    }
  }

  _extendGroupsWithNeighbours(spiralCenter) {
    const groups = Array.from(this.arcGroups.values()).filter(group => group.name.startsWith('circle_'));
    if (!groups.length) {
      return;
    }
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
      const indexMap = { '-1': -3, '-2': -2, '-5': 1, '-6': 0 };
      for (const k of [-1, -2, -5, -6]) {
        const idx = ((k % neighbours.length) + neighbours.length) % neighbours.length;
        const neighbour = neighbours[idx];
        const arcs = ArcSelector.selectArcsForGaps(neighbour, spiralCenter, 0, 'all');
        if (!arcs.length) {
          continue;
        }
        let arcIndex = indexMap[k.toString()] ?? 0;
        if (arcIndex < 0) {
          arcIndex = (arcs.length + arcIndex) % arcs.length;
        } else if (arcIndex >= arcs.length) {
          arcIndex %= arcs.length;
        }
        const [i, j] = arcs[arcIndex];
        const start = neighbour.intersections[i][0];
        const end = neighbour.intersections[j][0];
        const arc = new ArcElement(neighbour, start, end, 40, true);
        group.addArc(arc);
      }
    }
  }

  _renderArramBoyle(context, {
    debugGroups = false,
    addFillPattern = false,
    fillPatternSpacing = 5.0,
    fillPatternAngle = 0.0,
    redOutline = false,
    drawGroupOutline = true,
    fillPatternOffset = 0.0,
  } = {}) {
    this.generateOuterCircles();
    this.computeAllIntersections();
    context.setNormalizationScale(this.circles.concat(this.outerCircles));
    this.fillPatternAngle = fillPatternAngle;
    this.arcGroups.clear();

    const spiralCenter = Complex.ZERO;
    const radiusToRing = this._computeRingIndices();

    this._createArcGroupsForCircles(radiusToRing, spiralCenter, debugGroups, addFillPattern, drawGroupOutline, context);
    this._drawOuterClosureArcs(spiralCenter, debugGroups, redOutline, addFillPattern, drawGroupOutline, context);
    this._extendGroupsWithNeighbours(spiralCenter);

    const ringIndices = Array.from(this.arcGroups.values())
      .filter(group => group.ringIndex !== null && group.ringIndex !== undefined)
      .map(group => group.ringIndex);
    const maxIndex = ringIndices.length ? Math.max(...ringIndices) : null;

    if (debugGroups) {
      for (const [key, group] of this.arcGroups.entries()) {
        if (key.startsWith('outer_')) {
          continue;
        }
        group.toSVGFill(context, { debug: true, fillOpacity: 0.25 });
      }
    }

    if (addFillPattern) {
      for (const [key, group] of this.arcGroups.entries()) {
        if (key.startsWith('outer_')) {
          continue;
        }
        const ringIdx = group.ringIndex ?? 0;
        const angle = ringIdx * fillPatternAngle;
        group.toSVGFill(context, {
          debug: false,
          patternFill: true,
          lineSettings: [fillPatternSpacing, angle],
          drawOutline: drawGroupOutline,
          lineOffset: fillPatternOffset,
        });
      }
    }

    if (redOutline && maxIndex !== null) {
      for (const [key, group] of this.arcGroups.entries()) {
        if (!key.startsWith('circle_')) {
          continue;
        }
        for (let i = 0; i < group.arcs.length; i += 1) {
          if ((i === 3 || i === 2) && group.ringIndex === maxIndex) {
            context.drawScaled(group.arcs[i], { color: '#ff0000', width: 1.2 });
          }
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
    redOutline = false,
    drawGroupOutline = true,
    fillPatternOffset = 0.0,
  } = {}) {
    if (!this._generated) {
      this.generateCircles();
    }
    const context = new DrawingContext(size);
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
        redOutline,
        drawGroupOutline,
        fillPatternOffset,
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
    };
    for (const [key, group] of this.arcGroups.entries()) {
      if (key.startsWith('outer_')) {
        continue;
      }
      const outline = group.getClosedOutline();
      const outlinePoints = outline.map(pt => [pt.re, pt.im]);
      const ringIdx = group.ringIndex ?? 0;
      const lineAngle = ringIdx * this.fillPatternAngle;
      exportData.arcgroups.push({
        id: group.id,
        name: group.name,
        ring_index: group.ringIndex,
        line_angle: lineAngle,
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

function normaliseParams(params = {}) {
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
    fill_pattern_spacing: Number(params.fill_pattern_spacing ?? 5),
    fill_pattern_angle: Number(params.fill_pattern_angle ?? 0),
    fill_pattern_offset: Number(params.fill_pattern_offset ?? 0),
    red_outline: Boolean(params.red_outline ?? false),
    draw_group_outline: params.draw_group_outline !== undefined ? Boolean(params.draw_group_outline) : true,
    max_d: Number(params.max_d ?? 2000),
  };
}

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
