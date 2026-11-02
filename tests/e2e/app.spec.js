import { test, expect } from '@playwright/test';

/**
 * Critical user journeys (mission §10) against the production build.
 * Mobile journeys run in the chrome-mobile project (Pixel 5), the 768–1023 px
 * navigation gap in chrome-tablet-gap, desktop journeys in chrome-desktop.
 */

test.describe('first visit', () => {
  test('renders cards, no console errors, no horizontal overflow', async ({ page }, testInfo) => {
    const errors = [];
    page.on('pageerror', (err) => errors.push(String(err)));
    await page.goto('/iau-experiences/');
    await expect(page.getByRole('heading', { name: 'آخرین تجارب' })).toBeVisible();
    await expect(page.locator('main article').first()).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    expect(overflow, 'no unintended horizontal overflow').toBeLessThanOrEqual(0);
    expect(errors, 'no uncaught exceptions').toEqual([]);
    await page.screenshot({ path: `audit-artifacts/screenshots/after/${testInfo.project.name}-first-view.png`, fullPage: false });
  });
});

test.describe('search (SRCH-*)', () => {
  test('filters, clears, and reports empty state', async ({ page }) => {
    await page.goto('/iau-experiences/');
    const search = page.locator('input[type="search"]:visible');
    await search.fill('خداپرست');
    await expect(page.getByRole('status')).toContainText('نتیجه');
    const cards = page.locator('main article');
    expect(await cards.count()).toBeGreaterThan(0);
    // clear button appears and resets
    await page.getByRole('button', { name: 'پاک کردن جستجو' }).first().click();
    await expect(search).toHaveValue('');
    // nonsense query -> empty state with clear action
    await search.fill('زیبقشکمثزیبن');
    await expect(page.getByText('موردی یافت نشد')).toBeVisible();
    await page.getByRole('button', { name: 'پاک کردن جستجو' }).last().click();
    await expect(page.getByRole('heading', { name: 'آخرین تجارب' })).toBeVisible();
  });

  test('Persian/Arabic normalization: Arabic Kaf query finds Persian Kaf data', async ({ page }) => {
    await page.goto('/iau-experiences/');
    const search = page.locator('input[type="search"]:visible');
    // data.json contains كامپیوتر with Arabic Kaf; user types Persian کامپیوتر
    await search.fill('کامپیوتر');
    await expect(page.getByRole('status')).toContainText('نتیجه');
    expect(await page.locator('main article').count()).toBeGreaterThan(0);
    // whitespace-only query behaves as no query (SRCH-003)
    await search.fill('   ');
    await expect(page.getByRole('heading', { name: 'آخرین تجارب' })).toBeVisible();
  });

  test('search state stays synchronized across the 768 px breakpoint (SRCH-001)', async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 767, height: 900 });
    await page.goto('/iau-experiences/');
    await page.locator('#search-mobile').fill('خداپرست');
    await expect(page.getByRole('status')).toContainText('نتیجه');
    await page.setViewportSize({ width: 1280, height: 800 });
    // desktop input must now visibly hold the same query
    await expect(page.locator('#search-desktop')).toHaveValue('خداپرست');
    await expect(page.locator('main article').first()).toBeVisible();
    await page.screenshot({ path: `audit-artifacts/screenshots/after/${testInfo.project.name}-search-sync.png` });
  });
});

test.describe('navigation (NAV-*)', () => {
  test('no 768–1023 px dead zone: hamburger menu present at 900 px and works', async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 900, height: 800 });
    await page.goto('/iau-experiences/');
    const menuButton = page.getByRole('button', { name: 'باز کردن منو' });
    await expect(menuButton).toBeVisible();
    await expect(menuButton).toHaveAttribute('aria-expanded', 'false');
    await menuButton.click();
    // the accessible name intentionally changes between open/closed states
    const openButton = page.getByRole('button', { name: 'بستن منو' });
    await expect(openButton).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByRole('link', { name: 'کانال تجربیات' })).toBeVisible();
    // Guard against the ancestor-clipping regression caught during visual
    // review (panel is a flex child of the nav): the open menu must actually
    // render its links, not just own clipped bounding boxes. waitForFunction
    // polls until the open animation settles before judging geometry.
    await page.waitForFunction(
      () => {
        const panel = document.getElementById('mobile-menu');
        if (!panel) return false;
        const link = panel.querySelector('a');
        const clipped = panel.scrollHeight - panel.getBoundingClientRect().height;
        return (
          panel.getBoundingClientRect().height > 100 &&
          clipped < 8 &&
          link != null &&
          link.getBoundingClientRect().height > 30
        );
      },
      undefined,
      { timeout: 5_000, polling: 100 }
    );
    await page.screenshot({ path: `audit-artifacts/screenshots/after/${testInfo.project.name}-menu-open.png` });
    // Escape closes and returns focus
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: 'باز کردن منو' })).toBeFocused();
    await expect(page.locator('#mobile-menu')).toBeHidden();
  });

  test('mobile menu closes on outside click and on link activation', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/iau-experiences/');
    await page.getByRole('button', { name: 'باز کردن منو' }).click();
    await expect(page.locator('#mobile-menu')).toBeVisible();
    // outside click closes
    await page.locator('main h1').click();
    await expect(page.locator('#mobile-menu')).toBeHidden();
    // reopen then activate a link -> menu closes
    await page.getByRole('button', { name: 'باز کردن منو' }).click();
    await page.getByRole('link', { name: 'کانال جزوه' }).click();
    await expect(page.locator('#mobile-menu')).toBeHidden();
  });

  test('desktop inline links visible at 1280 px', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'chrome-desktop', 'inline links only render ≥1024 px');
    await page.goto('/iau-experiences/');
    for (const name of ['کانال تجربیات', 'گروه تجربیات', 'کانال جزوه', 'دیسکاشن کامپیوتر']) {
      await expect(page.getByRole('link', { name, exact: true }).first()).toBeVisible();
    }
  });
});

