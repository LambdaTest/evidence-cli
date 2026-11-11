import { test as base, type Page } from '@playwright/test';
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

// A `test.step` that also records where the page was and what it looked like
// when the step ended, passed or failed. to-evidence.mjs turns these two
// attachments into the step's step.json (url) and screenshot.png.
export function step(page: Page, title: string, body: () => Promise<void>) {
  return test.step(title, async () => {
    try {
      await body();
    } finally {
      const info = test.info();
      await info.attach(`step-url:${title}`, { body: page.url(), contentType: 'text/plain' });
      const shot = await page.screenshot().catch(() => null);
      if (shot) await info.attach(`step-screenshot:${title}`, { body: shot, contentType: 'image/png' });
    }
  });
}
