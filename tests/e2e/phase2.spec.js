import { test, expect } from '@playwright/test';

/**
 * Phase II journeys: IA tabs, profiles, comparison, explorer, deep links,
 * recently-viewed, random discovery. Runs against the production build.
 */

test.describe('IA navigation', () => {
  test('tabs switch sections and preserve browse state', async ({ page }, testInfo) => {
    await page.goto('/iau-experiences/');
    await expect(page.getByRole('heading', { name: 'آخرین تجارب' })).toBeVisible();
    // set a search state before leaving (visible input differs per breakpoint)
    await page.locator('input[type="search"]:visible').fill('خداپرست');
    await expect(page.getByRole('status')).toContainText('نتیجه');
    // leave to profiles
    await page.getByRole('tab', { name: 'پروفایل‌ها' }).click();
    await expect(page.getByRole('heading', { name: 'دایرکتوری استادان' })).toBeVisible();
    // come back — state preserved
    await page.getByRole('tab', { name: 'تجربیات' }).click();
    await expect(page.locator('input[type="search"]:visible')).toHaveValue('خداپرست');
    await page.screenshot({ path: `audit-artifacts/phase-2/after/${testInfo.project.name}-browse-state-kept.png` });
  });

  test('tab active states are correct per section', async ({ page }) => {
    await page.goto('/iau-experiences/#/explore');
    await expect(page.getByRole('tab', { name: 'موضوعات' })).toHaveAttribute('aria-selected', 'true');
    await page.goto('/iau-experiences/#/professors');
    await expect(page.getByRole('tab', { name: 'پروفایل‌ها' })).toHaveAttribute('aria-selected', 'true');
  });
});

test.describe('Feature 1 — profiles', () => {
  test('professor directory lists profiles with counts and score samples', async ({ page }, testInfo) => {
    await page.goto('/iau-experiences/#/professors');
    await expect(page.getByRole('heading', { name: 'دایرکتوری استادان' })).toBeVisible();
    await expect(page.getByText('استاد', { exact: true })).toBeHidden();
    const rows = page.locator('main a[href^="#/professor/"]');
    expect(await rows.count()).toBeGreaterThan(50);
    await page.screenshot({ path: `audit-artifacts/phase-2/after/${testInfo.project.name}-professor-directory.png` });
    // directory search
    await page.locator('#directory-search').fill('خداپرست');
    // matches every professor whose name contains the family name
    const rowsAfterSearch = page.locator('main a[href^="#/professor/"]');
    expect(await rowsAfterSearch.count()).toBeGreaterThanOrEqual(1);
    await expect(rowsAfterSearch.first()).toContainText('خداپرست');
  });

  test('professor profile shows stats, distribution, courses, experiences', async ({ page }, testInfo) => {
    await page.goto('/iau-experiences/#/professor/%D8%AD%D8%A7%D9%85%D8%AF%20%D8%AE%D8%AF%D8%A7%D9%BE%D8%B1%D8%B3%D8%AA');
    await expect(page.getByRole('heading', { name: 'حامد خداپرست', exact: true })).toBeVisible();
    await expect(page.getByText('میانگین امتیاز استاد')).toBeVisible();
    await expect(page.getByText('توزیع امتیاز استاد (۰ تا ۲۰)')).toBeVisible();
    await expect(page.getByText(/امتیاز معتبر/)).toBeVisible();
    // experiences list present and openable
    const cardBtn = page.getByRole('button', { name: /مشاهده جزئیات تجربه/ }).first();
    await cardBtn.click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toBeHidden();
    await page.screenshot({ path: `audit-artifacts/phase-2/after/${testInfo.project.name}-professor-profile.png` });
  });

  test('course profile: comparison of two professors with sample-size caveat', async ({ page }, testInfo) => {
    await page.goto('/iau-experiences/#/course/%D9%87%D9%88%D8%B4%20%D9%85%D8%B5%D9%86%D9%88%D8%B9%DB%8C');
    await expect(page.getByRole('heading', { name: 'هوش مصنوعی', exact: true })).toBeVisible();
    // select two professors for comparison (chips show Persian-digit counts)
    const chips = page.locator('main button[aria-pressed]').filter({ hasText: /[(][\u06F0-\u06F9]+[)]$/ });
    await chips.nth(0).click();
    await chips.nth(1).click();
    await expect(page.getByText('مقایسه بر اساس تجربه‌های دانشجوها')).toBeVisible();
    await expect(page.getByText(/نمونه‌های کوچک/)).toBeVisible();
    await page.screenshot({ path: `audit-artifacts/phase-2/after/${testInfo.project.name}-comparison.png` });
  });

  test('course profile links to CoursesList search (verified contract)', async ({ page }) => {
    await page.goto('/iau-experiences/#/course/%D9%87%D9%88%D8%B4%20%D9%85%D8%B5%D9%86%D9%88%D8%B9%DB%8C');
    const link = page.getByRole('link', { name: /لیست دروس/ });
    await expect(link).toHaveAttribute('href', /iaucourseexp\.github\.io\/CoursesList\/\?q=/);
    await expect(link).toHaveAttribute('target', '_blank');
    await expect(link).toHaveAttribute('rel', /noopener/);
  });

  test('unknown profile key shows honest not-found state', async ({ page }) => {
    await page.goto('/iau-experiences/#/professor/%D9%86%D8%A7%D9%85%20%D9%86%D8%A7%D9%85%D8%B9%D8%AA%D8%A8%D8%B1');
    await expect(page.getByText('این پروفایل یافت نشد')).toBeVisible();
  });
});

