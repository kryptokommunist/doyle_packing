import { performance } from 'node:perf_hooks';
import { renderSpiral } from './js/doyle_spiral_engine.js';

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
  const start = performance.now();
  const result = renderSpiral({
    ...params,
    mode: 'arram_boyle',
    add_fill_pattern: withPattern,
    draw_group_outline: false,
  });
  const duration = performance.now() - start;
  const svgLength = result.svgString ? result.svgString.length : 0;
  return { duration, svgLength };
}

function formatDuration(ms) {
  return `${ms.toFixed(2)} ms`;
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
  }
}
