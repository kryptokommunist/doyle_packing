import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  // Wait for the app to load and the default render to complete
  await page.waitForSelector('#svgPreview svg', { timeout: 15000 });
});

test('breakdown mode checkbox shows/hides breakdown settings', async ({ page }) => {
  const settings = page.locator('#breakdownSettings');
  await expect(settings).toBeHidden();

  await page.locator('#breakdownMode').check();
  await expect(settings).toBeVisible();

  await page.locator('#breakdownMode').uncheck();
  await expect(settings).toBeHidden();
});

test('breakdown mode relabels export buttons', async ({ page }) => {
  const svgBtn = page.locator('#exportSvgButton');
  const dxfBtn = page.locator('#exportDxfButton');

  await expect(svgBtn).toHaveText('Download SVG');
  await expect(dxfBtn).toHaveText('Download DXF');

  await page.locator('#breakdownMode').check();

  await expect(svgBtn).toHaveText('Breakdown SVG');
  await expect(dxfBtn).toHaveText('Breakdown DXF');

  await page.locator('#breakdownMode').uncheck();

  await expect(svgBtn).toHaveText('Download SVG');
  await expect(dxfBtn).toHaveText('Download DXF');
});

test('breakdown mode shows workpiece count after render', async ({ page }) => {
  await page.locator('#breakdownMode').check();
  // Wait for re-render to complete
  await page.waitForTimeout(1000);
  const countEl = page.locator('#breakdownRingCount');
  await expect(countEl).not.toBeEmpty();
  const text = await countEl.textContent();
  expect(text).toMatch(/\d+ workpiece/);
});

test('breakdown SVG download produces a zip file', async ({ page }) => {
  await page.locator('#breakdownMode').check();
  await page.locator('#workpieceWidth').fill('80');
  await page.locator('#workpieceHeight').fill('80');
  await page.locator('#workpieceWidth').dispatchEvent('change');
  await page.waitForTimeout(1500);

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('#exportSvgButton').click(),
  ]);

  expect(download.suggestedFilename()).toMatch(/\.zip$/);
});

test('breakdown DXF download produces a zip file', async ({ page }) => {
  await page.locator('#breakdownMode').check();
  await page.locator('#workpieceWidth').fill('80');
  await page.locator('#workpieceHeight').fill('80');
  await page.locator('#workpieceWidth').dispatchEvent('change');
  await page.waitForTimeout(1500);

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('#exportDxfButton').click(),
  ]);

  expect(download.suggestedFilename()).toMatch(/\.zip$/);
});

test('shows error status when workpiece box is too small', async ({ page }) => {
  await page.locator('#breakdownMode').check();
  await page.locator('#workpieceWidth').fill('0.001');
  await page.locator('#workpieceHeight').fill('0.001');
  await page.locator('#workpieceWidth').dispatchEvent('change');
  await page.waitForTimeout(1500);

  await page.locator('#exportSvgButton').click();

  const status = page.locator('#statusMessage');
  await expect(status).toContainText('No rings fit');
});

test('normal SVG download still works when breakdown mode is off', async ({ page }) => {
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('#exportSvgButton').click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/\.svg$/);
});

test('normal DXF download still works when breakdown mode is off', async ({ page }) => {
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('#exportDxfButton').click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/\.dxf$/);
});

test('breakdown mode forces red outline in preview', async ({ page }) => {
  // Ensure red outline is off normally
  const redToggle = page.locator('#toggleRed');
  if (await redToggle.isChecked()) {
    await redToggle.uncheck();
    await page.waitForTimeout(500);
  }

  await page.locator('#breakdownMode').check();
  await page.waitForTimeout(1000);

  // After breakdown mode, SVG should contain red stroke elements
  const svgContent = await page.locator('#svgPreview svg').innerHTML();
  expect(svgContent).toMatch(/stroke.*#ff0000|stroke.*red|color.*red/i);
});
