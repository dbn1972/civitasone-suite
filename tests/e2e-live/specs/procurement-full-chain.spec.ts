import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { injectAuthCookie } from "../helpers/auth";

/**
 * Full procurement chain (Req 6.3): raise indent -> create PO -> approve PO
 * via workflow -> dispatch PO -> create GRN (with a passing inspection,
 * which auto-computes the three-way match and accepts the GRN) -> create +
 * sign an SRN -> verify a clean three-way match releases payment.
 *
 * GAP NOTES (verified by reading the source, not assumed):
 * - There is no UI for creating a three-way-match record. inventory-service's
 *   matching module (services/inventory-service/src/modules/matching/) has
 *   no web page anywhere, and nothing in the codebase automatically
 *   publishes inventory.match.create from GRN acceptance or SRN signing —
 *   it is a standalone POST /v1/inventory/matches endpoint. This step goes
 *   through a direct API call, same fallback pattern as
 *   inventory-cycle-count.spec.ts's create step.
 * - "payment released" has no queryable UI surface or persisted flag beyond
 *   the match record itself. Verification polls GET
 *   /api/proxy/v1/inventory/matches/{id} for status: "matched" and
 *   paymentBlocked: false, which is what gates the paymentReleased event in
 *   matching/consumer.ts (paymentReleased only fires when the match is not
 *   blocked AND the SRN for the GRN is signed).
 * - PO creation does not require the source indent to be approved
 *   (po/consumer.ts never calls assertIndentApproved) — the indent step
 *   still runs first because task 6.3 asks for "raise indent -> create PO"
 *   as a traceable chain, not because the backend enforces the ordering.
 *
 * Uses the injected super_admin JWT for every step (indenting officer, PO
 * approver, dispatching officer, inspector, store officer) — the same
 * break-glass single-actor pattern used by the other e2e-live specs. Since
 * workflow-service allows a super_admin to override self-approval denial
 * (commands.ts's SoD check), the PO approval step works even though the
 * same actor created and approves it.
 */
