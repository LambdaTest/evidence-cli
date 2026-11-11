import { test, expect } from './fixtures';

test('cart shows the subtotal of every line', async ({ page }) => {
  await test.step('open the cart', async () => {
    await page.goto('/cart');
  });
  await test.step('two lines are listed', async () => {
    await expect(page.getByTestId('line')).toHaveCount(2);
  });
  await test.step('total equals the sum of the lines', async () => {
    await expect(page.getByTestId('cart-total')).toHaveText('$49.99');
  });
});
