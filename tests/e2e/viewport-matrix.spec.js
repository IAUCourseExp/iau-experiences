import { test, expect } from '@playwright/test';
import fs from 'node:fs';

/**
 * Mission §9.1 responsive matrix. For every required viewport:
 *  - no unintended horizontal overflow
 *  - correct navigation model (inline links ≥1024 px, hamburger <1024 px)
 *  - cards render
 *  - search field visible
 *  - details dialog opens and closes
 * Results are written to audit-artifacts/viewport-matrix.json and asserted.
 */

const VIEWPORTS = [
  { name: '320x568 very-small-phone', width: 320, height: 568, mobile: true },
  { name: '360x640 small-phone', width: 360, height: 640, mobile: true },
  { name: '360x800 typical-phone', width: 360, height: 800, mobile: true },
  { name: '375x812 iphone-style', width: 375, height: 812, mobile: true },
  { name: '390x844 modern-phone', width: 390, height: 844, mobile: true },
  { name: '412x915 modern-large-phone', width: 412, height: 915, mobile: true },
  { name: '430x932 large-phone', width: 430, height: 932, mobile: true },
  { name: '600x960 small-tablet', width: 600, height: 960, mobile: true },
  { name: '767x1024 breakpoint-below', width: 767, height: 1024, mobile: true },
  { name: '768x1024 tablet', width: 768, height: 1024, mobile: true },
  { name: '820x1180 tablet-portrait', width: 820, height: 1180, mobile: true },
  { name: '1023x768 breakpoint-below-lg', width: 1023, height: 768, mobile: true },
  { name: '1024x768 tablet-landscape', width: 1024, height: 768, mobile: false },
  { name: '1280x800 small-desktop', width: 1280, height: 800, mobile: false },
  { name: '1366x768 desktop', width: 1366, height: 768, mobile: false },
  { name: '1440x900 large-desktop', width: 1440, height: 900, mobile: false },
  { name: '1920x1080 full-hd', width: 1920, height: 1080, mobile: false },
  { name: '390x844 landscape-phone', width: 844, height: 390, mobile: true },
];

test.describe.configure({ mode: 'serial' });

test('viewport matrix sweep', async ({ browser }) => {
  test.setTimeout(300_000); // 18 viewports × (browse + profiles + explorer)
  const results = [];
  const failures = [];

  for (const vp of VIEWPORTS) {
    const context = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      hasTouch: vp.mobile,
      isMobile: vp.mobile && vp.width < 700,
    });
    const page = await context.newPage();
    const r = { viewport: vp.name, checks: {} };
    try {
      await page.goto('/iau-experiences/');
      await expect(page.locator('main article').first()).toBeVisible({ timeout: 20_000 });
      r.checks.cardsRender = true;

      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth
      );
      r.checks.horizontalOverflowPx = overflow;
      if (overflow > 0) failures.push(`${vp.name}: horizontal overflow ${overflow}px`);

      const navModel = await page.evaluate(() => {
        const inlineLinks = [...document.querySelectorAll('nav a')].filter(
          (a) => a.offsetParent !== null && !a.closest('#mobile-menu')
        ).length;
        const menuButton = [...document.querySelectorAll('nav button')].find(
          (b) => b.offsetParent !== null && (b.getAttribute('aria-label') || '').includes('منو')
        );
        return { inlineLinks, hasMenuButton: !!menuButton };
      });
      r.checks.navModel = navModel;
      if (vp.width >= 1024 && navModel.inlineLinks < 4) {
        failures.push(`${vp.name}: expected 4 inline nav links, got ${navModel.inlineLinks}`);
      }
      if (vp.width < 1024 && !navModel.hasMenuButton) {
        failures.push(`${vp.name}: hamburger menu button missing`);
      }

      // search field visible and operable
      const searchVisible = await page.locator('input[type="search"]:visible').count();
      r.checks.searchVisible = searchVisible > 0;
      if (!r.checks.searchVisible) failures.push(`${vp.name}: no visible search field`);

      // dialog opens and closes
      await page.getByRole('button', { name: /مشاهده جزئیات تجربه/ }).first().click();
      await expect(page.getByRole('dialog')).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog')).toBeHidden();
      r.checks.dialogOpenClose = true;

      // Phase II sections: profiles + explorer render without overflow
      for (const section of ['professors', 'explore']) {
        await page.goto(`/iau-experiences/#/${section}`);
        await expect(page.locator('main h1')).toBeVisible({ timeout: 15_000 });
        await page.waitForTimeout(400); // lazy chunk + data
        const overflow2 = await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth
        );
        r.checks[`${section}OverflowPx`] = overflow2;
        if (overflow2 > 0) failures.push(`${vp.name}: horizontal overflow on #/${section} (${overflow2}px)`);
        const boundaryShown = await page.evaluate(() => document.body.innerText.includes('مشکلی پیش آمد'));
        if (boundaryShown) failures.push(`${vp.name}: error boundary on #/${section}`);
      }
      await page.goto('/iau-experiences/');

      // representative screenshots for the report
      if (['390x844 modern-phone', '768x1024 tablet', '1023x768 breakpoint-below-lg', '1366x768 desktop'].includes(vp.name)) {
        await page.screenshot({ path: `audit-artifacts/screenshots/after/matrix-${vp.name}.png` });
      }
    } catch (err) {
      failures.push(`${vp.name}: ${String(err).slice(0, 200)}`);
      r.checks.error = String(err).slice(0, 200);
    }
    results.push(r);
    await context.close();
  }

  fs.mkdirSync('audit-artifacts', { recursive: true });
  fs.writeFileSync('audit-artifacts/viewport-matrix.json', JSON.stringify(results, null, 2));
  expect(failures, `viewport failures:\n${failures.join('\n')}`).toEqual([]);
});
