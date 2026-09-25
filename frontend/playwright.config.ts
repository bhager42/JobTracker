/**
 * End-to-end tests against the real app. By default this starts the backend on a fresh,
 * throwaway data dir, serving the production build in dist/ (run `pnpm e2e`, which builds
 * first). Set E2E_BASE_URL to test a running instance instead, e.g. `docker compose up` in CI.
 */
import path from 'node:path'

import { defineConfig, devices } from '@playwright/test'

const external = process.env.E2E_BASE_URL
const port = 8766
const dataDir = path.resolve(import.meta.dirname, '.e2e-data')

export default defineConfig({
  testDir: 'tests/e2e',
  // One shared server and database: run tests in order.
  workers: 1,
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: external ?? `http://127.0.0.1:${port}`,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: external
    ? undefined
    : {
        // Start from an empty data dir. (Not done at config load: workers load it again.)
        command: `rm -rf '${dataDir}' && uv --directory ../backend run uvicorn app.main:app --port ${port}`,
        url: `http://127.0.0.1:${port}/api/health`,
        reuseExistingServer: false,
        timeout: 60_000,
        env: {
          DATA_DIR: dataDir,
          STATIC_DIR: path.resolve(import.meta.dirname, 'dist'),
          TZ: 'America/Chicago',
          PATH: `${process.env.HOME}/.local/bin:${process.env.PATH}`,
        },
      },
})
