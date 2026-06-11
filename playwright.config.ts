import { defineConfig, devices } from '@playwright/test'

// E2E runs the built production server against a throwaway, pre-seeded file DB on
// 3001 (see scripts/serve-build.ts). We build + serve rather than `vite dev`
// because the dev server's virtual client entry doesn't hydrate in sandboxed/CI
// environments, so browser tests would never see client-rendered content.
// Deliberately NOT NODE_ENV=test: that forces a per-process :memory: DB, which
// the browser's separate server process wouldn't share. A file DB is seeded by
// global-setup and read by the server.
// Port is overridable (E2E_PORT) so the suite can run on a parallel port without
// colliding with a local `vite dev` on 3001; defaults to 3001 for CI/local.
const PORT = Number(process.env.E2E_PORT) || 3001
const E2E_DB = 'e2e.db'

export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: 'list',
  // These are integration tests against a real SSR + SQLite server. The first
  // requests to a freshly-built, cold server (under parallel workers) can take a
  // few seconds, so give assertions headroom beyond the 5s default.
  expect: { timeout: 12_000 },
  use: {
    baseURL: `http://localhost:${PORT}`,
    actionTimeout: 12_000,
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'bun run e2e:serve',
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: { PORT: String(PORT), DATABASE_URL: E2E_DB },
  },
})
