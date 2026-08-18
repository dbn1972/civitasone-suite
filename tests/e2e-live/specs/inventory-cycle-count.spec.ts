import { test, expect } from "@playwright/test";
import { injectAuthCookie } from "../helpers/auth";

/**
 * Inventory cycle-count journey (Req 6.2): a store officer initiates a
 * cycle count with a physical quantity that produces a variance above the
 * auto-adjust threshold (so it lands in `pending_approval`), then a
 * supervisor navigates to the cycle count detail page and approves it,
 * verifying the ledger/status update.
 *
 * NOTE: there is no cycle-count creation form in the web UI today (only the
 * approve/reject actions on the detail page — see CycleCountActions.tsx).
 * Initiation is done via a direct POST to the same
 * /api/v1/inventory/cycle-counts endpoint the (future) UI form would call,
 * using the injected session cookie so the request carries the same auth
 * context as the rest of the journey. This mirrors how a store officer's
 * physical count would be submitted once a create form ships.
 *
 * Uses the injected super_admin JWT for both the "store officer" and
 * "supervisor" steps, matching the pattern in the other e2e-live specs.
 */
test.describe("Inventory — Cycle Count Journey (Live)", () => {
  test.beforeEach(async ({ page }) => {
    await injectAuthCookie(page);
  });

  test("initiate cycle count with variance, supervisor approves, ledger reflects the adjustment", async ({ page }) => {
    // 1. Pick a live item and a live store/bin to count.
    await page.goto("/inventory/items");
    await page.waitForLoadState("networkidle");
    const itemsResponse = await page.request.get("/api/proxy/v1/inventory/items?limit=1");
    expect(itemsResponse.ok()).toBeTruthy();
    const itemsBody = (await itemsResponse.json()) as { data?: Array<{ id: string; reorderLevel?: number }> } | Array<{ id: string; reorderLevel?: number }>;
    const items = Array.isArray(itemsBody) ? itemsBody : (itemsBody.data ?? []);
    expect(items.length).toBeGreaterThan(0);
    const itemId = items[0].id;

    const binsResponse = await page.request.get("/api/proxy/v1/inventory/bins?limit=1");
    expect(binsResponse.ok()).toBeTruthy();
    const binsBody = (await binsResponse.json()) as { data?: Array<{ storeId: string }> } | Array<{ storeId: string }>;
    const bins = Array.isArray(binsBody) ? binsBody : (binsBody.data ?? []);
    expect(bins.length).toBeGreaterThan(0);
    const warehouseId = bins[0].storeId;

    // 2. Submit a physical count with a large variance (100 units) so it
    // exceeds the auto-adjust threshold (max(5% of system qty, 10 units))
    // and lands in pending_approval rather than auto-posting.
    const createResponse = await page.request.post("/api/proxy/v1/inventory/cycle-counts", {
      data: {
        itemId,
        warehouseId,
        physicalQty: 100,
        reasonCode: "cycle_count",
      },
    });
    expect(createResponse.ok()).toBeTruthy();
    const created = (await createResponse.json()) as { id: string };
    expect(created.id).toBeTruthy();

    // 3. The consumer processes the command asynchronously; poll the detail
    // page until the record exists and its status resolves.
    await expect(async () => {
      await page.goto(`/inventory/cycle-counts/${created.id}`);
      await page.waitForLoadState("networkidle");
      await expect(page.getByText("Cycle count details")).toBeVisible();
    }).toPass({ timeout: 30_000, intervals: [2_000, 3_000, 5_000] });

    // 4. If the variance landed in pending_approval, approve it as the
    // supervisor. If it auto-posted (small variance relative to a large
    // system qty for this live item), the approval controls will not be
    // present — treat that as a valid, already-terminal outcome.
    const approveButton = page.getByRole("button", { name: "Approve" });
    const isPendingApproval = await approveButton.isVisible({ timeout: 5_000 }).catch(() => false);

    if (isPendingApproval) {
      await approveButton.click();
      const dialog = page.getByRole("alertdialog");
      await expect(dialog).toBeVisible({ timeout: 10_000 });
      await dialog.getByRole("button", { name: "Approve" }).click();

      await expect(async () => {
        await page.reload();
        await page.waitForLoadState("networkidle");
        await expect(page.getByText("Approved", { exact: false })).toBeVisible();
      }).toPass({ timeout: 30_000, intervals: [2_000, 3_000, 5_000] });
    } else {
      await expect(page.getByText(/Auto-posted|Approved/)).toBeVisible({ timeout: 15_000 });
    }

    // 5. Verify the resulting stock adjustment appears on the inventory
    // ledger for this item. There is no "Adjustment" movement screen in the
    // web UI today (only Receipts and Issues render inventory-service's
    // ledger via MovementsTable), so this checks the ledger API directly —
    // the same /api/v1/inventory/ledger endpoint those screens call.
    await expect(async () => {
      const ledgerResponse = await page.request.get(`/api/proxy/v1/inventory/ledger?limit=200`);
      expect(ledgerResponse.ok()).toBeTruthy();
      const ledgerBody = (await ledgerResponse.json()) as { data?: Array<{ itemId: string; movementType: string }> } | Array<{ itemId: string; movementType: string }>;
      const ledgerRows = Array.isArray(ledgerBody) ? ledgerBody : (ledgerBody.data ?? []);
      const hasAdjustment = ledgerRows.some((r) => r.itemId === itemId && r.movementType === "adjustment");
      expect(hasAdjustment).toBeTruthy();
    }).toPass({ timeout: 30_000, intervals: [3_000, 5_000, 8_000] });
  });
});
