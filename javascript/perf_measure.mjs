import { performance } from 'node:perf_hooks';
import { renderSpiral, DoyleSpiralEngine, ArcGroup } from './js/doyle_spiral_engine.js';

/**
 * Simple helper that instruments selected methods on the Doyle spiral engine.
 */
class Instrumentation {
  constructor() {
    this.totals = new Map();
    this.counts = new Map();
    this.stats = {
      patternFillTime: 0,
      patternFillCalls: 0,
      outlineTime: 0,
      outlineCalls: 0,
    };
    this.installed = false;
  }

  record(label, duration) {
    const previous = this.totals.get(label) || 0;
    this.totals.set(label, previous + duration);
    this.counts.set(label, (this.counts.get(label) || 0) + 1);
  }

  wrapMethod(prototype, name, label, extra = null) {
    const original = prototype[name];
    if (typeof original !== 'function' || original.__instrumented) {
      return;
    }
    const instrumentation = this;
    const wrapped = function wrappedMethod(...args) {
      const start = performance.now();
      try {
        return original.apply(this, args);
      } finally {
        const duration = performance.now() - start;
        instrumentation.record(label, duration);
        if (extra) {
          extra({ duration, context: this, args });
        }
      }
    };
    wrapped.__instrumented = true;
    prototype[name] = wrapped;
  }

  install() {
    if (this.installed) {
      return;
    }
    this.wrapMethod(DoyleSpiralEngine.prototype, 'generateCircles', 'generateCircles');
    this.wrapMethod(DoyleSpiralEngine.prototype, 'generateOuterCircles', 'generateOuterCircles');
    this.wrapMethod(DoyleSpiralEngine.prototype, 'computeAllIntersections', 'computeAllIntersections');
    this.wrapMethod(DoyleSpiralEngine.prototype, '_createArcGroupsForCircles', 'createArcGroups');
    this.wrapMethod(DoyleSpiralEngine.prototype, '_drawOuterClosureArcs', 'drawOuterClosureArcs');
    this.wrapMethod(DoyleSpiralEngine.prototype, '_extendGroupsWithNeighbours', 'extendGroups');
    this.wrapMethod(ArcGroup.prototype, 'getClosedOutline', 'getClosedOutline', ({ duration }) => {
      this.stats.outlineCalls += 1;
      this.stats.outlineTime += duration;
    });
    this.wrapMethod(ArcGroup.prototype, 'toSVGFill', 'toSVGFill', ({ duration, args }) => {
      if (args?.[1]?.patternFill) {
        this.stats.patternFillTime += duration;
        this.stats.patternFillCalls += 1;
      }
    });
    this.installed = true;
  }

  reset() {
    this.totals.clear();
    this.counts.clear();
    this.stats.patternFillTime = 0;
    this.stats.patternFillCalls = 0;
    this.stats.outlineTime = 0;
    this.stats.outlineCalls = 0;
  }

  summary() {
    return {
      phases: Array.from(this.totals.entries())
        .map(([label, total]) => ({
          label,
          total,
          count: this.counts.get(label) || 0,
        }))
        .sort((a, b) => b.total - a.total),
      patternFill: {
        time: this.stats.patternFillTime,
        calls: this.stats.patternFillCalls,
      },
      outlines: {
        calls: this.stats.outlineCalls,
        time: this.stats.outlineTime,
      },
    };
  }
}

const instrumentation = new Instrumentation();
instrumentation.install();

/**
 * Minimal DOM element stand-in so the engine can emit SVG in Node.js.
 */
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

/**
 * Run a single render and capture duration and instrumentation details.
 * @param {{ p: number, q: number, fill_pattern_spacing: number }} params
 * @param {boolean} withPattern
 */
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

/**
 * Print the most expensive phases collected by instrumentation.
 * @param {string} title
 * @param {ReturnType<Instrumentation['summary']>} summary
 * @param {number} [limit=6]
 */
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
