import { defineConfig, devices } from '@playwright/test'

// E2E runs the real dev server against a throwaway, pre-seeded file DB on 3001.
// Deliberately NOT NODE_ENV=test: that forces a per-process :memory: DB, which
// the browser's separate server process wouldn't share. A file DB is seeded by
// global-setup and read by the server.
const PORT = 3001
const E2E_DB = 'e2e.db'

export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'vite dev',
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: { PORT: String(PORT), DATABASE_URL: E2E_DB },
  },
})
