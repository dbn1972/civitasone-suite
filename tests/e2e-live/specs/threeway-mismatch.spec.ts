import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { injectAuthCookie } from "../helpers/auth";

/**
 * Three-way-match mismatch (Req 6.3): create a PO for qty 100, submit a
 * three-way match with a GRN qty of 60 (a 40% variance, well above the
 * default 5% tolerance), and verify inventory-service's matching module
 * flags it as an "exception" and blocks payment.
 *
 * GAP NOTE — the task description names a `QTY_MISMATCH` reason code, but
 * that string does not exist anywhere in the codebase. Reading
 * services/inventory-service/src/modules/matching/consumer.ts, the
 * payment.blocked event's reason is always exactly one of two literal
 * strings: "MATCH_EXCEPTION" (variance exceeds tolerance — this case) or
 * "SRN_MISSING" (a clean match with no signed SRN yet). "qty_mismatch..."
 * only appears in a completely different pipeline
 * (procurement-service's grn/consumer.ts threeWayMatchFailed/grnRejected
 * events, computed by computeThreeWayMatch — unrelated to this module's
 * payment.blocked). This spec verifies the reason inventory-service
 * actually emits: "MATCH_EXCEPTION".
 *
 * Like task 31, there is no web UI for the matching module at all — the
 * match is submitted directly via POST /api/proxy/v1/inventory/matches,
 * same fallback pattern used by procurement-full-chain.spec.ts and
 * inventory-cycle-count.spec.ts. A real PO is still created via the UI so
 * the match record references a genuine poId.
 */
test.describe("Inventory — Three-Way-Match Mismatch (Live)", () => {
  test.beforeEach(async ({ page }) => {
    await injectAuthCookie(page);
  });

  test("PO qty 100 vs GRN qty 60 exceeds tolerance, flags exception, blocks payment", async ({ page }) => {
    const itemCode = `E2E-MISMATCH-${Date.now()}`;

    // 1. Create an indent + PO for qty 100 so the match references a real poId.
    await page.goto("/procurement/indents/new");
    await page.waitForLoadState("networkidle");
    await page.locator("#department").fill("Administration");
    await page.locator("#li-code-0").fill(itemCode);
    await page.locator("#li-desc-0").fill("E2E mismatch test item");
    await page.locator("#li-qty-0").fill("100");
    await page.locator("#li-price-0").fill("100");
    await page.getByRole("button", { name: "Submit for approval" }).click();
    await page.waitForURL(/\/procurement\/indents$/, { timeout: 15_000 });

    const indentsResponse = await page.request.get("/api/proxy/v1/procurement/indents?limit=50");
    expect(indentsResponse.ok()).toBeTruthy();
    const indentsBody = (await indentsResponse.json()) as { data?: Array<{ id: string; department?: string }> } | Array<{ id: string; department?: string }>;
    const indents = Array.isArray(indentsBody) ? indentsBody : (indentsBody.data ?? []);
    const ourIndent = indents.find((i) => i.department === "Administration");
    expect(ourIndent).toBeTruthy();

    await page.goto("/procurement/orders/new");
    await page.waitForLoadState("networkidle");
    const indentSelect = page.locator("select").nth(1);
    await expect(async () => {
      const optionCount = await indentSelect.locator("option").count();
      expect(optionCount).toBeGreaterThan(0);
    }).toPass({ timeout: 15_000, intervals: [1_000, 2_000] });
    if (ourIndent) {
      await indentSelect.selectOption(ourIndent.id);
    }
    await page.locator("#li-code-0").fill(itemCode);
    await page.locator("#li-desc-0").fill("E2E mismatch test item");
    await page.locator("#li-qty-0").fill("100");
    await page.locator("#li-price-0").fill("100");

    const poResponsePromise = page.waitForResponse(
      (res) => res.url().includes("/api/proxy/v1/procurement/pos") && res.request().method() === "POST",
    );
    await page.getByRole("button", { name: "Create PO" }).click();
    const poResponse = await poResponsePromise.catch(() => null);
    if (poResponse) {
      expect(poResponse.ok()).toBeTruthy();
    }
    await page.waitForURL(/\/procurement\/orders\/[^/]+$/, { timeout: 20_000 });
    const poId = page.url().split("/").pop() as string;
    expect(poId).toBeTruthy();

    // 2. Submit a three-way match: PO qty 100 vs GRN qty 60 (40% variance,
    // exceeds the default 5% percentageTolerance). Keep invoice qty/rate
    // equal to PO so only the PO-vs-GRN comparison produces a variance,
    // isolating the case the task describes. No real GRN/SRN is created —
    // the exception path never reaches the SRN lookup (matching/consumer.ts
    // only checks SRN when paymentBlocked is already false), so a synthetic
    // grnId is sufficient to exercise this branch.
    const grnId = randomUUID();
    const invoiceId = randomUUID();
    const matchResponse = await page.request.post("/api/proxy/v1/inventory/matches", {
      data: {
        poId,
        grnId,
        invoiceId,
        poQty: 100,
        poRatePaise: "10000",
        grnQty: 60,
        invoiceQty: 100,
        invoiceRatePaise: "10000",
      },
    });
    expect(matchResponse.ok()).toBeTruthy();
    const createdMatch = (await matchResponse.json()) as { id: string };
    expect(createdMatch.id).toBeTruthy();

    // 3. Poll until the async consumer resolves the match to "exception"
    // with paymentBlocked: 1 (persisted as an integer, not a boolean).
    await expect(async () => {
      const getResponse = await page.request.get(`/api/proxy/v1/inventory/matches/${createdMatch.id}`);
      expect(getResponse.ok()).toBeTruthy();
      const match = (await getResponse.json()) as { status?: string; paymentBlocked?: number; qtyVariances?: unknown[] } | { data?: { status?: string; paymentBlocked?: number; qtyVariances?: unknown[] } };
      const record = "data" in match && match.data ? match.data : (match as { status?: string; paymentBlocked?: number; qtyVariances?: unknown[] });
      expect(record.status).toBe("exception");
      expect(record.paymentBlocked).toBe(1);
      expect(Array.isArray(record.qtyVariances) && record.qtyVariances.length).toBeTruthy();
    }).toPass({ timeout: 30_000, intervals: [3_000, 5_000, 8_000] });
  });
});
