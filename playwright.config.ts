import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './tests',
  testIgnore: [
    'render/production-composition.spec.ts',
    'render/v04-face-zone-regression.spec.ts',
  ],
  use: { baseURL: 'http://127.0.0.1:5173' },
  webServer: {
    command: 'npx vite apps/creator-web --host 127.0.0.1',
    url: 'http://127.0.0.1:5173/render-test.html',
    reuseExistingServer: !process.env.CI,
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'chrome-stable', use: { ...devices['Desktop Chrome'], channel: 'chrome' } },
    { name: 'edge-stable', use: { ...devices['Desktop Chrome'], channel: 'msedge' } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
})
