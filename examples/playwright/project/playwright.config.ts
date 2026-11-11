import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: 'tests',
  retries: 0,
  reporter: [['list'], ['json', { outputFile: 'results.json' }]],
  use: {
    ...devices['Desktop Chrome'],
    baseURL: 'https://shop.example.test',
    screenshot: 'on',
    trace: 'off',
  },
  expect: { timeout: 2000 },
});
