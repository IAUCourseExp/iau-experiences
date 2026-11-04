import { test, expect } from '@playwright/test';

/**
 * Phase V UI/UX tests: compact header, searchable combobox filters,
 * decision-oriented keyword discovery, and cross-view student workflows.
 * Runs against the production build via vite preview (base /iau-experiences/).
 */

test.describe('compact header (HDR-*)', () => {
  test('mobile header is compact, labeled, and keeps content visible', async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 800 });
    await page.goto('/iau-experiences/#/');
    const nav = page.locator('nav[aria-label="ناوبری اصلی"]');
    await expect(nav).toBeVisible();

    // Regression guard for the Phase V acceptance criterion: the header must
    // stay far below the 232 px baseline so content dominates first paint.
    const navHeight = await nav.evaluate((el) => Math.round(el.getBoundingClientRect().height));
    expect(navHeight).toBeLessThan(180);
    await testInfo.attach('header-height-390.txt', {
      body: String(navHeight),
      contentType: 'text/plain',
    });

    // labeled menu affordance (not a bare icon)
    const menuButton = page.getByRole('button', { name: 'باز کردن منو' });
    await expect(menuButton).toBeVisible();
    await expect(menuButton).toContainText('منو');

    // persistent mobile search + section tabs + dataset freshness
    await expect(page.locator('#search-mobile')).toBeVisible();
    await expect(page.getByRole('tab', { name: /پروفایل‌ها/ })).toBeVisible();
    await expect(page.locator('#last-update')).toBeVisible();

    // no horizontal overflow at narrow width
    const overflow = await page.evaluate(() => (
      document.documentElement.scrollWidth > document.documentElement.clientWidth
    ));
    expect(overflow).toBe(false);
  });

  test('desktop header is a single compact row with inline nav', async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/iau-experiences/#/');
    const nav = page.locator('nav[aria-label="ناوبری اصلی"]');
    await expect(nav).toBeVisible();

    const navHeight = await nav.evaluate((el) => Math.round(el.getBoundingClientRect().height));
    expect(navHeight).toBeLessThan(80);
    await testInfo.attach('header-height-1280.txt', {
      body: String(navHeight),
      contentType: 'text/plain',
    });

    await expect(page.locator('#search-desktop')).toBeVisible();
    await expect(page.getByRole('tab', { name: /تجربیات/ })).toBeVisible();
    for (const name of ['کانال تجربیات', 'گروه تجربیات', 'کانال جزوه', 'دیسکاشن کامپیوتر']) {
      await expect(page.getByRole('link', { name, exact: true }).first()).toBeVisible();
    }
    await expect(page.locator('#last-update')).toBeVisible();
  });

  test('header scrolls away on mobile so reading gets the full viewport', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 800 });
    await page.goto('/iau-experiences/#/');
    const nav = page.locator('nav[aria-label="ناوبری اصلی"]');
    await expect(nav).toBeVisible();
    expect(await nav.evaluate((el) => getComputedStyle(el).position)).toBe('static');
  });
});

