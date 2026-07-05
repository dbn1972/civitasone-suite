import { test, expect } from "@playwright/test";
import { injectAuthCookie } from "../helpers/auth";

test.describe("Procurement — Vendors List (Live)", () => {
  test.beforeEach(async ({ page }) => {
    await injectAuthCookie(page);
  });

  test("renders DataTable with live vendor data", async ({ page }) => {
    await page.goto("/procurement/vendors");
    await page.waitForLoadState("networkidle");

    // Assert DataTable is visible
    const table = page.locator("table");
    await expect(table).toBeVisible({ timeout: 30_000 });

    // Assert at least one data row exists
    const rows = table.locator("tbody tr");
    await expect(rows).not.toHaveCount(0);
    const rowCount = await rows.count();
    expect(rowCount).toBeGreaterThan(0);
  });
});
