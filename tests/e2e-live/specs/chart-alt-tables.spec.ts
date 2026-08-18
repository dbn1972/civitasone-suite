import { test, expect } from "@playwright/test";
import { injectAuthCookie } from "../helpers/auth";

/**
 * ARIA-visible data tables alongside charts (Req 3.1): the test-verifiable
 * side of task 18 (feat(web): chart alternative data tables, PR #668). Both
 * pages there added a screen-reader-only <table> alongside a chart, giving
 * the same series in tabular form. This spec asserts, against the live
 * stack, that the accessible table is actually reachable via ARIA role.
 *
 * - /inventory: the "Demand forecast" chart's alt table only renders when
 *   there is a low-stock item to forecast against (see apps/web/src/app/(app)/
 *   inventory/page.tsx — ForecastChart is conditionally rendered). If no
 *   item is currently low-stock on the live stack, the chart/table pair is
 *   legitimately absent — this is treated as a skip, not a failure.
 * - /procurement/vendors/[id]/scorecard: the "Performance radar" alt table
 *   only renders once a vendor has scorecard data (three or more GRN/order
 *   events) — see VendorScorecardPage's `!scorecard` early return. The spec
 *   picks the first vendor from the live list and, if that vendor has no
 *   scorecard yet, treats it as a skip rather than a failure (this is a
 *   verification spec for the accessibility feature's presence when
 *   applicable, not a data-seeding assertion).
 */
test.describe("Charts — ARIA-visible alternative data tables (Live)", () => {
  test.beforeEach(async ({ page }) => {
    await injectAuthCookie(page);
  });

  test("inventory forecast chart has an accessible alt table when a forecast is shown", async ({ page }) => {
    await page.goto("/inventory");
    await page.waitForLoadState("networkidle");

    const forecastHeading = page.getByText("Demand forecast — item nearest reorder");
    const hasForecast = await forecastHeading.isVisible({ timeout: 10_000 }).catch(() => false);
    test.skip(!hasForecast, "No low-stock item on the live stack to forecast against — chart/table pair not rendered.");

    const altTable = page.getByRole("table", { name: /Forecast data table/ });
    await expect(altTable).toBeVisible();
    const rows = altTable.locator("tbody tr");
    const rowCount = await rows.count();
    expect(rowCount).toBeGreaterThan(0);
  });

  test("vendor scorecard performance radar has an accessible alt table when scorecard data exists", async ({ page }) => {
    const vendorsResponse = await page.request.get("/api/proxy/v1/procurement/vendors?limit=10");
    expect(vendorsResponse.ok()).toBeTruthy();
    const vendorsBody = (await vendorsResponse.json()) as { data?: Array<{ id: string }> } | Array<{ id: string }>;
    const vendors = Array.isArray(vendorsBody) ? vendorsBody : (vendorsBody.data ?? []);
    test.skip(vendors.length === 0, "No vendors on the live stack.");

    const vendorId = vendors[0].id;
    await page.goto(`/procurement/vendors/${vendorId}/scorecard`);
    await page.waitForLoadState("networkidle");

    const noScorecard = await page.getByText("No scorecard yet").isVisible({ timeout: 5_000 }).catch(() => false);
    test.skip(noScorecard, "First vendor has no scorecard data yet — chart/table pair not rendered.");

    const altTable = page.getByRole("table", { name: "Performance radar data table" });
    await expect(altTable).toBeVisible({ timeout: 15_000 });
    const rows = altTable.locator("tbody tr");
    const rowCount = await rows.count();
    // Score breakdown always has exactly 3 dimensions (Delivery, Quality, SLA).
    expect(rowCount).toBe(3);
  });
});
