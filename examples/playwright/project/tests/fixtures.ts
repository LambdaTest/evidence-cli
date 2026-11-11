import { test as base } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Serve the demo shop from disk so the example needs no network.
const html = readFileSync(fileURLToPath(new URL('../app/index.html', import.meta.url)), 'utf8');

export const test = base.extend({
  page: async ({ page }, use) => {
    await page.route('https://shop.example.test/**', (route) =>
      route.fulfill({ status: 200, contentType: 'text/html', body: html }),
    );
    await use(page);
  },
});
export { expect } from '@playwright/test';
