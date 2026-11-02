import { test } from '@playwright/test';
import fs from 'node:fs';

/**
 * Documents the BASELINE (pre-remediation) build. Run only while `dist/`
 * still contains the original build. Captures screenshots and probe results
 * (no assertions) for the report's before/after comparison.
 */
const BASE = '/iau-experiences/';

// Only run on demand (`RUN_BASELINE_CAPTURE=1 npx playwright test ...`)
// while dist/ still contains the pre-remediation build. Never part of the
// regular suite — it documents the OLD build, not the current one.
test.skip(process.env.RUN_BASELINE_CAPTURE !== '1', 'baseline capture is on-demand only');

test('capture baseline evidence', async ({ browser }) => {
  const outDir = 'audit-artifacts/screenshots/baseline';
  fs.mkdirSync(outDir, { recursive: true });
  const probes = {};

  // Mobile 390
  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await mobile.goto(BASE);
  await mobile.waitForTimeout(1500);
  await mobile.screenshot({ path: `${outDir}/mobile-390-first-view.png` });
  // open dialog
  await mobile.locator('main .grid > div').first().click();
  await mobile.waitForTimeout(700);
  await mobile.screenshot({ path: `${outDir}/mobile-390-dialog.png` });
  probes.mobile_dialog_roleDialog = await mobile.locator('[role="dialog"]').count();
  await mobile.keyboard.press('Escape');
  await mobile.waitForTimeout(500);
  probes.mobile_escape_closes_dialog = (await mobile.locator('.fixed.inset-0.z-50').count()) === 0;
  await mobile.close();

  // Tablet 900 — the dead zone
  const tablet = await browser.newPage({ viewport: { width: 900, height: 800 } });
  await tablet.goto(BASE);
  await tablet.waitForTimeout(1500);
  await tablet.screenshot({ path: `${outDir}/tablet-900-nav-dead-zone.png` });
  probes.tablet900_visibleNavLinks = await tablet.evaluate(
    () => [...document.querySelectorAll('nav a')].filter((a) => a.offsetParent !== null).length
  );
  probes.tablet900_menuButtonVisible = await tablet.evaluate(() => {
    const btn = [...document.querySelectorAll('nav button')].find((b) => b.offsetParent !== null);
    return !!btn;
  });
  // search desync: type at 767 then resize
  await tablet.setViewportSize({ width: 767, height: 900 });
  await tablet.waitForTimeout(400);
  await tablet.locator('input:visible').first().fill('خداپرست');
  await tablet.waitForTimeout(400);
  await tablet.setViewportSize({ width: 900, height: 800 });
  await tablet.waitForTimeout(600);
  probes.search_desync_inputValueAfterResize = await tablet.evaluate(
    () => [...document.querySelectorAll('input')].map((i) => i.value).join('|')
  );
  await tablet.screenshot({ path: `${outDir}/tablet-900-search-desync.png` });
  await tablet.close();

  // Desktop 1280
  const desktop = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await desktop.goto(BASE);
  await desktop.waitForTimeout(1500);
  await desktop.screenshot({ path: `${outDir}/desktop-1280-first-view.png` });
  probes.desktop_visibleNavLinks = await desktop.evaluate(
    () => [...document.querySelectorAll('nav a')].filter((a) => a.offsetParent !== null).length
  );
  await desktop.close();

  fs.writeFileSync('audit-artifacts/baseline-probes.json', JSON.stringify(probes, null, 2));
  console.log('BASELINE PROBES:', JSON.stringify(probes, null, 2));
});
