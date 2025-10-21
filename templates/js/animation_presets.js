const GOLDEN_HEX = '#ffd700';

function hexToRgb(hex) {
  const normalized = hex.replace('#', '');
  const bigint = parseInt(normalized, 16);
  return {
    r: (bigint >> 16) & 255,
    g: (bigint >> 8) & 255,
    b: bigint & 255,
  };
}

function colorForFrame(index, baseHex = GOLDEN_HEX) {
  const { r, g, b } = hexToRgb(baseHex);
  const darkness = Math.min(0.25 * index, 0.85);
  const scale = Math.max(0.15, 1 - darkness);
  const rr = Math.round(r * scale);
  const gg = Math.round(g * scale);
  const bb = Math.round(b * scale);
  return `rgb(${rr}, ${gg}, ${bb})`;
}

function polygonArea(points) {
  if (!points || points.length < 3) {
    return 0;
  }
  let area = 0;
  for (let i = 0, j = points.length - 1; i < points.length; j = i, i += 1) {
    area += points[j][0] * points[i][1] - points[i][0] * points[j][1];
  }
  return area / 2;
}

function polygonCentroid(points) {
  if (!points || points.length === 0) {
    return { x: 0, y: 0 };
  }
  const area = polygonArea(points);
  if (Math.abs(area) < 1e-9) {
    let cx = 0;
    let cy = 0;
    for (const [x, y] of points) {
      cx += x;
      cy += y;
    }
    const inv = 1 / points.length;
    return { x: cx * inv, y: cy * inv };
  }
  let cx = 0;
  let cy = 0;
  for (let i = 0, j = points.length - 1; i < points.length; j = i, i += 1) {
    const [x0, y0] = points[j];
    const [x1, y1] = points[i];
    const cross = x0 * y1 - x1 * y0;
    cx += (x0 + x1) * cross;
    cy += (y0 + y1) * cross;
  }
  const factor = 1 / (6 * area);
  return { x: cx * factor, y: cy * factor };
}

function normalizeAngle(angleDeg) {
  const wrapped = angleDeg % 360;
  return wrapped < 0 ? wrapped + 360 : wrapped;
}

function buildArcGroupMetadata(geometry) {
  if (!geometry || !Array.isArray(geometry.arcgroups)) {
    return [];
  }
  return geometry.arcgroups.map((group, index) => {
    const outline = Array.isArray(group.outline) ? group.outline : [];
    const centroid = polygonCentroid(outline);
    const angleDeg = normalizeAngle((Math.atan2(centroid.y, centroid.x) * 180) / Math.PI);
    const radius = Math.hypot(centroid.x, centroid.y);
    return {
      id: group.id,
      name: group.name || `group_${group.id}`,
      ringIndex: group.ring_index !== undefined && group.ring_index !== null ? group.ring_index : -1,
      centroid,
      angleDeg,
      radius,
      lineAngle: group.line_angle || 0,
      index,
    };
  });
}

function groupByRing(meta) {
  const map = new Map();
  meta.forEach(entry => {
    const ring = entry.ringIndex;
    if (!map.has(ring)) {
      map.set(ring, []);
    }
    map.get(ring).push(entry);
  });
  return map;
}

function uniqueFrame(frame) {
  const seen = new Set();
  const result = [];
  frame.forEach(id => {
    if (!seen.has(id)) {
      seen.add(id);
      result.push(id);
    }
  });
  return result;
}

function framesFromRingAlternation(meta) {
  const byRing = groupByRing(meta);
  const rings = Array.from(byRing.keys()).sort((a, b) => a - b);
  const frames = [];
  let reverse = false;
  rings.forEach(ring => {
    const entries = byRing.get(ring).slice().sort((a, b) => a.angleDeg - b.angleDeg);
    if (reverse) {
      entries.reverse();
    }
    entries.forEach(entry => {
      frames.push([entry.id]);
    });
    reverse = !reverse;
  });
  return frames;
}

function framesFromSpiral(meta) {
  const spiralFactor = 22;
  const ordered = meta.slice().sort((a, b) => {
    const scoreA = a.angleDeg + a.ringIndex * spiralFactor;
    const scoreB = b.angleDeg + b.ringIndex * spiralFactor;
    if (scoreA === scoreB) {
      return a.radius - b.radius;
    }
    return scoreA - scoreB;
  });
  return ordered.map(entry => [entry.id]);
}

