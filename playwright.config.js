import { defineConfig, devices } from '@playwright/test';

// E2E journeys run against the production build served by `vite preview`
// (same architecture as GitHub Pages: sub-path /iau-experiences/).
// Uses the system-installed Chrome via `channel: 'chrome'` — no browser
// download required in this environment.
export default defineConfig({
  testDir: './tests/e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [['list'], ['html', { outputFolder: 'audit-artifacts/playwright-report', open: 'never' }]],
  use: {
    baseURL: 'http://localhost:4173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'npx vite preview --port 4173 --strictPort',
    port: 4173,
    reuseExistingServer: true,
    timeout: 60_000,
  },
  projects: [
    { name: 'chrome-desktop', use: { ...devices['Desktop Chrome'], channel: 'chrome', viewport: { width: 1280, height: 800 } } },
    { name: 'chrome-mobile', use: { ...devices['Pixel 5'], channel: 'chrome' } },
    {
      name: 'chrome-tablet-gap',
      use: {
        ...devices['Desktop Chrome'],
        channel: 'chrome',
        viewport: { width: 900, height: 800 }, // the baseline 768–1023 dead zone
      },
    },
  ],
});
