import { test, expect, step } from './fixtures';

test('SAVE10 takes 10% off the cart total', async ({ page }) => {
  await step(page, 'open the cart', async () => {
    await page.goto('/cart');
  });
  await step(page, 'apply promo code SAVE10', async () => {
    await page.getByLabel('Promo code').fill('SAVE10');
    await page.getByRole('button', { name: 'Apply' }).click();
    await expect(page.getByRole('status')).toHaveText('SAVE10 applied: 10% off');
  });
  await step(page, 'total is 10% off the $49.99 subtotal', async () => {
    await expect(page.getByTestId('cart-total')).toHaveText('$44.99');
  });
});
