/**
 * GAP-FINANCE-ACCOUNTING-GENERAL-LEDGER-03 (fp-finance-02): GET /v1/finance/journals/lines --
 * bounded server-side paging, FY / type / search filters and whole-set totals.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { scoped } from "./_tenant.js";
import { financeJournals } from "../src/modules/gl/schema.js";
import { bearer } from "./_fp02.js";

// gl.finance_journals is append-only (a trigger refuses DELETE), so each run gets its own tenant.
const T = randomUUID();
const OTHER = randomUUID();
const ACTOR = "00000000-0f02-4000-8000-000000000041";
let app: Awaited<ReturnType<typeof buildApp>>;
const fin = (tenant = T) => bearer(tenant, ACTOR, ["finance_officer"]);
const get = (qs: string, tenant = T) => app.inject({ method: "GET", url: `/v1/finance/journals/lines?${qs}`, headers: fin(tenant) });

let seq = 0;
async function journal(voucherNo: string, type: string, postingDate: string, lines: Array<{ accountCode: string; debitMinor: string; creditMinor: string; narration?: string }>, status = "posted") {
  await scoped(T, (tx) => tx.insert(financeJournals).values({
    id: randomUUID(), tenantId: T, voucherNo, type, postingDate, status, lines, createdBy: ACTOR, updatedBy: ACTOR,
  }));
}

beforeAll(async () => {
  app = await buildApp();
  // FY 2025-26
  await journal("V-001", "payment", "2025-06-10", [{ accountCode: "5100", debitMinor: "100000", creditMinor: "0" }, { accountCode: "1100", debitMinor: "0", creditMinor: "100000", narration: "Cash paid" }]);
  await journal("V-002", "receipt", "2026-03-31", [{ accountCode: "1100", debitMinor: "50000", creditMinor: "0" }, { accountCode: "4100", debitMinor: "0", creditMinor: "50000" }]);
  // FY 2026-27
  await journal("V-003", "journal", "2026-04-01", [{ accountCode: "5200", debitMinor: "7000000000000000000", creditMinor: "0" }, { accountCode: "1100", debitMinor: "0", creditMinor: "7000000000000000000" }]);
  await journal("V-004", "payment", "2026-09-15", [{ accountCode: "5100", debitMinor: "25000", creditMinor: "0" }, { accountCode: "1100", debitMinor: "0", creditMinor: "25000" }]);
  // a draft awaiting approval is not on the ledger
  await journal("V-DRAFT", "journal", "2026-09-16", [{ accountCode: "5100", debitMinor: "999", creditMinor: "0" }, { accountCode: "1100", debitMinor: "0", creditMinor: "999" }], "pending_approval");
});
afterAll(async () => { await app.close(); await sqlClient.end(); });

describe("GET /v1/finance/journals/lines", () => {
  it("returns one bounded page plus whole-set totals", async () => {
    const res = await get("limit=3&offset=0");
    const body = res.json();
    expect(res.statusCode).toBe(200);
    expect(body.data).toHaveLength(3);
    expect(body.pagination).toMatchObject({ limit: 3, offset: 0, total: 8, hasMore: true });
    expect(body.totals).toMatchObject({ entryLines: 8, vouchers: 4, accountsActive: 4 });
    // exact bigint-safe sums (7e18 exceeds 2^53)
    expect(body.totals.debitMinor).toBe("7000000000000175000");
    expect(body.totals.creditMinor).toBe("7000000000000175000");
    const next = (await get("limit=3&offset=6")).json();
    expect(next.data).toHaveLength(2);
    expect(next.pagination.hasMore).toBe(false);
  });

  it("orders by posting date then voucher and never repeats a row across pages", async () => {
    const a = (await get("limit=4&offset=0")).json().data.map((r: { id: string }) => r.id);
    const b = (await get("limit=4&offset=4")).json().data.map((r: { id: string }) => r.id);
    expect(new Set([...a, ...b]).size).toBe(8);
    expect((await get("limit=2&offset=0")).json().data[0].voucherNo).toBe("V-001");
  });

  it("filters by fiscal year (and totals follow the filter)", async () => {
    const fy1 = (await get("fy=2025-26")).json();
    expect(fy1.data.map((r: { voucherNo: string }) => r.voucherNo)).toEqual(["V-001", "V-001", "V-002", "V-002"]);
    expect(fy1.totals).toMatchObject({ entryLines: 4, vouchers: 2, debitMinor: "150000", creditMinor: "150000" });
    const fy2 = (await get("fy=2026-27")).json();
    expect(fy2.totals.vouchers).toBe(2);
  });

  it("filters by voucher type and by search (voucher, account, narration), escaping wildcards", async () => {
    expect((await get("type=receipt")).json().totals.vouchers).toBe(1);
    expect((await get("q=v-004")).json().totals.entryLines).toBe(2);
    expect((await get("q=5200")).json().totals.entryLines).toBe(1);
    expect((await get("q=cash%20paid")).json().totals.entryLines).toBe(1);
    expect((await get("q=%25")).json().totals.entryLines).toBe(0);
  });

  it("excludes drafts, rejects bad params, is tenant-scoped and role-gated", async () => {
    expect((await get("q=V-DRAFT")).json().totals.entryLines).toBe(0);
    expect((await get("limit=101")).statusCode).toBe(400);
    // numeric input is validated (400), never a database error (500)
    expect((await get("offset=99999999999999999999")).statusCode).toBe(400);
    expect((await get("offset=-1")).statusCode).toBe(400);
    expect((await get("limit=abc")).statusCode).toBe(400);
    expect((await get("fy=2026-28")).statusCode).toBe(400);
    expect((await get("limit=5", OTHER)).json().pagination.total).toBe(0);
    const denied = await app.inject({ method: "GET", url: "/v1/finance/journals/lines", headers: bearer(T, ACTOR, ["procurement_officer"]) });
    expect(denied.statusCode).toBe(403);
  });
});

describe("stored amounts must be integer paise strings", () => {
  it("a malformed stored amount is a clear 422 naming the voucher: never a 500 and never silently rounded", async () => {
    const bad = randomUUID();
    const bearerBad = bearer(bad, ACTOR, ["finance_officer"]);
    const put = (voucherNo: string, debit: string) => scoped(bad, (tx) => tx.insert(financeJournals).values({
      id: randomUUID(), tenantId: bad, voucherNo, type: "journal", postingDate: "2026-06-01", status: "posted",
      lines: [{ accountCode: "5100", debitMinor: debit, creditMinor: "0" }, { accountCode: "1100", debitMinor: "0", creditMinor: debit }], createdBy: ACTOR, updatedBy: ACTOR,
    }));
    await put("V-OK", "1000");
    const ok = await app.inject({ method: "GET", url: "/v1/finance/journals/lines", headers: bearerBad });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().totals.debitMinor).toBe("1000");
    await put("V-DECIMAL", "12.5");
    for (const q of ["", "?q=V-OK"]) {
      const res = await app.inject({ method: "GET", url: `/v1/finance/journals/lines${q}`, headers: bearerBad });
      expect(res.statusCode).toBe(q === "" ? 422 : 200); // only a view that would include the bad row fails
      if (q === "") {
        expect(res.json().code).toBe("LEDGER_AMOUNT_INVALID");
        expect(res.json().message).toContain("V-DECIMAL");
      }
    }
    await put("V-TEXT", "abc");
    const text = await app.inject({ method: "GET", url: "/v1/finance/journals/lines?q=V-TEXT", headers: bearerBad });
    expect(text.statusCode).toBe(422);
    const neg = await put("V-NEG", "-5").then(() => app.inject({ method: "GET", url: "/v1/finance/journals/lines?q=V-NEG", headers: bearerBad }));
    expect(neg.statusCode).toBe(422);
  });
});