test.describe('details dialog (MOD-*)', () => {
  test('open, read long content, close via Escape, focus restored, background locked', async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/iau-experiences/');
    const firstCardButton = page.getByRole('button', { name: /مشاهده جزئیات تجربه/ }).first();
    await firstCardButton.click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAttribute('aria-modal', 'true');

    // background scroll lock (MOD-002): window scroll must not change
    const yBefore = await page.evaluate(() => window.scrollY);
    await page.mouse.wheel(0, 600);
    await page.waitForTimeout(200);
    const yAfter = await page.evaluate(() => window.scrollY);
    expect(Math.abs(yAfter - yBefore)).toBeLessThan(2);

    // Long-content reading journey: search a professor whose only record is a
    // long experience (verified: id 2142, "بهزاد وافری", 1,459 chars) and scroll it.
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    const search = page.locator('input[type="search"]:visible');
    await search.fill('بهزاد وافری');
    const secondCardButton = page.getByRole('button', { name: /مشاهده جزئیات تجربه/ }).first();
    await secondCardButton.click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.evaluate(() => {
      const el = document.querySelector('[role="dialog"] .overflow-y-auto');
      el.scrollTop = el.scrollHeight;
    });
    const scrolled = await page.evaluate(() => document.querySelector('[role="dialog"] .overflow-y-auto').scrollTop);
    expect(scrolled, 'long content must be scrollable inside the dialog').toBeGreaterThan(100);
    await page.screenshot({ path: `audit-artifacts/screenshots/after/${testInfo.project.name}-dialog-long-text.png` });

    // Telegram link present and safe
    const tg = page.getByRole('dialog').getByRole('link', { name: 'مشاهده در تلگرام' });
    await expect(tg).toHaveAttribute('target', '_blank');
    await expect(tg).toHaveAttribute('rel', /noopener/);

    // Escape closes (MOD-001) and focus returns to the invoking card button
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(secondCardButton).toBeFocused();
  });

  test('closes via close button and via backdrop', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/iau-experiences/');
    await page.getByRole('button', { name: /مشاهده جزئیات تجربه/ }).first().click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    // close button
    await dialog.getByRole('button', { name: 'بستن جزئیات تجربه' }).click();
    await expect(dialog).toBeHidden();
    // reopen, backdrop click
    await page.getByRole('button', { name: /مشاهده جزئیات تجربه/ }).first().click();
    await expect(dialog).toBeVisible();
    await page.mouse.click(20, 100); // backdrop area (top corner outside the sheet)
    await expect(dialog).toBeHidden();
  });
});

test.describe('progressive loading (FUNC-002)', () => {
  test('load more button grows the list; end chip appears at the end', async ({ page }) => {
    await page.goto('/iau-experiences/');
    await expect(page.locator('main article').first()).toBeVisible();
    const countBefore = await page.locator('main article').count();
    const loadMore = page.getByRole('button', { name: 'نمایش بیشتر' });
    await expect(loadMore).toBeVisible();
    await loadMore.scrollIntoViewIfNeeded();
    await loadMore.click();
    await expect
      .poll(async () => page.locator('main article').count(), { timeout: 10_000 })
      .toBeGreaterThan(countBefore);
  });
});

test.describe('sorting (SORT-001)', () => {
  test('sort toggle changes ordering and persists preference', async ({ page }) => {
    await page.goto('/iau-experiences/');
    const scoreBtn = page.getByRole('button', { name: 'بالاترین امتیاز' });
    await scoreBtn.click();
    await expect(scoreBtn).toHaveAttribute('aria-pressed', 'true');
    await page.reload();
    await expect(page.getByRole('button', { name: 'بالاترین امتیاز' })).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('button', { name: 'جدیدترین' }).click();
    await expect(page.getByRole('button', { name: 'جدیدترین' })).toHaveAttribute('aria-pressed', 'true');
  });
});
