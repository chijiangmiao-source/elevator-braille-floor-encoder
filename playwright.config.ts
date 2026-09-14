import { defineConfig, devices } from '@playwright/test'

// 本地运行时自动拉起 Vite；Docker Compose 的 verify 服务通过该变量指向静态 Web 容器。
const baseURL = process.env.PLAYWRIGHT_BASE_URL

// verify 容器经 http://web 访问（非 localhost），需显式声明为可信源，
// 否则 Chromium 在非安全上下文禁用 navigator.clipboard。
const launchOptions = baseURL
  ? { args: [`--unsafely-treat-insecure-origin-as-secure=${baseURL}`] }
  : {}

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  expect: { timeout: 7_000 },
  retries: 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: baseURL ?? 'http://localhost:4173',
    permissions: ['clipboard-read', 'clipboard-write'],
    trace: 'retain-on-failure',
    launchOptions,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: baseURL
    ? undefined
    : {
        command: 'npm run dev -- --port 4173 --strictPort',
        url: 'http://localhost:4173',
        reuseExistingServer: !process.env.CI,
        timeout: 60_000,
      },
})