test.describe('Feature 2 — explorer', () => {
  test('full-text search with highlights and match reasons', async ({ page }, testInfo) => {
    await page.goto('/iau-experiences/#/explore');
    await page.locator('#explorer-search').fill('کوییز');
    await expect(page.getByRole('status')).toContainText('نتیجه');
    await expect(page.locator('main mark').first()).toBeVisible();
    await expect(page.getByText('در متن تجربه').first()).toBeVisible();
    await page.screenshot({ path: `audit-artifacts/phase-2/after/${testInfo.project.name}-explorer-results.png` });
    // normalization: Arabic Kaf query finds Persian Kaf texts too
    await page.locator('#explorer-search').fill('كوییز'); // Arabic Kaf
    await expect(page.getByRole('status')).toContainText('نتیجه');
  });

  test('quoted phrase search works', async ({ page }) => {
    await page.goto('/iau-experiences/#/explore');
    await page.locator('#explorer-search').fill('"خوش اخلاق"');
    // wait past the 150 ms debounce for the filtered count
    await expect
      .poll(async () => page.getByRole('status').textContent(), { timeout: 5_000 })
      .not.toContain('۲٬۳۳۰');
    await expect(page.locator('main mark').first()).toBeVisible();
  });

  // PHASE III CHANGE REASON: the Phase II manually curated topic chips were
  // replaced by the corpus-derived Semantic Atlas (tools/nlp_pipeline.py).
  // The journey now exercises the Atlas: expand a topic card, verify its
  // evidence disclosure, and open the topic's member experiences.
  test('Atlas handles semantic topics and honest fallback', async ({ page }) => {
    await page.goto('/iau-experiences/#/explore');

    const atlas = page.locator(
        'main section[aria-label="اطلس موضوعی معنایی"]'
    );

    await expect(atlas).toBeVisible();

    const topicToggle = atlas.locator('button[aria-expanded]').first();

    const fallbackNotice = page.getByText(
        /در آخرین تولید، خوشه‌بندی معنایی به آستانه‌های کیفیت نرسید/
    );

    // Wait until the Atlas has resolved into one of its two valid modes.
    await expect.poll(async () => {
        if (await topicToggle.count()) return 'semantic';

        if (await fallbackNotice.isVisible().catch(() => false)) {
        return 'fallback';
        }

        return 'loading';
    }, { timeout: 15000 }).not.toBe('loading');

    if (await topicToggle.count()) {
        // Semantic mode: verify topic evidence and member navigation.
        await expect(topicToggle).toBeVisible();
        await topicToggle.click();

        await expect(
        page.getByText(/برچسب آن توسط الگوریتم تولید شده و بازبینی انسانی نشده/)
        ).toBeVisible();

        await page.getByRole('button', {
        name: /نمایش .* تجربه‌ی این موضوع/
        }).click();

        await expect(
        page.getByRole('heading', { name: /^موضوع: / })
        ).toBeVisible();

        await expect(
        page.locator('main article').first()
        ).toBeVisible();
    } else {
        // Fallback mode: verify honest abstention and continued lexical search.
        await expect(fallbackNotice).toBeVisible();

        const search = page.locator('#explorer-search');

        await expect(search).toBeVisible();
        await search.fill('جزوه');
        await expect(search).toHaveValue('جزوه');
    }
    });

  test('keyword chips fill the search', async ({ page }) => {
    await page.goto('/iau-experiences/#/explore');
    const chip = page.locator('main button', { hasText: /جزوه/ }).last();
    await chip.scrollIntoViewIfNeeded();
    await chip.click();
    await expect(page.locator('#explorer-search')).toHaveValue(/جزوه/);
  });
});

test.describe('deep links & subtle features', () => {
  test('experience deep link opens dialog; invalid id shows not-found', async ({ page }) => {
    await page.goto('/iau-experiences/#/experience/746');
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByRole('dialog').getByRole('heading', { name: /پرنیان زارع/ })).toBeVisible();
    // back button closes the dialog
    await page.goBack();
    await expect(page.getByRole('dialog')).toBeHidden();
    // invalid id
    await page.goto('/iau-experiences/#/experience/99999');
    await expect(page.getByText('این تجربه یافت نشد')).toBeVisible();
  });

  test('random discovery opens a valid experience', async ({ page }) => {
    await page.goto('/iau-experiences/');
    await page.getByRole('button', { name: 'یه تجربه شانسی' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(page.url()).toMatch(/#\/experience\/\d+/);
  });

  test('dialog shows related experiences and reading sizes', async ({ page }) => {
    await page.goto('/iau-experiences/#/experience/2');
    // id 2 is هوش مصنوعی by حامد خداپرست (multiple records exist for both)
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText('تجربه‌های مرتبط')).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'کوچک' })).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'بزرگ' })).toBeVisible();
    // reading size toggle persists
    await dialog.getByRole('button', { name: 'بزرگ' }).click();
    await expect(dialog.getByRole('button', { name: 'بزرگ' })).toHaveAttribute('aria-pressed', 'true');
  });

  test('recently viewed appears after opening experiences and can be cleared', async ({ page }) => {
    await page.goto('/iau-experiences/#/experience/746');
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await page.goto('/iau-experiences/');
    await expect(page.getByText('بازدیدهای اخیر')).toBeVisible();
    await page.getByRole('button', { name: 'پاک کردن تاریخچه' }).click();
    await expect(page.getByText('بازدیدهای اخیر')).toBeHidden();
  });
});
