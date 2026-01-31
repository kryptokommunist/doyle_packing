import { performance } from 'node:perf_hooks';
import { renderSpiral, DoyleSpiralEngine, ArcGroup } from './js/doyle_spiral_engine.js';

function createInstrumentation() {
  const totals = new Map();
  const counts = new Map();
  const stats = {
    patternFillTime: 0,
    patternFillCalls: 0,
    outlineTime: 0,
    outlineCalls: 0,
  };

  const record = (label, duration) => {
    const prev = totals.get(label) || 0;
    totals.set(label, prev + duration);
    counts.set(label, (counts.get(label) || 0) + 1);
  };

  const wrapMethod = (prototype, name, label, extra = null) => {
    const original = prototype[name];
    if (typeof original !== 'function' || original.__instrumented) {
      return;
    }
    const wrapped = function wrappedMethod(...args) {
      const start = performance.now();
      try {
        return original.apply(this, args);
      } finally {
        const duration = performance.now() - start;
        record(label, duration);
        if (extra) {
          extra({ duration, context: this, args });
        }
      }
    };
    wrapped.__instrumented = true;
    prototype[name] = wrapped;
  };

  wrapMethod(DoyleSpiralEngine.prototype, 'generateCircles', 'generateCircles');
  wrapMethod(DoyleSpiralEngine.prototype, 'generateOuterCircles', 'generateOuterCircles');
  wrapMethod(DoyleSpiralEngine.prototype, 'computeAllIntersections', 'computeAllIntersections');
  wrapMethod(DoyleSpiralEngine.prototype, '_createArcGroupsForCircles', 'createArcGroups');
  wrapMethod(DoyleSpiralEngine.prototype, '_createArcGroupsSymmetric', 'createArcGroupsSymmetric');
  wrapMethod(DoyleSpiralEngine.prototype, '_drawOuterClosureArcs', 'drawOuterClosureArcs');
  wrapMethod(DoyleSpiralEngine.prototype, '_extendGroupsWithNeighbours', 'extendGroups');
  wrapMethod(DoyleSpiralEngine.prototype, '_finalizeRingTemplates', 'finalizeRingTemplates');
  wrapMethod(ArcGroup.prototype, 'getClosedOutline', 'getClosedOutline', ({ duration }) => {
    stats.outlineCalls += 1;
    stats.outlineTime += duration;
  });
  wrapMethod(ArcGroup.prototype, 'toSVGFill', 'toSVGFill', ({ duration, args }) => {
    if (args?.[1]?.patternFill) {
      stats.patternFillTime += duration;
      stats.patternFillCalls += 1;
    }
  });

  return {
    reset() {
      totals.clear();
      counts.clear();
      stats.patternFillTime = 0;
      stats.patternFillCalls = 0;
      stats.outlineTime = 0;
      stats.outlineCalls = 0;
    },
    summary() {
      return {
        phases: Array.from(totals.entries())
          .map(([label, total]) => ({
            label,
            total,
            count: counts.get(label) || 0,
          }))
          .sort((a, b) => b.total - a.total),
        patternFill: {
          time: stats.patternFillTime,
          calls: stats.patternFillCalls,
        },
        outlines: {
          calls: stats.outlineCalls,
          time: stats.outlineTime,
        },
      };
    },
  };
}

const instrumentation = createInstrumentation();