function framesFromRingWave(meta) {
  const ordered = meta.slice().sort((a, b) => {
    const phaseA = Math.sin((a.angleDeg / 180) * Math.PI + a.ringIndex * 0.7) + a.ringIndex * 0.1;
    const phaseB = Math.sin((b.angleDeg / 180) * Math.PI + b.ringIndex * 0.7) + b.ringIndex * 0.1;
    if (phaseA === phaseB) {
      return a.angleDeg - b.angleDeg;
    }
    return phaseA - phaseB;
  });
  return ordered.map(entry => [entry.id]);
}

function framesFromOppositePairs(meta) {
  const byRing = groupByRing(meta);
  const rings = Array.from(byRing.keys()).sort((a, b) => a - b);
  const frames = [];
  rings.forEach(ring => {
    const entries = byRing.get(ring).slice().sort((a, b) => a.angleDeg - b.angleDeg);
    const half = Math.ceil(entries.length / 2);
    for (let i = 0; i < half; i += 1) {
      const first = entries[i];
      const second = entries[(i + half) % entries.length];
      if (!second || second.id === first.id) {
        frames.push([first.id]);
      } else {
        const ids = uniqueFrame([first.id, second.id]);
        frames.push(ids);
      }
    }
  });
  return frames;
}

function seededRandom(seed) {
  let t = (seed + 0x6d2b79f5) >>> 0;
  return function () {
    t |= 0;
    t = (t + 0x6d2b79f5) | 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function framesFromRandomBursts(meta) {
  const rng = seededRandom(meta.length * 97 + 13);
  const ordered = meta.slice().sort((a, b) => rng() - 0.5);
  const frames = [];
  let idx = 0;
  while (idx < ordered.length) {
    const groupSize = Math.min(3, ordered.length - idx);
    const frame = [];
    for (let i = 0; i < groupSize; i += 1) {
      frame.push(ordered[idx + i].id);
    }
    frames.push(uniqueFrame(frame));
    idx += groupSize;
  }
  return frames;
}

const ANIMATION_PRESETS = [
  {
    id: 'ring-alternate',
    name: 'Ring alternation',
    description: 'Sweeps each ring while alternating rotation direction per layer.',
    createFrames: framesFromRingAlternation,
  },
  {
    id: 'spiral-out',
    name: 'Spiral arms outward',
    description: 'Follows the logarithmic spiral arms from the core outward.',
    createFrames: framesFromSpiral,
  },
  {
    id: 'ring-wave',
    name: 'Orbital wave',
    description: 'Creates a wave-like ripple travelling across the rings.',
    createFrames: framesFromRingWave,
  },
  {
    id: 'paired-glimmer',
    name: 'Paired glimmer',
    description: 'Activates opposite cells on each ring as twinned bursts.',
    createFrames: framesFromOppositePairs,
  },
  {
    id: 'random-bursts',
    name: 'Random bursts',
    description: 'Groups random constellations for playful sparkles.',
    createFrames: framesFromRandomBursts,
  },
];

function generatePresetFrames(presetId, meta) {
  const preset = ANIMATION_PRESETS.find(entry => entry.id === presetId);
  if (!preset) {
    return [];
  }
  const frames = preset.createFrames(meta.slice());
  return frames.map(frame => uniqueFrame(frame));
}

function framesToAngleMap(frames, { span = 180, baseAngle = 0 } = {}) {
  const totalFrames = frames && frames.length ? frames.length : 1;
  const step = span / totalFrames;
  const assignments = new Map();
  frames.forEach((frame, index) => {
    if (!Array.isArray(frame) || !frame.length) {
      return;
    }
    const angle = baseAngle + step * index;
    frame.forEach(id => {
      assignments.set(id, angle);
    });
  });
  return { assignments, step, totalFrames };
}

export {
  ANIMATION_PRESETS,
  buildArcGroupMetadata,
  colorForFrame,
  framesToAngleMap,
  generatePresetFrames,
};
