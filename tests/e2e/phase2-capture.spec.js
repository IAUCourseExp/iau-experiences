import { test } from '@playwright/test';
import fs from 'node:fs';

// Phase-2 "after" evidence capture for the report's visual review section.
// Run on demand: RUN_PHASE2_CAPTURE=1 npx playwright test tests/e2e/phase2-capture.spec.js
test.skip(process.env.RUN_PHASE2_CAPTURE !== '1', 'phase-2 capture is on-demand only');

test('capture phase-2 after screenshots', async ({ browser }) => {
  const outDir = 'audit-artifacts/phase-2/after';
  fs.mkdirSync(outDir, { recursive: true });

  // Mobile journeys
  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  await mobile.goto('/iau-experiences/');
  await mobile.waitForTimeout(1800);
  await mobile.screenshot({ path: `${outDir}/mobile-390-home.png` });

  await mobile.goto('/iau-experiences/#/explore');
  await mobile.waitForTimeout(1800);
  await mobile.locator('#explorer-search').fill('حضور و غیاب');
  await mobile.waitForTimeout(600);
  await mobile.screenshot({ path: `${outDir}/mobile-390-fulltext-results.png` });

  await mobile.getByRole('button', { name: /امتحان و نمره‌دهی/ }).click();
  await mobile.waitForTimeout(600);
  await mobile.screenshot({ path: `${outDir}/mobile-390-topic-explorer.png` });

  await mobile.getByRole('button', { name: 'مشاهده کامل' }).first().click();
  await mobile.waitForTimeout(800);
  await mobile.screenshot({ path: `${outDir}/mobile-390-details-dialog.png` });
  await mobile.keyboard.press('Escape');
  await mobile.close();

  // Tablet navigation + profile
  const tablet = await browser.newPage({ viewport: { width: 820, height: 1180 }, hasTouch: true, isMobile: true });
  await tablet.goto('/iau-experiences/#/professors');
  await tablet.waitForTimeout(1800);
  await tablet.screenshot({ path: `${outDir}/tablet-820-directory.png` });
  await tablet.close();

  // Desktop views
  const desktop = await browser.newPage({ viewport: { width: 1366, height: 768 } });
  await desktop.goto('/iau-experiences/');
  await desktop.waitForTimeout(1800);
  await desktop.screenshot({ path: `${outDir}/desktop-1366-home.png` });

  await desktop.goto('/iau-experiences/#/professor/%D8%AD%D8%A7%D9%85%D8%AF%20%D8%AE%D8%AF%D8%A7%D9%BE%D8%B1%D8%B3%D8%AA');
  await desktop.waitForTimeout(1800);
  await desktop.screenshot({ path: `${outDir}/desktop-1366-professor-profile.png` });

  await desktop.goto('/iau-experiences/#/explore');
  await desktop.waitForTimeout(1800);
  await desktop.locator('#explorer-search').fill('امتحان');
  await desktop.waitForTimeout(600);
  await desktop.screenshot({ path: `${outDir}/desktop-1366-explorer.png` });

  await desktop.goto('/iau-experiences/#/course/%D9%87%D9%88%D8%B4%20%D9%85%D8%B5%D9%86%D9%88%D8%B9%DB%8C');
  await desktop.waitForTimeout(1800);
  const chips = desktop.locator('main button[aria-pressed]').filter({ hasText: /[(][\u06F0-\u06F9]+[)]$/ });
  await chips.nth(0).click();
  await chips.nth(1).click();
  await desktop.waitForTimeout(500);
  await desktop.screenshot({ path: `${outDir}/desktop-1366-comparison.png` });
  await desktop.close();
});
