import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { runWithTenant } from "@civitasone/db";
import { db, sqlClient } from "../src/shared/db.js";
import { legalCases } from "../src/modules/cases/schema.js";
import { legalOrders } from "../src/modules/hearings/schema.js";
import { listCourtOrderSummariesPaged } from "../src/modules/hearings/queries.js";

/**
 * GAP2-LEGAL-COURT-ORDERS-10: the compliance KPIs and the table used to be
 * computed over a server-capped (default 50) list with no total and no
 * pagination, so "Contempt Risk" was silently undercounted for a legal cell
 * with >50 tracked orders. The paged query must return the TRUE total and
 * stats computed over the FULL set, plus a page slice.
 *
 * Fixture: 60 compliance-required orders, 55 overdue (deadline strictly before
 * `today`), 5 due in the future. The old code (bare array capped at limit)
 * could never report contemptRisk=55 from a 50-row page; the new query does.
 */

const ACTOR = "00000000-aaaa-4000-8000-0000000000a1";
const TENANT = "11111111-aaaa-4000-8000-0000000000a1";
const CASE_1 = "22222222-bbbb-4000-8000-0000000000a1";
const TODAY = "2026-06-15";

function orderId(i: number): string {
  const n = (i + 1).toString(16).padStart(2, "0");
  return `33333333-cccc-4000-8000-0000000000${n}`;
}

beforeAll(async () => {
  await runWithTenant(TENANT, () =>
    db.transaction(async (tx) => {
      await tx.delete(legalOrders).where(eq(legalOrders.tenantId, TENANT));
      await tx.delete(legalCases).where(eq(legalCases.tenantId, TENANT));
      await tx.insert(legalCases).values({
        id: CASE_1,
        tenantId: TENANT,
        caseNo: "WP/PAGING/2026",
        title: "Paging test",
        court: "High Court",
        status: "pending",
        createdBy: ACTOR,
        updatedBy: ACTOR,
      });
      const rows = Array.from({ length: 60 }, (_, i) => ({
        id: orderId(i),
        tenantId: TENANT,
        caseId: CASE_1,
        orderType: "direction",
        summary: `Order ${i}`,
        orderDate: "2026-01-01",
        complianceRequired: true,
        // first 55 overdue (before TODAY), last 5 due in the future
        complianceDeadline: i < 55 ? "2026-05-01" : "2026-12-31",
        createdBy: ACTOR,
        updatedBy: ACTOR,
      }));
      await tx.insert(legalOrders).values(rows);
    }),
  );
});

afterAll(async () => {
  await sqlClient.end();
});

describe("paged court orders + server-side stats (GAP2-LEGAL-COURT-ORDERS-10)", () => {
  it("reports the TRUE total and contempt risk over the full set, not a 50-row slice", async () => {
    const page = await runWithTenant(TENANT, () =>
      listCourtOrderSummariesPaged(TENANT, 25, 0, TODAY),
    );
    // The page slice is capped at the requested limit...
    expect(page.items.length).toBe(25);
    // ...but the total and stats reflect the full tenant set.
    expect(page.total).toBe(60);
    expect(page.stats.total).toBe(60);
    expect(page.stats.pendingCompliance).toBe(60);
    // 55 overdue — NOT capped at the page size (25) or the old default (50).
    expect(page.stats.contemptRisk).toBe(55);
  });

  it("pages via offset to reach rows beyond the first page", async () => {
    const page3 = await runWithTenant(TENANT, () =>
      listCourtOrderSummariesPaged(TENANT, 25, 50, TODAY),
    );
    // 60 total, offset 50 → the final 10 rows are reachable.
    expect(page3.items.length).toBe(10);
    expect(page3.total).toBe(60);
    expect(page3.offset).toBe(50);
  });
});