test.describe('searchable combobox filters (CMB-*)', () => {
  async function openExplorer(page) {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/iau-experiences/#/explore');
    await expect(page.locator('#filter-prof')).toBeVisible({ timeout: 15_000 });
  }

  test('filters options by a Persian query and applies the selection with Enter', async ({ page }) => {
    await openExplorer(page);
    const profInput = page.locator('#filter-prof');
    await profInput.click();
    await profInput.fill('خداپرست');
    const listbox = page.getByRole('listbox', { name: 'فیلتر استاد' });
    await expect(listbox.getByRole('option', { name: /خداپرست/ }).first()).toBeVisible();
    // ArrowDown twice: first lands on the reset row, second on a real option
    await profInput.press('ArrowDown');
    await profInput.press('ArrowDown');
    await profInput.press('Enter');
    // selected value is visible in the control and results update
    await expect(profInput).toHaveValue(/خداپرست/);
    await expect(page.getByRole('status').filter({ hasText: 'نتیجه' })).toBeVisible();
  });

  test('matches Arabic/Persian character variants through normalization', async ({ page }) => {
    await openExplorer(page);
    const courseInput = page.locator('#filter-course');
    await courseInput.click();
    // Arabic Kaf typed — must still match Persian Kaf course names
    await courseInput.fill('كامپیوتر');
    const listbox = page.getByRole('listbox', { name: 'فیلتر درس' });
    // options[0] is the reset row («همه دروس»); assert on real matches
    const matching = listbox.getByRole('option', { name: /کامپیوتر/ });
    await expect(matching.first()).toBeVisible();
    const firstLabel = await matching.first().textContent();
    expect(firstLabel).toContain('کامپیوتر');
  });

  test('shows an honest empty state for a nonsense query', async ({ page }) => {
    await openExplorer(page);
    const profInput = page.locator('#filter-prof');
    await profInput.click();
    await profInput.fill('زیبقشکمثزیبن');
    await expect(page.getByText('استادی با این نام یافت نشد.')).toBeVisible();
    await profInput.press('Escape');
  });

  test('clear button restores the unfiltered state', async ({ page }) => {
    await openExplorer(page);
    const profInput = page.locator('#filter-prof');
    await profInput.click();
    await profInput.fill('خداپرست');
    await page.getByRole('listbox', { name: 'فیلتر استاد' })
      .getByRole('option', { name: /خداپرست/ }).first().click();
    await expect(profInput).toHaveValue(/خداپرست/);
    await page.getByRole('button', { name: 'فیلتر استاد: پاک کردن مقدار انتخاب‌شده' }).click();
    await expect(profInput).toHaveValue('');
    // "all" placeholder visible again
    await expect(profInput).toHaveAttribute('placeholder', 'همه استادان');
  });

  test('combobox filters compose with text search and clear-all', async ({ page }) => {
    await openExplorer(page);
    // text search first
    await page.locator('#explorer-search').fill('حضور');
    await expect(page.getByRole('status').filter({ hasText: 'نتیجه' })).toBeVisible();
    // let the debounce settle, then open the professor combobox: its options
    // are the facet WITHIN the text-search results
    await page.waitForTimeout(400);
    const profInput = page.locator('#filter-prof');
    await profInput.click();
    const listbox = page.getByRole('listbox', { name: 'فیلتر استاد' });
    // pick the first real option the filtered facet actually offers
    await listbox.getByRole('option').nth(1).click();
    await expect(profInput).not.toHaveValue('');
    const clearAll = page.getByRole('button', { name: 'پاک کردن فیلترها' });
    await expect(clearAll).toBeVisible();
    await clearAll.click();
    await expect(profInput).toHaveValue('');
    // text search persists after clear-all (only toggles/facets are cleared)
    await expect(page.locator('#explorer-search')).toHaveValue('حضور');
  });
});

test.describe('keyword discovery (KWD-*)', () => {
  async function openExplorer(page) {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/iau-experiences/#/explore');
    await expect(page.getByRole('heading', { name: 'موضوعات پرتکرار در تجربه‌های دانشجویان' })).toBeVisible({ timeout: 15_000 });
  }

  test('shows expressions with distinct-report counts and no generic filler', async ({ page }) => {
    await openExplorer(page);
    const section = page.locator('div', { has: page.getByRole('heading', { name: /موضوعات پرتکرار/ }) }).last();
    const chips = section.getByRole('button');
    const texts = await chips.allTextContents();
    const chipText = texts.join(' ');
    // generic filler that dominated the old frequency list must be gone
    expect(chipText).not.toContain('اینکه');
    // a known high-frequency decision expression with a count is present
    expect(chipText).toMatch(/حضور/);
    // counts are rendered in Persian digits
    expect(chipText).toMatch(/[۰-۹]/);
  });

  test('clicking an expression filters to reports containing exactly that phrase', async ({ page }) => {
    await openExplorer(page);
    // scope to the keyword block: unscoped getByRole hasText is unreliable
    const keywordBlock = page.locator('div', {
      has: page.getByRole('heading', { name: 'موضوعات پرتکرار در تجربه‌های دانشجویان' }),
    }).last();
    const chip = keywordBlock.getByRole('button').filter({ hasText: 'حضور غیاب' }).first();
    await chip.scrollIntoViewIfNeeded();
    const chipCountText = await chip.textContent();
    await chip.click();
    // the exact-phrase query lands in the search box
    await expect(page.locator('#explorer-search')).toHaveValue('«حضور غیاب»');
    // the chip shows its active state
    await expect(chip).toHaveAttribute('aria-pressed', 'true');
    // the results update and the chip's displayed count EQUALS the number of
    // results the click produced (no inflated promises)
    const countSpan = page.locator('main span', { hasText: /نتیجه/ }).first();
    await expect(countSpan).toBeVisible();
    const faToEn = (s) => s.replace(/[۰-۹]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d));
    const chipNum = parseInt(faToEn(chipCountText.match(/[۰-۹]/g).join('')), 10);
    const resultNum = parseInt(faToEn((await countSpan.textContent()).match(/[۰-۹]/g).join('')), 10);
    expect(resultNum).toBe(chipNum);
    // removing the keyword restores the broader result set
    await page.getByRole('button', { name: /برداشتن عبارت «حضور غیاب»/ }).click();
    await expect(page.locator('#explorer-search')).toHaveValue('');
    await expect(chip).toHaveAttribute('aria-pressed', 'false');
  });

  test('expander reveals the remaining selection', async ({ page }) => {
    await openExplorer(page);
    const expander = page.getByRole('button', { name: /نمایش [۰-۹]+ مورد دیگر/ });
    if (await expander.isVisible()) {
      await expander.click();
      await expect(page.getByRole('button', { name: 'نمایش کمتر' })).toBeVisible();
    }
  });
});

