import { expect, test } from '@playwright/test';
import { login, totp } from './util';

test.describe.serial('merchant and admin dashboards', () => {
  test('merchant confirms, prepares and completes a collection order', async ({
    page,
    browser,
  }) => {
    // A customer orders a CONFIRM_ON_ORDER item (lace) for collection.
    const customer = await browser.newPage();
    await login(customer, 'customer@demo.kdcn.ng', 'Password123!', '/p/zainab-fabrics-2');
    await customer.getByRole('button', { name: 'Add to cart' }).click();
    await customer.getByRole('link', { name: 'View cart →' }).click();
    await customer.getByRole('link', { name: /Checkout with Zainab Fabrics/ }).click();
    await customer.getByLabel(/Collect in store/).check();
    await customer.getByLabel('I accept the refund and cancellation terms').check();
    await customer.getByRole('button', { name: /pay after confirmation/ }).click();
    await expect(customer.getByText('Waiting for the seller')).toBeVisible();
    const orderUrl = customer.url();

    // Merchant confirms availability.
    await login(page, 'galaxy.merchant@demo.kdcn.ng', 'Password123!', '/merchant');
    await expect(page.getByRole('heading', { name: 'Zainab Fabrics' })).toBeVisible();
    await page
      .getByRole('navigation', { name: 'Store management' })
      .getByRole('link', { name: 'Orders' })
      .click();
    await page.locator('a', { hasText: 'Swiss voile lace' }).first().click();
    await page.getByRole('button', { name: 'Confirm availability' }).click();
    await expect(page.getByText('Confirmed — customer asked to pay')).toBeVisible();

    // Customer pays.
    await customer.goto(orderUrl);
    await customer.getByRole('button', { name: /Pay .* securely/ }).click();
    await customer.getByRole('button', { name: 'Simulate successful payment' }).click();
    await expect(customer.getByRole('heading', { name: 'Payment confirmed' })).toBeVisible({
      timeout: 20_000,
    });
    await customer.goto(orderUrl);
    const code = (await customer.getByLabel('Collection code').textContent())!.trim();

    // Merchant fulfils and verifies the collection code.
    await page.reload();
    await page.getByRole('button', { name: 'Accept paid order' }).click();
    await page.getByRole('button', { name: 'Start preparing' }).click();
    await page.getByRole('button', { name: 'Ready for collection' }).click();
    await page.getByLabel("Customer's 6-digit collection code").fill(code);
    await page.getByRole('button', { name: 'Confirm handover' }).click();
    await expect(page.getByText('Collection confirmed')).toBeVisible();
    await expect(page.getByText('You receive')).toBeVisible();
    await customer.close();
  });

  test('admin signs in with MFA and sees segment reporting', async ({ page }) => {
    await login(page, 'admin@demo.kdcn.ng', 'AdminPassword123!', '/admin');
    await expect(page.getByRole('heading', { name: 'Two-step verification' })).toBeVisible();
    await page.getByLabel('6-digit code').fill(totp());
    await page.getByRole('button', { name: 'Verify' }).click();
    await expect(page.getByRole('heading', { name: 'KDCN Admin' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Performance by segment' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Galaxy Mall' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Home vendors' })).toBeVisible();
    await expect(page.getByRole('cell', { name: 'GMV (goods, before refunds)' })).toBeVisible();
    // Audit log shows the payments and merchant actions from the previous test.
    await page
      .getByRole('navigation', { name: 'Admin' })
      .getByRole('link', { name: 'Platform' })
      .click();
    await expect(page.getByRole('cell', { name: 'payment.succeeded' }).first()).toBeVisible();
  });

  test('a customer cannot open the admin portal', async ({ page }) => {
    await login(page, 'customer@demo.kdcn.ng');
    await page.goto('/admin');
    await expect(page.getByText('KDCN staff only')).toBeVisible();
  });
});
