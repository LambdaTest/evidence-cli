# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: promo-code.spec.ts >> SAVE10 takes 10% off the cart total
- Location: tests/promo-code.spec.ts:3:1

# Error details

```
Error: expect(locator).toHaveText(expected) failed

Locator:  getByTestId('cart-total')
Expected: "$44.99"
Received: "$47.49"
Timeout:  2000ms

Call log:
  - Expect "toHaveText" getByTestId('cart-total') with timeout 2000ms
  - waiting for getByTestId('cart-total')
    21 × locator resolved to <span id="total" data-testid="cart-total">$47.49</span>
       - unexpected value "$47.49"

```

```yaml
- text: $47.49
```

# Test source

```ts
  1  | import { test, expect, step } from './fixtures';
  2  | 
  3  | test('SAVE10 takes 10% off the cart total', async ({ page }) => {
  4  |   await step(page, 'open the cart', async () => {
  5  |     await page.goto('/cart');
  6  |   });
  7  |   await step(page, 'apply promo code SAVE10', async () => {
  8  |     await page.getByLabel('Promo code').fill('SAVE10');
  9  |     await page.getByRole('button', { name: 'Apply' }).click();
  10 |     await expect(page.getByRole('status')).toHaveText('SAVE10 applied: 10% off');
  11 |   });
  12 |   await step(page, 'total is 10% off the $49.99 subtotal', async () => {
> 13 |     await expect(page.getByTestId('cart-total')).toHaveText('$44.99');
     |                                                  ^ Error: expect(locator).toHaveText(expected) failed
  14 |   });
  15 | });
  16 | 
```