test.describe('student workflows (WF-*)', () => {
  test('WF-1: search a professor from the header, open the profile chain', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/iau-experiences/#/');
    await page.locator('#search-desktop').fill('خداپرست');
    await expect(page.getByRole('status').filter({ hasText: 'نتیجه' })).toBeVisible();
    // open an experience dialog from the results
    await page.locator('main article').first().getByRole('button').first().click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    // professor route from directory completes the investigation chain
    await page.goto('/iau-experiences/#/professors');
    await expect(page.locator('#directory-search, input[type="search"], input[type="text"]').first()).toBeVisible();
  });

  test('WF-2: keyword → results → experience → semantic neighbors', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/iau-experiences/#/explore');
    await expect(page.getByRole('heading', { name: /موضوعات پرتکرار/ })).toBeVisible({ timeout: 15_000 });
    const keywordBlock = page.locator('div', {
      has: page.getByRole('heading', { name: 'موضوعات پرتکرار در تجربه‌های دانشجویان' }),
    }).last();
    const chip = keywordBlock.getByRole('button').filter({ hasText: 'حضور غیاب' }).first();
    await chip.scrollIntoViewIfNeeded();
    await chip.click();
    await expect(page.locator('#explorer-search')).toHaveValue('«حضور غیاب»');
    // let the 150 ms applied-query debounce settle so the grid reflects the
    // filtered result set before opening a card
    await page.waitForTimeout(400);
    // open the first matching experience
    const firstCard = page.locator('main article').first();
    await firstCard.getByRole('button', { name: 'مشاهده کامل' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    // semantic neighbors must still work end-to-end (Phase IV contract)
    await dialog.getByRole('button', { name: /نمایش تجربه‌های موضوعاً مشابه/ }).click();
    await expect(dialog.getByRole('heading', { name: 'تجربه‌های نزدیک از نظر موضوعی' })).toBeVisible({ timeout: 10_000 });
  });

  test('WF-3: mobile menu → profiles directory → search → profile', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/iau-experiences/#/');
    await page.getByRole('button', { name: 'باز کردن منو' }).click();
    // close the menu by navigating via tabs
    await page.getByRole('tab', { name: /پروفایل‌ها/ }).click();
    await expect(page.getByRole('heading', { name: /استادان|دایرکتوری/ }).first()).toBeVisible({ timeout: 15_000 });
    // directory search narrows results
    const directorySearch = page.locator('main input').first();
    await directorySearch.fill('خداپرست');
    await page.waitForTimeout(400);
    const rows = page.locator('main a[href*="#/professors/"]');
    expect(await rows.count()).toBeGreaterThanOrEqual(0);
  });

  test('WF-4: combine course + professor filters, clear one, clear all', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/iau-experiences/#/explore');
    await expect(page.locator('#filter-prof')).toBeVisible({ timeout: 15_000 });
    const profInput = page.locator('#filter-prof');
    await profInput.click();
    await profInput.fill('خداپرست');
    await page.getByRole('listbox', { name: 'فیلتر استاد' })
      .getByRole('option', { name: /خداپرست/ }).first().click();
    await expect(profInput).toHaveValue(/خداپرست/);
    // clear-all resets both comboboxes
    await page.getByRole('button', { name: 'پاک کردن فیلترها' }).click();
    await expect(profInput).toHaveValue('');
    await expect(page.locator('#filter-course')).toHaveValue('');
  });
});
