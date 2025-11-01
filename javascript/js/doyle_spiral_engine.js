/* Doyle Spiral engine implemented in JavaScript.
 *
 * This module ports the computational and rendering logic from the Python
 * implementation (src/doyle_spiral.py) to the browser.  It exposes a
 * high-level renderSpiral helper together with the DoyleSpiralEngine class
 * for direct control.
 */

const SVG_NS = 'http://www.w3.org/2000/svg';

const RING_TEMPLATE_CACHE = new Map();

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
  const desiredSegmentLength = clamp(circle.radius * 0.12, 6, 30);
  const rawSteps = Math.ceil(arcLength / desiredSegmentLength);
  return clamp(rawSteps, 10, 44);
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
    this.neighbourKeys = new Set();
    this.neighbourIds = [];
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

  getClosedOutline(tol = 1e-3) {
    if (this._outlineCache) {
      return this._outlineCache.slice();
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
    const key = `${spacing.toFixed(6)}|${angleDeg.toFixed(6)}|${offset.toFixed(6)}`;
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
          normalizedSegments = linesInPolygon(polygon, spacingNorm, angleDeg, 0);
        }
      }

      template.patternCache.set(key, normalizedSegments);
    }
    if (!normalizedSegments || !normalizedSegments.length) {
      const empty = [];
      this._patternSegmentsCache.set(key, empty);
      return empty;
    }
    const { cos, sin, radius, center } = transform;
    const segments = new Array(normalizedSegments.length);
    for (let idx = 0; idx < normalizedSegments.length; idx += 1) {
      const [start, end] = normalizedSegments[idx];
      const sx = start.x * radius;
      const sy = start.y * radius;
      const ex = end.x * radius;
      const ey = end.y * radius;
      segments[idx] = [
        {
          re: center.re + sx * cos - sy * sin,
          im: center.im + sx * sin + sy * cos,
        },
        {
          re: center.re + ex * cos - ey * sin,
          im: center.im + ex * sin + ey * cos,
        },
      ];
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
      const segments = this._getPatternSegments(lineSettings[0], lineSettings[1], lineOffset);
      context.drawGroupOutline(outline, {
        fill: 'pattern',
        stroke,
        strokeWidth: 0.8,
        linePatternSettings: lineSettings,
        drawOutline,
        lineOffset,
        patternSegments: segments,
        patternType,
        rectWidth,
        dataId: this.id,
      });
      return;
    }
    if (drawOutline) {
      context.drawGroupOutline(outline, {
        fill: null,
        stroke: '#000000',
        strokeWidth: 0.6,
        dataId: this.id,
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
    this.hasDOM = typeof document !== 'undefined' && !!document.createElementNS;
    if (this.hasDOM) {
      this.svg = document.createElementNS(SVG_NS, 'svg');
      this.svg.setAttribute('xmlns', SVG_NS);
      this.svg.setAttribute('viewBox', `${-size / 2} ${-size / 2} ${size} ${size}`);
      this.svg.setAttribute('width', size);
      this.svg.setAttribute('height', size);
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

  drawScaledArc(arc, { color = '#000000', width = 1.2 } = {}) {
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

  drawGroupOutline(points, {
    fill = null,
    stroke = '#000000',
    strokeWidth = 1.0,
    fillOpacity = 1.0,
    linePatternSettings = [3, 0],
    drawOutline = true,
    lineOffset = 0,
    patternSegments = null,
    patternType = 'lines',
    rectWidth = 2,
    dataId = null,
  } = {}) {
    if (!points || !points.length) {
      return;
    }
    const scaled = points.map(pt => this._scaled(pt));

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
      if (drawOutline) {
        if (!this.hasDOM) {
          this._pushVirtual('polygon', {
            points: scaled.map(p => `${p.x.toFixed(4)},${p.y.toFixed(4)}`).join(' '),
            fill: 'none',
            stroke: stroke || 'none',
            'stroke-width': strokeWidth.toString(),
            'stroke-linejoin': 'round',
            'data-arcgroup-id': dataId !== null && dataId !== undefined ? String(dataId) : undefined,
          });
        } else {
          const polygon = document.createElementNS(SVG_NS, 'polygon');
          polygon.setAttribute('points', scaled.map(p => `${p.x.toFixed(4)},${p.y.toFixed(4)}`).join(' '));
          polygon.setAttribute('fill', 'none');
          polygon.setAttribute('stroke', stroke || 'none');
          polygon.setAttribute('stroke-width', strokeWidth.toString());
          polygon.setAttribute('stroke-linejoin', 'round');
          if (dataId !== null && dataId !== undefined) {
            polygon.dataset.arcgroupId = String(dataId);
          }
          this.mainGroup.appendChild(polygon);
        }
      }
      if (segmentsToDraw && segmentsToDraw.length) {
        const lineColor = stroke || '#000000';
        const patternStyle = patternType === 'rectangles' ? 'rectangles' : 'lines';
        if (patternStyle === 'rectangles') {
          const widthValue = Number.isFinite(rectWidth) ? rectWidth : 0;
          const scaledWidth = widthValue * this.scaleFactor;
          if (scaledWidth > 1e-6) {
            const halfWidth = scaledWidth / 2;
            for (const [p1, p2] of segmentsToDraw) {
              const dx = p2.x - p1.x;
              const dy = p2.y - p1.y;
              const length = Math.hypot(dx, dy);
              if (!Number.isFinite(length) || length <= 1e-6) {
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
              const rectPointString = rectPoints
                .map(pt => `${pt.x.toFixed(4)},${pt.y.toFixed(4)}`)
                .join(' ');
              if (!this.hasDOM) {
                this._pushVirtual('polygon', {
                  points: rectPointString,
                  fill: 'none',
                  stroke: '#ff0000',
                  'stroke-width': '0.5',
                });
              } else {
                const polygon = document.createElementNS(SVG_NS, 'polygon');
                polygon.setAttribute('points', rectPointString);
                polygon.setAttribute('fill', 'none');
                polygon.setAttribute('stroke', '#ff0000');
                polygon.setAttribute('stroke-width', '0.5');
                this.mainGroup.appendChild(polygon);
              }
            }
          }
        } else {
          for (const [p1, p2] of segmentsToDraw) {
            if (!this.hasDOM) {
              this._pushVirtual('line', {
                x1: p1.x.toFixed(4),
                y1: p1.y.toFixed(4),
                x2: p2.x.toFixed(4),
                y2: p2.y.toFixed(4),
                stroke: lineColor,
                'stroke-width': '0.5',
                'stroke-linecap': 'round',
              });
            } else {
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
          }
        }
      }
      return;
    }

    const polygonPoints = scaled.map(p => `${p.x.toFixed(4)},${p.y.toFixed(4)}`).join(' ');
    if (!this.hasDOM) {
      const attrs = {
        points: polygonPoints,
        fill: fill ? fill : 'none',
        'data-arcgroup-id': dataId !== null && dataId !== undefined ? String(dataId) : undefined,
      };
      if (fill) {
        attrs['fill-opacity'] = fillOpacity.toString();
      }
      if (stroke) {
        attrs.stroke = stroke;
        attrs['stroke-width'] = strokeWidth.toString();
        attrs['stroke-linejoin'] = 'round';
      } else {
        attrs.stroke = 'none';
      }
      this._pushVirtual('polygon', attrs);
      return;
    }
    const polygon = document.createElementNS(SVG_NS, 'polygon');
    polygon.setAttribute('points', polygonPoints);
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
    if (dataId !== null && dataId !== undefined) {
      polygon.dataset.arcgroupId = String(dataId);
    }
    this.mainGroup.appendChild(polygon);
  }

  toString() {
    if (this.hasDOM && this.svg) {
      return new XMLSerializer().serializeToString(this.svg);
    }
    const viewBox = `${-this.size / 2} ${-this.size / 2} ${this.size} ${this.size}`;
    const defsContent = this._virtualDefs && this._virtualDefs.length
      ? `<defs>${this._virtualDefs.join('')}</defs>`
      : '';
    const mainContent = this._virtualMain && this._virtualMain.length
      ? `<g>${this._virtualMain.join('')}</g>`
      : '<g></g>';
    return `<svg xmlns="${SVG_NS}" viewBox="${viewBox}" width="${this.size}" height="${this.size}">${defsContent}${mainContent}</svg>`;
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
    this._ringTemplates = new Map();
    this._patternBaseRotation = 0;
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
      const r1Sq = r1 * r1;
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
        if (Math.abs(dy) > reach) {
          continue;
        }

        const distSq = dx * dx + dy * dy;
        if (distSq <= tolSq) {
          continue;
        }

        const dist = Math.sqrt(distSq);
        if (dist > reach) {
          continue;
        }

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
      group.baseCircle = circle;
      const neighbourCircles = circle.getNeighbourCircles(6, spiralCenter, true, true) || [];
      for (const neighbour of neighbourCircles) {
        if (neighbour && neighbour !== circle) {
          group.neighbourKeys.add(`circle_${neighbour.id}`);
        }
      }
      if (debugGroups) {
        group.debugFill = colorFromSeed(circle.id);
        group.debugStroke = '#000000';
      }
      const arcs = [];
      for (const [i, j] of arcsToDraw) {
        const start = circle.intersections[i][0];
        const end = circle.intersections[j][0];
        const steps = estimateArcSteps(circle, start, end);
        const arc = new ArcElement(circle, start, end, steps, true);
        if (!addFillPattern && drawGroupOutline) {
          context.drawScaled(arc);
        }
        group.addArc(arc);
        arcs.push(arc);
      }

      group.templateKey = this._ringTemplateKey(group.ringIndex ?? -1, arcsToDraw);
      group.originalArcsToDraw = arcsToDraw;
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
        const steps = estimateArcSteps(circle, pts[i], pts[j]);
        const arc = new ArcElement(circle, pts[i], pts[j], steps, true);
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

    const idLookup = new Map();
    for (const [key, group] of this.arcGroups.entries()) {
      if (!key.startsWith('circle_')) {
        continue;
      }
      idLookup.set(key, group.id);
    }
    for (const [key, group] of this.arcGroups.entries()) {
      if (!key.startsWith('circle_')) {
        continue;
      }
      if (!group.neighbourKeys || !group.neighbourKeys.size) {
        group.neighbourIds = [];
        continue;
      }
      const ids = new Set();
      for (const neighbourKey of group.neighbourKeys) {
        if (!idLookup.has(neighbourKey)) {
          continue;
        }
        const neighbourId = idLookup.get(neighbourKey);
        if (neighbourId !== undefined && neighbourId !== null) {
          ids.add(neighbourId);
        }
      }
      group.neighbourIds = Array.from(ids);
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
    fillPatternType = 'lines',
    fillPatternRectWidth = 2.0,
    lineAngleOverrides = null,
  } = {}) {
    this.generateOuterCircles();
    this.computeAllIntersections();
    context.setNormalizationScale(this.circles.concat(this.outerCircles));
    const perRingRotation = Number.isFinite(fillPatternAngle) ? fillPatternAngle : 0;
    const normaliseAngle = value => ((value % 180) + 180) % 180;
    let overrideMap = null;
    if (lineAngleOverrides instanceof Map) {
      overrideMap = new Map();
      lineAngleOverrides.forEach((value, key) => {
        const id = Number(key);
        const angle = Number(value);
        if (Number.isFinite(id) && Number.isFinite(angle)) {
          overrideMap.set(id, angle);
        }
      });
    } else if (lineAngleOverrides && typeof lineAngleOverrides === 'object') {
      overrideMap = new Map();
      Object.entries(lineAngleOverrides).forEach(([key, value]) => {
        const id = Number(key);
        const angle = Number(value);
        if (Number.isFinite(id) && Number.isFinite(angle)) {
          overrideMap.set(id, angle);
        }
      });
      if (!overrideMap.size) {
        overrideMap = null;
      }
    }
    this.fillPatternAngle = perRingRotation;
    this._patternBaseRotation = 0;
    this.arcGroups.clear();
    this._ringTemplates = new Map();

    const spiralCenter = Complex.ZERO;
    const radiusToRing = this._computeRingIndices();

    this._createArcGroupsForCircles(radiusToRing, spiralCenter, debugGroups, addFillPattern, drawGroupOutline, context);
    this._drawOuterClosureArcs(spiralCenter, debugGroups, redOutline, addFillPattern, drawGroupOutline, context);
    this._extendGroupsWithNeighbours(spiralCenter);
    this._finalizeRingTemplates();

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

    for (const [key, group] of this.arcGroups.entries()) {
      if (key.startsWith('outer_')) {
        continue;
      }
      const ringIdx = group.ringIndex ?? 0;
      const baseAngle = normaliseAngle(ringIdx * perRingRotation);
      let angle = baseAngle;
      if (overrideMap && overrideMap.has(group.id)) {
        angle = normaliseAngle(overrideMap.get(group.id));
      }
      group.baseLineAngle = baseAngle;
      group.lineAngle = angle;
    }

    if (addFillPattern) {
      for (const [key, group] of this.arcGroups.entries()) {
        if (key.startsWith('outer_')) {
          continue;
        }
        const angle = Number.isFinite(group.lineAngle) ? group.lineAngle : 0;
        group.toSVGFill(context, {
          debug: false,
          patternFill: true,
          lineSettings: [fillPatternSpacing, angle],
          drawOutline: drawGroupOutline,
          lineOffset: fillPatternOffset,
          patternType: fillPatternType,
          rectWidth: fillPatternRectWidth,
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
    fillPatternType = 'lines',
    fillPatternRectWidth = 2.0,
    lineAngleOverrides = null,
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
        fillPatternType,
        fillPatternRectWidth,
        lineAngleOverrides,
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
      const perRingRotation = Number.isFinite(this.fillPatternAngle) ? this.fillPatternAngle : 0;
      const baseAngle = Number.isFinite(group.baseLineAngle)
        ? group.baseLineAngle
        : ((ringIdx * perRingRotation) % 180 + 180) % 180;
      const lineAngle = Number.isFinite(group.lineAngle) ? group.lineAngle : baseAngle;
      exportData.arcgroups.push({
        id: group.id,
        name: group.name,
        ring_index: group.ringIndex,
        line_angle: lineAngle,
        base_line_angle: baseAngle,
        outline: outlinePoints,
        arc_count: group.arcs.length,
        neighbours: Array.isArray(group.neighbourIds) ? group.neighbourIds.slice() : [],
      });
    }
    return exportData;
  }
}

// ------------------------------------------------------------
// High level helpers
// ------------------------------------------------------------

function normaliseParams(params = {}) {
  const patternTypeRaw = typeof params.fill_pattern_type === 'string'
    ? params.fill_pattern_type.toLowerCase()
    : 'lines';
  const fillPatternType = patternTypeRaw === 'rectangles' ? 'rectangles' : 'lines';
  const rectWidthValue = Number(params.fill_pattern_rect_width ?? 2);
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
    fill_pattern_type: fillPatternType,
    fill_pattern_rect_width: Math.max(0, Number.isFinite(rectWidthValue) ? rectWidthValue : 2),
    red_outline: Boolean(params.red_outline ?? false),
    draw_group_outline: params.draw_group_outline !== undefined ? Boolean(params.draw_group_outline) : true,
    max_d: Number(params.max_d ?? 2000),
    line_angle_overrides: typeof params.line_angle_overrides === 'object' && params.line_angle_overrides !== null
      ? params.line_angle_overrides
      : null,
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
    fillPatternType: opts.fill_pattern_type,
    fillPatternRectWidth: opts.fill_pattern_rect_width,
    lineAngleOverrides: opts.line_angle_overrides,
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
