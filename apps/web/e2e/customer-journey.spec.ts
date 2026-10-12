import { expect, test } from '@playwright/test';
import { expectNoHorizontalScroll, login } from './util';

test.describe('customer journey (mobile)', () => {
  test('discover across segments, buy an in-stock item, pay (test mode) and get a collection code', async ({
    page,
  }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Kaduna');
    await expectNoHorizontalScroll(page);
    await expect(page.getByText('Galaxy Mall').first()).toBeVisible();

    // Search across segments from the hero search.
    await page.getByLabel('What are you looking for?').fill('ankara');
    await page.getByRole('button', { name: 'Search' }).last().click();
    await expect(page).toHaveURL(/\/search\?q=ankara/);
    const cards = page.getByTestId('product-card');
    await expect(cards.first()).toBeVisible();
    await expect(page.getByText('Zainab Fabrics').first()).toBeVisible(); // Galaxy Mall store
    await expect(page.getByText('Kawo Gadgets Hub').first()).toBeVisible(); // independent shop
    await expectNoHorizontalScroll(page);

    // Product page (the click is attributed to search for search-to-product conversion).
    const searchClick = page.waitForRequest(
      (r) =>
        r.url().includes('/api/analytics/events') &&
        (r.postData() ?? '').includes('SEARCH_RESULT_CLICK'),
    );
    await page
      .getByRole('link', { name: /Premium Ankara fabric/ })
      .first()
      .click();
    await searchClick;
    await expect(page.getByRole('heading', { name: /Premium Ankara fabric/ })).toBeVisible();
    await expect(page.getByText('Identity verified by KDCN')).toBeVisible();
    await expect(page.getByText('It does not guarantee product quality')).toBeVisible();

    // Sign in before buying (demo customer).
    await login(page, 'customer@demo.kdcn.ng', 'Password123!', '/p/zainab-fabrics-1');
    await expect(page.getByRole('heading', { name: /Premium Ankara fabric/ })).toBeVisible();
    await page.getByRole('button', { name: 'Add to cart' }).click();
    await page.getByRole('link', { name: 'View cart →' }).click();
    await expect(page.getByRole('heading', { name: 'Your cart' })).toBeVisible();
    await page.getByRole('link', { name: /Checkout with Zainab Fabrics/ }).click();

    // Checkout: collect in store.
    await expect(page.getByRole('heading', { name: /Checkout/ })).toBeVisible();
    await page.getByLabel(/Collect in store/).check();
    await expect(page.getByText('Total', { exact: true })).toBeVisible();
    await page.getByLabel('I accept the refund and cancellation terms').check();
    await page.getByRole('button', { name: /Place order/ }).click();

    // Order page → pay via the test provider page.
    await expect(page.getByRole('heading', { name: /Order KD/ })).toBeVisible();
    await page.getByRole('button', { name: /Pay .* securely/ }).click();
    await expect(page.getByText('TEST MODE')).toBeVisible();
    await page.getByRole('button', { name: 'Simulate successful payment' }).click();

    // Return page verifies server-side.
    await expect(page.getByRole('heading', { name: 'Payment confirmed' })).toBeVisible({
      timeout: 20_000,
    });
    await page.getByRole('link', { name: 'View order' }).click();
    await expect(page.getByText('Paid', { exact: true }).first()).toBeVisible();
    await expect(page.getByLabel('Collection code')).toHaveText(/^\d{6}$/);
    await expect(page.getByText('No real money was charged')).toBeVisible();
  });

  test('declined test payment leaves the order unpaid and retryable', async ({ page }) => {
    await login(page, 'customer@demo.kdcn.ng', 'Password123!', '/p/kawo-gadgets-2');
    await page.getByRole('button', { name: 'Add to cart' }).click();
    await page.getByRole('link', { name: 'View cart →' }).click();
    await page.getByRole('link', { name: /Checkout with Kawo Gadgets Hub/ }).click();
    await page.getByLabel(/Collect in store/).check();
    await page.getByLabel('I accept the refund and cancellation terms').check();
    await page.getByRole('button', { name: /Place order/ }).click();
    await page.getByRole('button', { name: /Pay .* securely/ }).click();
    await page.getByRole('button', { name: 'Simulate declined payment' }).click();
    await expect(page.getByRole('heading', { name: 'Payment not completed' })).toBeVisible({
      timeout: 20_000,
    });
    await page.getByRole('link', { name: 'View order' }).click();
    await expect(page.getByRole('button', { name: /Pay .* securely/ })).toBeVisible();
  });

  test("home vendor storefront never shows the vendor's private address", async ({ page }) => {
    await page.goto('/s/amina-bakes');
    await expect(page.getByRole('heading', { name: 'Amina Bakes' })).toBeVisible();
    await expect(
      page.getByText('This is a home-based business. Its address is private'),
    ).toBeVisible();
    const html = await page.content();
    expect(html).not.toContain('Private Close');
    await expectNoHorizontalScroll(page);
  });

  test('Galaxy Mall landing page with mall-scoped search', async ({ page }) => {
    await page.goto('/markets/galaxy-mall');
    await expect(page.getByRole('heading', { name: 'Galaxy Mall', level: 1 })).toBeVisible();
    await expect(page.getByText('Galaxy Mall Collection Desk')).toBeVisible();
    await page.getByLabel('Search Galaxy Mall').fill('fabric');
    await page.getByRole('button', { name: 'Search' }).last().click();
    await expect(page).toHaveURL(/market=galaxy-mall/);
    await expect(page.getByText('Kawo Gadgets Hub')).toHaveCount(0);
    await expect(page.getByTestId('product-card').first()).toBeVisible();
  });
});
