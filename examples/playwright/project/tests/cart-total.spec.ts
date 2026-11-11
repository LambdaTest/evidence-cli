import { test, expect, step } from './fixtures';

test('cart shows the subtotal of every line', async ({ page }) => {
  await step(page, 'open the cart', async () => {
    await page.goto('/cart');
  });
  await step(page, 'two lines are listed', async () => {
    await expect(page.getByTestId('line')).toHaveCount(2);
  });
  await step(page, 'total equals the sum of the lines', async () => {
    await expect(page.getByTestId('cart-total')).toHaveText('$49.99');
  });
});