class FakeElement {
  constructor(tagName) {
    this.tagName = tagName;
    this.attributes = new Map();
    this.children = [];
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  setAttributeNS(_ns, name, value) {
    this.attributes.set(name, String(value));
  }

  appendChild(child) {
    this.children.push(child);
    return child;
  }

  replaceChildren(...children) {
    this.children = children;
  }
}

global.document = {
  createElementNS(_ns, tag) {
    return new FakeElement(tag);
  },
  createElement(tag) {
    return new FakeElement(tag);
  },
};

global.XMLSerializer = class {
  serializeToString(element) {
    return `<${element.tagName}>`;
  }
};

function measure(params, withPattern) {
  instrumentation.reset();
  const start = performance.now();
  const result = renderSpiral({
    ...params,
    mode: 'arram_boyle',
    add_fill_pattern: withPattern,
    draw_group_outline: false,
  });
  const duration = performance.now() - start;
  const svgLength = result.svgString ? result.svgString.length : 0;
  const summary = instrumentation.summary();
  return { duration, svgLength, summary };
}

function formatDuration(ms) {
  return `${ms.toFixed(2)} ms`;
}

function logSummary(title, summary, limit = 10) {
  if (!summary || !summary.phases || !summary.phases.length) {
    return;
  }
  console.log(title);
  const entries = summary.phases.slice(0, limit);
  for (const entry of entries) {
    console.log(
      `    ${entry.label.padEnd(30)} ${formatDuration(entry.total).padStart(12)} (${entry.count}x)`,
    );
  }
  if (summary.patternFill.calls) {
    console.log(
      `    ${'patternFill(total)'.padEnd(30)} ${formatDuration(summary.patternFill.time).padStart(12)} (${summary.patternFill.calls} calls)`,
    );
  }
  if (summary.outlines.calls) {
    console.log(
      `    ${'getClosedOutline(total)'.padEnd(30)} ${formatDuration(summary.outlines.time).padStart(12)} (${summary.outlines.calls} calls)`,
    );
  }
}

console.log('='.repeat(80));
console.log('PERFORMANCE COMPARISON: p==q (Symmetric) vs p!=q (Non-symmetric)');
console.log('='.repeat(80));
console.log();

// Test p==q (symmetric mode should use optimizations)
console.log('━'.repeat(80));
console.log('TEST 1: p==q (SYMMETRIC MODE - Should use optimizations)');
console.log('━'.repeat(80));
const symmetricCases = [
  { p: 16, q: 16, desc: 'Small (16x16)' },
  { p: 32, q: 32, desc: 'Medium (32x32)' },
  { p: 64, q: 64, desc: 'Large (64x64)' },
];

for (const { p, q, desc } of symmetricCases) {
  const params = { p, q, fill_pattern_spacing: 5, use_symmetric: true };
  const withPattern = measure(params, true);
  const withoutPattern = measure(params, false);
  console.log();
  console.log(`${desc}:`);
  console.log(`  Pattern mode: ${formatDuration(withPattern.duration)}`);
  console.log(`  Plain mode:   ${formatDuration(withoutPattern.duration)}`);

  if (p === 64) {
    console.log();
    logSummary('  Pattern mode breakdown:', withPattern.summary);
    console.log();
    logSummary('  Plain mode breakdown:', withoutPattern.summary);
  }
}

console.log();
console.log('━'.repeat(80));
console.log('TEST 2: p!=q (NON-SYMMETRIC MODE - No optimizations)');
console.log('━'.repeat(80));

const asymmetricCases = [
  { p: 16, q: 18, desc: 'Small (16x18)' },
  { p: 32, q: 36, desc: 'Medium (32x36)' },
  { p: 64, q: 68, desc: 'Large (64x68)' },
];

for (const { p, q, desc } of asymmetricCases) {
  const params = { p, q, fill_pattern_spacing: 5, use_symmetric: true };
  const withPattern = measure(params, true);
  const withoutPattern = measure(params, false);
  console.log();
  console.log(`${desc}:`);
  console.log(`  Pattern mode: ${formatDuration(withPattern.duration)}`);
  console.log(`  Plain mode:   ${formatDuration(withoutPattern.duration)}`);

  if (p === 64) {
    console.log();
    logSummary('  Pattern mode breakdown:', withPattern.summary);
    console.log();
    logSummary('  Plain mode breakdown:', withoutPattern.summary);
  }
}

console.log();
console.log('━'.repeat(80));
console.log('TEST 3: DIRECT COMPARISON at p=q=64');
console.log('━'.repeat(80));
console.log();

const symResult = measure({ p: 64, q: 64, fill_pattern_spacing: 5, use_symmetric: true }, false);
const asymResult = measure({ p: 64, q: 68, fill_pattern_spacing: 5, use_symmetric: true }, false);

console.log(`Symmetric (p=q=64):     ${formatDuration(symResult.duration)}`);
console.log(`Non-symmetric (p=64, q=68): ${formatDuration(asymResult.duration)}`);
console.log();

const speedup = ((asymResult.duration - symResult.duration) / asymResult.duration * 100);
console.log(`Speedup from symmetric optimization: ${speedup.toFixed(1)}%`);
console.log();

console.log('Outline computation comparison:');
console.log(`  Symmetric:     ${symResult.summary.outlines.calls} calls in ${formatDuration(symResult.summary.outlines.time)}`);
console.log(`  Non-symmetric: ${asymResult.summary.outlines.calls} calls in ${formatDuration(asymResult.summary.outlines.time)}`);
const outlineReduction = ((asymResult.summary.outlines.calls - symResult.summary.outlines.calls) / asymResult.summary.outlines.calls * 100);
console.log(`  Outline call reduction: ${outlineReduction.toFixed(1)}%`);

console.log();
console.log('='.repeat(80));
