function normaliseAngleDeg(angleRad) {
  const deg = (angleRad * 180) / Math.PI;
  return (deg % 360 + 360) % 360;
}

function centroid(outline) {
  if (!Array.isArray(outline) || !outline.length) {
    return { x: 0, y: 0 };
  }
  let sumX = 0;
  let sumY = 0;
  outline.forEach(([x, y]) => {
    sumX += Number(x) || 0;
    sumY += Number(y) || 0;
  });
  const inv = 1 / outline.length;
  return { x: sumX * inv, y: sumY * inv };
}

function prepareEntries(arcgroups = []) {
  return arcgroups
    .filter(group => group && Number.isFinite(group.ring_index))
    .map(group => {
      const center = centroid(group.outline || []);
      const angle = normaliseAngleDeg(Math.atan2(center.y, center.x));
      return {
        id: String(group.id),
        ring: group.ring_index,
        angle,
        angleRad: (angle / 180) * Math.PI,
        group,
      };
    });
}

function alternatingRings(arcgroups) {
  const entries = prepareEntries(arcgroups);
  const rings = new Map();
  entries.forEach(entry => {
    if (!rings.has(entry.ring)) {
      rings.set(entry.ring, []);
    }
    rings.get(entry.ring).push(entry);
  });
  const orderedRings = Array.from(rings.keys()).sort((a, b) => a - b);
  const frames = [];
  orderedRings.forEach(ringIdx => {
    const ringEntries = rings
      .get(ringIdx)
      .slice()
      .sort((a, b) => a.angle - b.angle);
    if (ringIdx % 2 === 1) {
      ringEntries.reverse();
    }
    ringEntries.forEach(entry => {
      frames.push([entry.id]);
    });
  });
  return frames;
}

function spiralArms(arcgroups) {
  const entries = prepareEntries(arcgroups);
  const tightness = 42;
  const sorted = entries
    .slice()
    .sort((a, b) => {
      const weightA = a.angle + a.ring * tightness;
      const weightB = b.angle + b.ring * tightness;
      if (weightA === weightB) {
        return a.ring - b.ring;
      }
      return weightA - weightB;
    });
  return sorted.map(entry => [entry.id]);
}

function ringWave(arcgroups) {
  const entries = prepareEntries(arcgroups);
  if (!entries.length) {
    return [];
  }
  const maxRing = Math.max(...entries.map(entry => entry.ring));
  const span = Math.max(4, maxRing + 1);
  const bucketMap = new Map();
  entries.forEach(entry => {
    const wavePhase = (Math.sin(entry.angleRad * 2.2) + 1) / 2;
    const offset = Math.round(wavePhase * 2);
    const frameIndex = Math.max(0, Math.min(span - 1, entry.ring + offset));
    if (!bucketMap.has(frameIndex)) {
      bucketMap.set(frameIndex, []);
    }
    bucketMap.get(frameIndex).push(entry);
  });
  const frameIndices = Array.from(bucketMap.keys()).sort((a, b) => a - b);
  return frameIndices.map(idx => {
    const groups = bucketMap.get(idx).sort((a, b) => a.angle - b.angle);
    return groups.map(entry => entry.id);
  });
}

function radiantSpokes(arcgroups) {
  const entries = prepareEntries(arcgroups);
  if (!entries.length) {
    return [];
  }
  const spokes = Math.max(6, Math.round(Math.sqrt(entries.length)));
  const step = 360 / spokes;
  const buckets = new Map();
  entries.forEach(entry => {
    const spokeIndex = Math.round(entry.angle / step) % spokes;
    if (!buckets.has(spokeIndex)) {
      buckets.set(spokeIndex, []);
    }
    buckets.get(spokeIndex).push(entry);
  });
  const ordered = Array.from(buckets.keys()).sort((a, b) => a - b);
  return ordered.map(idx => {
    const groups = buckets
      .get(idx)
      .slice()
      .sort((a, b) => a.ring - b.ring);
    return groups.map(entry => entry.id);
  });
}

const PRESETS = {
  alternating_rings: {
    id: 'alternating_rings',
    name: 'Alternating rings',
    description: 'Runs around each ring, alternating the travel direction per layer.',
    build: alternatingRings,
  },
  spiral_arms: {
    id: 'spiral_arms',
    name: 'Spiral arms sweep',
    description: 'Sweeps outward following a loose logarithmic spiral trajectory.',
    build: spiralArms,
  },
  ring_wave: {
    id: 'ring_wave',
    name: 'Ring wave',
    description: 'Creates a crest moving along the rings with a sinusoidal phase.',
    build: ringWave,
  },
  radiant_spokes: {
    id: 'radiant_spokes',
    name: 'Radiant spokes',
    description: 'Lights spokes by angle, moving from the centre to the outer rim.',
    build: radiantSpokes,
  },
};

function generatePresetFrames(presetId, arcgroups) {
  const preset = PRESETS[presetId];
  if (!preset) {
    return [];
  }
  return preset.build(arcgroups || []) || [];
}

export { PRESETS as ANIMATION_PRESETS, generatePresetFrames };