test.describe("Procurement — Full Chain incl. SRN (Live)", () => {
  test.beforeEach(async ({ page }) => {
    await injectAuthCookie(page);
  });

  test("indent -> PO -> approve -> dispatch -> GRN -> SRN -> three-way match releases payment", async ({ page }) => {
    const itemCode = `E2E-${Date.now()}`;

    // 1. Raise an indent. Keep total well under the ₹25,000 GFR Rule 145
    // tender threshold so it stays in the normal (non-tender) approval flow.
    await page.goto("/procurement/indents/new");
    await page.waitForLoadState("networkidle");

    await page.locator("#department").fill("Administration");
    await page.locator("#li-code-0").fill(itemCode);
    await page.locator("#li-desc-0").fill("E2E full-chain test item");
    await page.locator("#li-qty-0").fill("5");
    await page.locator("#li-price-0").fill("100");

    const indentResponsePromise = page.waitForResponse(
      (res) => res.url().includes("/api/proxy/v1/procurement/indents") && res.request().method() === "POST",
    );
    await page.getByRole("button", { name: "Submit for approval" }).click();
    const indentResponse = await indentResponsePromise.catch(() => null);
    if (indentResponse) {
      expect(indentResponse.ok()).toBeTruthy();
    }
    await page.waitForURL(/\/procurement\/indents$/, { timeout: 15_000 });

    // Fetch the indent we just created (server-generates the real indentNo,
    // so we cannot rely on the client-side placeholder value).
    const indentsResponse = await page.request.get("/api/proxy/v1/procurement/indents?limit=50");
    expect(indentsResponse.ok()).toBeTruthy();
    const indentsBody = (await indentsResponse.json()) as { data?: Array<{ id: string; department?: string }> } | Array<{ id: string; department?: string }>;
    const indents = Array.isArray(indentsBody) ? indentsBody : (indentsBody.data ?? []);
    const ourIndent = indents.find((i) => i.department === "Administration");
    expect(ourIndent).toBeTruthy();

    // 2. Create a PO against that indent.
    await page.goto("/procurement/orders/new");
    await page.waitForLoadState("networkidle");

    const indentSelect = page.locator("select").nth(1); // Vendor is select 0, Source indent is select 1
    await expect(async () => {
      const optionCount = await indentSelect.locator("option").count();
      expect(optionCount).toBeGreaterThan(0);
    }).toPass({ timeout: 15_000, intervals: [1_000, 2_000] });
    if (ourIndent) {
      await indentSelect.selectOption(ourIndent.id);
    }
    await page.locator("#li-code-0").fill(itemCode);
    await page.locator("#li-desc-0").fill("E2E full-chain test item");
    await page.locator("#li-qty-0").fill("5");
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

    // 3. Approve the PO via the workflow approvals queue.
    await expect(async () => {
      await page.goto("/procurement/approvals");
      await page.waitForLoadState("networkidle");
      const poLink = page.locator(`a[href="/procurement/orders/${poId}"]`);
      await expect(poLink).toBeVisible({ timeout: 10_000 });
    }).toPass({ timeout: 30_000, intervals: [2_000, 3_000, 5_000] });

    const approveRow = page.locator("tr", { has: page.locator(`a[href="/procurement/orders/${poId}"]`) });
    await approveRow.getByRole("button", { name: "Approve" }).click();
    const approveDialog = page.getByRole("alertdialog");
    await expect(approveDialog).toBeVisible({ timeout: 10_000 });
    await approveDialog.getByRole("button", { name: "Approve" }).click();
    await expect(page.getByText("Approved via workflow.")).toBeVisible({ timeout: 15_000 });

    // 4. Dispatch the PO to the vendor (only enabled once approved).
    await expect(async () => {
      await page.goto(`/procurement/orders/${poId}`);
      await page.waitForLoadState("networkidle");
      await expect(page.getByRole("button", { name: "Dispatch to vendor" })).toBeVisible({ timeout: 5_000 });
    }).toPass({ timeout: 30_000, intervals: [2_000, 3_000, 5_000] });

    await page.getByRole("button", { name: "Dispatch to vendor" }).click();
    const dispatchDialog = page.getByRole("alertdialog");
    await expect(dispatchDialog).toBeVisible({ timeout: 10_000 });
    await dispatchDialog.getByRole("button", { name: "Dispatch" }).click();
    await expect(page.getByText("PO dispatched to vendor.")).toBeVisible({ timeout: 15_000 });

    // 5. Create a GRN against the dispatched PO with a passing inspection —
    // this auto-computes the three-way match inside procurement-service and
    // sets the GRN to "accepted" (there is no separate manual accept step).
    await page.goto("/procurement/grn/new");
    await page.waitForLoadState("networkidle");

    const poSelect = page.locator("select").first();
    await expect(async () => {
      const optionCount = await poSelect.locator("option").count();
      expect(optionCount).toBeGreaterThan(0);
    }).toPass({ timeout: 15_000, intervals: [1_000, 2_000] });
    await poSelect.selectOption(poId);

    // Fill accepted/received to equal ordered so computeThreeWayMatch passes.
    await page.locator('input[id^="g-code-"]').first().fill(itemCode);
    await page.locator('input[aria-label="Ordered qty row 1"]').fill("5");
    await page.locator('input[aria-label="Received qty row 1"]').fill("5");
    await page.locator('input[aria-label="Accepted qty row 1"]').fill("5");

    const inspectionResultSelect = page.locator("label:has-text('Inspection result') select, label:has-text('Inspection result') + select");
    if (await inspectionResultSelect.first().isVisible({ timeout: 5_000 }).catch(() => false)) {
      await inspectionResultSelect.first().selectOption("pass");
    }

    const grnResponsePromise = page.waitForResponse(
      (res) => res.url().includes("/api/proxy/v1/procurement/grns") && res.request().method() === "POST",
    );
    await page.getByRole("button", { name: "Record GRN" }).click();
    const grnResponse = await grnResponsePromise.catch(() => null);
    if (grnResponse) {
      expect(grnResponse.ok()).toBeTruthy();
    }
    await page.waitForURL(/\/procurement\/grn\/[^/]+$/, { timeout: 20_000 });
    const grnId = page.url().split("/").pop() as string;
    expect(grnId).toBeTruthy();

    await expect(page.getByText(/Accepted/i).first()).toBeVisible({ timeout: 15_000 });

    // 6. Create and sign an SRN against the now-accepted GRN — required
    // (GFR Rule 149) before the matching pipeline will release payment.
    await page.goto(`/procurement/grn/${grnId}/srn/new`);
    await page.waitForLoadState("networkidle");

    const signNowCheckbox = page.getByRole("checkbox", { name: /Sign now/ });
    await expect(signNowCheckbox).toBeChecked({ timeout: 10_000 });

    await page.getByRole("button", { name: "Sign & Submit" }).click();
    await page.waitForURL(new RegExp(`/procurement/grn/${grnId}/srn$`), { timeout: 20_000 });

    // 7. There is no UI for the inventory-service matching module. Submit a
    // clean three-way match directly (poQty === grnQty === invoiceQty,
    // poRatePaise === invoiceRatePaise) and poll until the async consumer
    // resolves it to "matched" with paymentBlocked: false — the exact
    // condition under which matching/consumer.ts emits
    // EVENTS.paymentReleased ("inventory.payment.released").
    const invoiceId = randomUUID();
    const matchResponse = await page.request.post("/api/proxy/v1/inventory/matches", {
      data: {
        poId,
        grnId,
        invoiceId,
        poQty: 5,
        poRatePaise: "10000",
        grnQty: 5,
        invoiceQty: 5,
        invoiceRatePaise: "10000",
      },
    });
    expect(matchResponse.ok()).toBeTruthy();
    const createdMatch = (await matchResponse.json()) as { id: string };
    expect(createdMatch.id).toBeTruthy();

    await expect(async () => {
      const getResponse = await page.request.get(`/api/proxy/v1/inventory/matches/${createdMatch.id}`);
      expect(getResponse.ok()).toBeTruthy();
      const match = (await getResponse.json()) as { status?: string; paymentBlocked?: number } | { data?: { status?: string; paymentBlocked?: number } };
      const record = "data" in match && match.data ? match.data : (match as { status?: string; paymentBlocked?: number });
      expect(record.status).toBe("matched");
      // paymentBlocked is persisted as an integer (0/1), not a real boolean —
      // see matching/schema.ts.
      expect(record.paymentBlocked).toBe(0);
    }).toPass({ timeout: 30_000, intervals: [3_000, 5_000, 8_000] });
  });
});
