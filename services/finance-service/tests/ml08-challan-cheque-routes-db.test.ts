/**
 * GAP-FINANCE-REVENUE-CHALLANS-02 / DETAIL-03 (challan list + detail carry the receipt head
 * code and name) and GAP-FINANCE-TREASURY-CHEQUES-05 (instrument list carries the drawn-on
 * account's last four digits, never the full number). Real DB, RLS-scoped.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { eq, inArray } from "drizzle-orm";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { scoped } from "./_tenant.js";
import { financeHeads } from "../src/modules/budget/schema.js";
import { financeBanks, financeChallans, financeInstruments } from "../src/modules/treasury/schema.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-1111-4000-8000-0000000000e8";
const ACTOR = "00000000-aaaa-4000-8000-0000000000e8";
const HEAD = "55555555-aaaa-4000-8000-0000000000e8";
const BANK = "66666666-aaaa-4000-8000-0000000000e8";
const CH_WITH = "77777777-aaaa-4000-8000-0000000000e1";
const CH_ORPHAN = "77777777-aaaa-4000-8000-0000000000e2";
const MISSING_HEAD = "88888888-aaaa-4000-8000-0000000000e8";
const INS = "99999999-aaaa-4000-8000-0000000000e8";
const FULL_ACCOUNT = "123456789012";

const officer = () => ({ authorization: `Bearer ${signToken({ sub: ACTOR, tid: TENANT, roles: ["finance_officer"], sid: "ml08" }, SECRET)}` });

async function cleanup() {
  await scoped(TENANT, async (tx) => {
    await tx.delete(financeChallans).where(inArray(financeChallans.id, [CH_WITH, CH_ORPHAN]));
    await tx.delete(financeInstruments).where(eq(financeInstruments.id, INS));
    await tx.delete(financeBanks).where(eq(financeBanks.id, BANK));
    await tx.delete(financeHeads).where(eq(financeHeads.id, HEAD));
  });
}

beforeAll(async () => {
  await cleanup();
  await scoped(TENANT, async (tx) => {
    await tx.insert(financeHeads).values({ id: HEAD, tenantId: TENANT, code: "0040", name: "Tax Revenue", level: 0, createdBy: ACTOR, updatedBy: ACTOR });
    const base = { tenantId: TENANT, depositor: "ACME", amountMinor: 15050n, createdBy: ACTOR, updatedBy: ACTOR };
    await tx.insert(financeChallans).values([
      { ...base, id: CH_WITH, challanNo: "CH-E8-1", receiptHeadId: HEAD },
      { ...base, id: CH_ORPHAN, challanNo: "CH-E8-2", receiptHeadId: MISSING_HEAD },
    ]);
    await tx.insert(financeBanks).values({ id: BANK, tenantId: TENANT, name: "SBI Main", accountNo: FULL_ACCOUNT, createdBy: ACTOR, updatedBy: ACTOR });
    await tx.insert(financeInstruments).values({
      id: INS, tenantId: TENANT, instrumentType: "cheque", instrumentNo: "E8-0001", bankAccountId: BANK, bankName: "SBI",
      payee: "Payee", amountMinor: 100n, issueDate: "2026-09-01", createdBy: ACTOR, updatedBy: ACTOR,
    });
  });
});
afterAll(async () => { await cleanup(); await sqlClient.end(); });

describe("challan routes carry the receipt head (ml-finance-08)", () => {
  it("list: head code + name resolved; an unresolvable head yields nulls, the challan still lists", async () => {
    const app = await buildApp();
    try {
      const res = await app.inject({ method: "GET", url: "/v1/finance/challans", headers: officer() });
      expect(res.statusCode).toBe(200);
      const rows = res.json() as Array<Record<string, unknown>>;
      expect(rows.find((r) => r.id === CH_WITH)).toMatchObject({ receiptHeadCode: "0040", receiptHeadName: "Tax Revenue", receiptHeadId: HEAD });
      expect(rows.find((r) => r.id === CH_ORPHAN)).toMatchObject({ receiptHeadCode: null, receiptHeadName: null });
    } finally { await app.close(); }
  });

  it("detail: same fields", async () => {
    const app = await buildApp();
    try {
      const res = await app.inject({ method: "GET", url: `/v1/finance/challans/${CH_WITH}`, headers: officer() });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ receiptHeadCode: "0040", receiptHeadName: "Tax Revenue", amountMinor: "15050" });
    } finally { await app.close(); }
  });
});

describe("instrument list carries only the account's last four (ml-finance-08)", () => {
  it("returns accountNoLast4 and never the full account number", async () => {
    const app = await buildApp();
    try {
      const res = await app.inject({ method: "GET", url: "/v1/finance/instruments", headers: officer() });
      expect(res.statusCode).toBe(200);
      const row = (res.json().data as Array<Record<string, unknown>>).find((r) => r.id === INS);
      expect(row?.accountNoLast4).toBe("9012");
      expect(JSON.stringify(res.json())).not.toContain(FULL_ACCOUNT);
    } finally { await app.close(); }
  });
});
