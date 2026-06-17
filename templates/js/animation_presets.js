const TAU = Math.PI * 2;

function centroidOf(group) {
  const outline = Array.isArray(group?.outline) ? group.outline : [];
  if (!outline.length) {
    return { x: 0, y: 0 };
  }
  let x = 0;
  let y = 0;
  outline.forEach(point => {
    if (Array.isArray(point) && point.length >= 2) {
      x += Number(point[0]) || 0;
      y += Number(point[1]) || 0;
    }
  });
  const inv = 1 / outline.length;
  return { x: x * inv, y: y * inv };
}

function polarAngleDeg(group) {
  const { x, y } = centroidOf(group);
  const angle = Math.atan2(y, x);
  const deg = (angle * 180) / Math.PI;
  return (deg + 360) % 360;
}

function normaliseAngle(angle) {
  if (!Number.isFinite(angle)) {
    return 0;
  }
  let value = angle % 180;
  if (value < 0) {
    value += 180;
  }
  return Number(value.toFixed(4));
}

function groupByRing(groups) {
  const byRing = new Map();
  groups.forEach(group => {
    const ring = Number(group.ring_index ?? 0);
    if (!byRing.has(ring)) {
      byRing.set(ring, []);
    }
    byRing.get(ring).push(group);
  });
  return byRing;
}

function alternatingRingSpin(groups) {
  const mapping = {};
  const byRing = groupByRing(groups);
  byRing.forEach((list, ring) => {
    const sorted = list.slice().sort((a, b) => polarAngleDeg(a) - polarAngleDeg(b));
    const step = sorted.length ? 180 / (sorted.length + 1) : 0;
    sorted.forEach((group, idx) => {
      const base = (idx + 1) * step;
      const angle = ring % 2 === 0 ? base : 180 - base;
      mapping[group.id] = normaliseAngle(angle);
    });
  });
  return mapping;
}

function spiralFollow(groups) {
  const sorted = groups
    .slice()
    .sort((a, b) => {
      const ringDiff = (a.ring_index ?? 0) - (b.ring_index ?? 0);
      if (ringDiff !== 0) {
        return ringDiff;
      }
      return polarAngleDeg(a) - polarAngleDeg(b);
    });
  const step = sorted.length ? 180 / sorted.length : 0;
  const mapping = {};
  sorted.forEach((group, idx) => {
    mapping[group.id] = normaliseAngle(idx * step);
  });
  return mapping;
}

function ringWave(groups) {
  const mapping = {};
  const byRing = groupByRing(groups);
  const totalRings = Math.max(byRing.size, 1);
  byRing.forEach((list, ring) => {
    const sorted = list.slice().sort((a, b) => polarAngleDeg(a) - polarAngleDeg(b));
    const base = (ring / Math.max(totalRings - 1, 1)) * 90;
    sorted.forEach((group, idx) => {
      const phase = sorted.length ? (idx / sorted.length) * TAU : 0;
      const wave = Math.sin(phase) * 45;
      mapping[group.id] = normaliseAngle(base + wave + 45);
    });
  });
  return mapping;
}

function radialBurst(groups) {
  const mapping = {};
  const rings = groups
    .map(group => Number(group.ring_index ?? 0))
    .filter(value => Number.isFinite(value));
  const maxRing = rings.length ? Math.max(...rings) : 0;
  const denom = Math.max(maxRing + 1, 1);
  groups.forEach(group => {
    const ring = Number(group.ring_index ?? 0);
    const angle = ((ring + 1) / (denom + 1)) * 160;
    mapping[group.id] = normaliseAngle(angle);
  });
  return mapping;
}

function opposingStreams(groups) {
  const sorted = groups.slice().sort((a, b) => polarAngleDeg(a) - polarAngleDeg(b));
  const mapping = {};
  const total = Math.max(sorted.length - 1, 1);
  sorted.forEach((group, idx) => {
    const ratio = idx / total;
    const base = ratio * 180;
    const mirrored = idx % 2 === 0 ? base : 180 - base;
    mapping[group.id] = normaliseAngle(mirrored);
  });
  return mapping;
}

const ANIMATION_PRESETS = [
  {
    id: 'none',
    label: 'Manual only',
    compute: () => ({}),
  },
  {
    id: 'alternating_rings',
    label: 'Alternating ring spin',
    compute: alternatingRingSpin,
  },
  {
    id: 'spiral_follow',
    label: 'Spiral arm chase',
    compute: spiralFollow,
  },
  {
    id: 'ring_wave',
    label: 'Ring wave motion',
    compute: ringWave,
  },
  {
    id: 'radial_burst',
    label: 'Radial burst cascade',
    compute: radialBurst,
  },
  {
    id: 'opposing_streams',
    label: 'Opposing streams',
    compute: opposingStreams,
  },
];

export { ANIMATION_PRESETS };
