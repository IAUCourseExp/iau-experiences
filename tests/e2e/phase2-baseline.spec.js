import { test } from '@playwright/test';
import fs from 'node:fs';

// Captures the Phase-2 (pre-expansion) baseline of the current build.
// Run on demand: RUN_PHASE2_BASELINE=1 npx playwright test tests/e2e/phase2-baseline.spec.js
test.skip(process.env.RUN_PHASE2_BASELINE !== '1', 'phase-2 baseline capture is on-demand only');

test('capture phase-2 baseline screenshots', async ({ browser }) => {
  const outDir = 'audit-artifacts/phase-2/baseline';
  fs.mkdirSync(outDir, { recursive: true });

  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  await mobile.goto('/iau-experiences/');
  await mobile.waitForTimeout(1800);
  await mobile.screenshot({ path: `${outDir}/mobile-390-home.png` });
  await mobile.close();

  const tablet = await browser.newPage({ viewport: { width: 820, height: 1180 }, hasTouch: true, isMobile: true });
  await tablet.goto('/iau-experiences/');
  await tablet.waitForTimeout(1800);
  await tablet.screenshot({ path: `${outDir}/tablet-820-home.png` });
  await tablet.close();

  const desktop = await browser.newPage({ viewport: { width: 1366, height: 768 } });
  await desktop.goto('/iau-experiences/');
  await desktop.waitForTimeout(1800);
  await desktop.screenshot({ path: `${outDir}/desktop-1366-home.png` });
  await desktop.close();
});
