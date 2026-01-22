import { performance } from 'node:perf_hooks';
import { renderSpiral, DoyleSpiralEngine } from './js/doyle_spiral_engine.js';

// Track which method was called
let symmetricCalled = false;
let nonSymmetricCalled = false;

const originalSymmetric = DoyleSpiralEngine.prototype._createArcGroupsSymmetric;
const originalNonSymmetric = DoyleSpiralEngine.prototype._createArcGroupsForCircles;

DoyleSpiralEngine.prototype._createArcGroupsSymmetric = function(...args) {
  symmetricCalled = true;
  return originalSymmetric.apply(this, args);
};

DoyleSpiralEngine.prototype._createArcGroupsForCircles = function(...args) {
  nonSymmetricCalled = true;
  return originalNonSymmetric.apply(this, args);
};

// Fake DOM for Node.js
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

function test(params, description) {
  symmetricCalled = false;
  nonSymmetricCalled = false;

  console.log(`\nTesting: ${description}`);
  console.log(`  Params: p=${params.p}, q=${params.q}, use_symmetric=${params.use_symmetric ?? 'default(true)'}`);

  const start = performance.now();
  renderSpiral({
    ...params,
    mode: 'arram_boyle',
    add_fill_pattern: false,
    draw_group_outline: false,
  });
  const duration = performance.now() - start;

  console.log(`  Duration: ${duration.toFixed(2)} ms`);
  console.log(`  Method used: ${symmetricCalled ? '_createArcGroupsSymmetric ✓' : ''} ${nonSymmetricCalled ? '_createArcGroupsForCircles' : ''}`);

  if (params.p === params.q && params.use_symmetric !== false) {
    if (symmetricCalled) {
      console.log(`  ✓ CORRECT: Symmetric mode used for p==q`);
    } else {
      console.log(`  ✗ ERROR: Should use symmetric mode but didn't!`);
    }
  } else {
    if (nonSymmetricCalled) {
      console.log(`  ✓ CORRECT: Non-symmetric mode used`);
    } else {
      console.log(`  ✗ ERROR: Should use non-symmetric mode but didn't!`);
    }
  }
}

console.log('='.repeat(80));
console.log('VERIFICATION: Which mode is being used?');
console.log('='.repeat(80));

// Test 1: p==q with explicit use_symmetric: true
test({ p: 32, q: 32, use_symmetric: true }, 'p==q with use_symmetric=true');

// Test 2: p==q with default (should default to true)
test({ p: 32, q: 32 }, 'p==q with default use_symmetric');

// Test 3: p==q with explicit use_symmetric: false
test({ p: 32, q: 32, use_symmetric: false }, 'p==q with use_symmetric=false');

// Test 4: p!=q with use_symmetric: true (should still use non-symmetric because p!=q)
test({ p: 32, q: 36, use_symmetric: true }, 'p!=q with use_symmetric=true');

// Test 5: p!=q with default
test({ p: 32, q: 36 }, 'p!=q with default use_symmetric');

console.log('\n' + '='.repeat(80));
console.log('SUMMARY:');
console.log('  - use_symmetric defaults to TRUE');
console.log('  - When p==q AND use_symmetric!=false, uses _createArcGroupsSymmetric');
console.log('  - When p!=q OR use_symmetric==false, uses _createArcGroupsForCircles');
console.log('='.repeat(80));
