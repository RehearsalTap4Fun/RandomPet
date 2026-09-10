import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './tests/production-subpath',
  timeout: 180_000,
  use: { baseURL: 'http://127.0.0.1:4174/qmonster/' },
  webServer: {
    command: 'npx vite preview apps/creator-web --host 127.0.0.1 --port 4174 --base /qmonster/ --outDir dist-subpath',
    url: 'http://127.0.0.1:4174/qmonster/',
    reuseExistingServer: false,
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
})
