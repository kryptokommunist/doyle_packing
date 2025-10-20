const form = document.getElementById('controls');
const preview = document.getElementById('preview');
const statusEl = document.getElementById('status');
const metaGroups = document.getElementById('meta-groups');
const metaPolygons = document.getElementById('meta-polygons');
const metaTime = document.getElementById('meta-time');
const open3dButton = document.getElementById('open-3d');

const numericParsers = {
  p: (v) => parseInt(v, 10),
  q: (v) => parseInt(v, 10),
  t: (v) => parseFloat(v),
  num_gaps: (v) => parseInt(v, 10),
  fill_pattern_spacing: (v) => parseFloat(v),
  fill_pattern_angle: (v) => parseFloat(v),
  fill_pattern_offset: (v) => parseFloat(v),
};

let abortController = null;
let debounceHandle = null;

function updateValueDisplays() {
  form.querySelectorAll('.field__value').forEach((display) => {
    const key = display.dataset.for;
    if (!key) return;
    const input = form.elements[key];
    if (!input) return;
    if (input.type === 'range') {
      const suffix = key === 'fill_pattern_angle' ? '°' : '';
      display.textContent = `${input.value}${suffix}`;
    } else {
      display.textContent = input.value;
    }
  });
}

function updateDependentFields() {
  const patternToggle = form.elements['add_fill_pattern'];
  const enabled = patternToggle?.checked;
  form.querySelectorAll('[data-dependent="add_fill_pattern"]').forEach((group) => {
    group.dataset.hidden = enabled ? 'false' : 'true';
  });
}

function readFormPayload() {
  const payload = {};
  for (const element of form.elements) {
    if (!element.name) continue;
    if (element.type === 'checkbox') {
      payload[element.name] = element.checked;
    } else {
      const parser = numericParsers[element.name];
      payload[element.name] = parser ? parser(element.value) : element.value;
    }
  }
  return payload;
}

function setStatus(text) {
  statusEl.textContent = text;
}

function setPreviewContent(svg) {
  if (!svg) {
    preview.innerHTML = '<div class="preview__empty">Unable to render spiral.</div>';
    return;
  }
  preview.innerHTML = svg;
}

function handleResponse(data) {
  setPreviewContent(data.svg);
  metaGroups.textContent = data.stats?.arcgroups ?? '–';
  metaPolygons.textContent = data.stats?.polygons ?? '–';
  metaTime.textContent = data.rendered_at ?? '–';

  if (data.view_url) {
    open3dButton.disabled = false;
    open3dButton.dataset.href = data.view_url;
  } else {
    open3dButton.disabled = true;
    delete open3dButton.dataset.href;
  }
}

function showError(message) {
  preview.innerHTML = `<div class="preview__empty">${message}</div>`;
  metaGroups.textContent = '–';
  metaPolygons.textContent = '–';
}

function requestSpiralUpdate() {
  const payload = readFormPayload();
  const mode = payload.mode;

  if (abortController) {
    abortController.abort();
  }
  abortController = new AbortController();
  const signal = abortController.signal;

  setStatus('Rendering…');
  preview.classList.add('is-loading');

  fetch('/api/spiral', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal,
  })
    .then(async (response) => {
      if (!response.ok) {
        const message = await response.text();
        throw new Error(message || 'Unable to generate spiral');
      }
      return response.json();
    })
    .then((data) => {
      if (signal.aborted) return;
      handleResponse(data);
      const timestamp = new Date().toLocaleTimeString();
      metaTime.textContent = timestamp;
      setStatus('Ready');
    })
    .catch((error) => {
      if (signal.aborted) return;
      console.error(error);
      showError('Something went wrong while generating the spiral.');
      setStatus('Error');
    })
    .finally(() => {
      if (signal.aborted) return;
      preview.classList.remove('is-loading');
    });

  if (mode !== 'arram_boyle') {
    open3dButton.disabled = true;
    delete open3dButton.dataset.href;
  }
}

function scheduleUpdate() {
  if (debounceHandle) {
    cancelAnimationFrame(debounceHandle);
  }
  debounceHandle = requestAnimationFrame(() => {
    requestSpiralUpdate();
  });
}

form.addEventListener('input', () => {
  updateValueDisplays();
  updateDependentFields();
  scheduleUpdate();
});

form.addEventListener('change', () => {
  updateValueDisplays();
  updateDependentFields();
  scheduleUpdate();
});

open3dButton.addEventListener('click', () => {
  const href = open3dButton.dataset.href;
  if (!href) return;
  window.open(href, '_blank', 'noopener');
});

updateValueDisplays();
updateDependentFields();
scheduleUpdate();
