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
  wrapMethod(DoyleSpiralEngine.prototype, '_drawOuterClosureArcs', 'drawOuterClosureArcs');
  wrapMethod(DoyleSpiralEngine.prototype, '_extendGroupsWithNeighbours', 'extendGroups');
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

function logSummary(title, summary, limit = 6) {
  if (!summary || !summary.phases || !summary.phases.length) {
    return;
  }
  console.log(title);
  const entries = summary.phases.slice(0, limit);
  for (const entry of entries) {
    console.log(
      `    ${entry.label.padEnd(28)} ${formatDuration(entry.total)} (${entry.count}x)`,
    );
  }
  if (summary.patternFill.calls) {
    console.log(
      `    patternFill(total)             ${formatDuration(summary.patternFill.time)} (${summary.patternFill.calls} calls)`,
    );
  }
  if (summary.outlines.calls) {
    console.log(
      `    outlines(computed)             ${summary.outlines.calls} calls, ${formatDuration(summary.outlines.time)}`,
    );
  }
}

const cases = [16, 32, 64];
for (const spacing of [5, 2]) {
  console.log(`Spacing ${spacing}`);
  for (const value of cases) {
    const params = { p: value, q: value, fill_pattern_spacing: spacing };
    const withPattern = measure(params, true);
    const withoutPattern = measure(params, false);
    console.log(
      `  p=q=${value}: pattern ${formatDuration(withPattern.duration)}, plain ${formatDuration(withoutPattern.duration)}`,
    );
    if (value === 64 && spacing === 5) {
      logSummary('    pattern breakdown', withPattern.summary);
      logSummary('    plain breakdown', withoutPattern.summary);
    }
  }
}
