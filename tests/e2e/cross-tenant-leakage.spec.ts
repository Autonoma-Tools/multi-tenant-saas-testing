import { expect, test } from "@playwright/test";
import { BASE_URL, readSeedState, type SeedState } from "../../fixtures/shared";

/**
 * UI cross-tenant leakage.
 *
 * Log in through the UI as Tenant A, then navigate directly to Tenant B's
 * invoice URL. The app must render a not-found / access-denied state instead of
 * Tenant B's invoice data. This catches leaks that only appear in the rendered
 * page (e.g. a client-side route that fetches by ID without a tenant guard).
 *
 * Requires a running app at BASE_URL and a prior `npm run seed`.
 */

let state: SeedState;

test.beforeAll(() => {
  state = readSeedState();
});

test.beforeEach(async ({ page }) => {
  // Authenticate as Tenant A's user.
  await page.goto(`${BASE_URL}/login`);
  await page.locator('input[name="email"]').fill(state.tenants.acme.user.email);
  await page.locator('input[name="password"]').fill(state.tenants.acme.user.password);
  await page.locator('button[type="submit"]').click();
  await page.waitForLoadState("networkidle");
});

test.describe("UI cross-tenant isolation", () => {
  test("Tenant A cannot open Tenant B's invoice by direct URL", async ({ page }) => {
    const globexInvoice = state.tenants.globex.invoice;

    const response = await page.goto(`${BASE_URL}/invoices/${globexInvoice.id}`);
    await page.waitForLoadState("networkidle");

    // Tenant B's invoice number must never render on Tenant A's screen.
    await expect(page.getByText(globexInvoice.number)).toHaveCount(0);

    // The page must present an explicit denial. Accept either a non-2xx
    // server response OR a client-rendered access-denied / not-found state.
    const statusDenied = response !== null && response.status() >= 400;
    const deniedText = page.getByText(/not found|access denied|forbidden|no access|not authorized/i);
    const textDenied = await deniedText
      .first()
      .isVisible()
      .catch(() => false);

    expect(statusDenied || textDenied).toBeTruthy();
  });

  test("Tenant A CAN open its own invoice (control)", async ({ page }) => {
    const acmeInvoice = state.tenants.acme.invoice;

    await page.goto(`${BASE_URL}/invoices/${acmeInvoice.id}`);
    await page.waitForLoadState("networkidle");

    await expect(page.getByText(acmeInvoice.number).first()).toBeVisible();
  });
});
