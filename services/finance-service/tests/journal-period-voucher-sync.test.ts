/**
 * GAP-FINANCE-ACCOUNTING-VOUCHERS-NEW-06 / -05: POST /v1/finance/journals answers a posting date in a period that cannot
 * take it with 422 (PERIOD_CLOSED | PERIOD_SOFT_CLOSED | PERIOD_UNKNOWN) and a duplicate typed voucher number with a 409
 * field error on voucherNo, BEFORE anything is queued. PATCH .../approve gives the checker the same 422. Real DB.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { sql, eq } from "drizzle-orm";
import { idempotentId } from "@civitasone/auth";
import { MemoryQueue, type Handler } from "@civitasone/queue";
import { runWithTenant } from "@civitasone/db";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { scoped } from "./_tenant.js";
import { financeJournals, financeLedger } from "../src/modules/gl/schema.js";
import { registerGlConsumers } from "../src/modules/gl/consumer.js";
import { periodPostingRefusal, voucherNeedsAllocation } from "../src/modules/gl/posting-rules.js";
import { COMMANDS } from "../src/topics.js";
import { bearer } from "./_fp02.js";

// gl.finance_journals is append-only (a trigger refuses DELETE), so each run gets its own tenant.
const T = randomUUID();
const OTHER = randomUUID();
const MAKER = "00000000-0f02-4000-8000-000000000061";
const CHECKER = "00000000-0f02-4000-8000-000000000062";
let app: Awaited<ReturnType<typeof buildApp>>;
const maker = (tenant = T) => bearer(tenant, MAKER, ["finance_officer"]);
const checker = (tenant = T) => bearer(tenant, CHECKER, ["finance_admin"]);

const lines = [
  { accountCode: "5100", debitMinor: "50000", creditMinor: "0" },
  { accountCode: "1100", debitMinor: "0", creditMinor: "50000" },
];
const post = (body: Record<string, unknown>, headers: Record<string, string> = maker()) =>
  app.inject({ method: "POST", url: "/v1/finance/journals", headers, payload: { type: "journal", lines, narration: "n", ...body } });

async function closePeriod(tenant: string, period: string, status: "hard_close" | "soft_close") {
  await scoped(tenant, (tx) => tx.execute(sql`
    INSERT INTO gl.finance_period_close (tenant_id, period, fiscal_year, status, closed_by, closed_at, created_by)
    VALUES (${tenant}::uuid, ${period}, '2025-26', ${status}, ${CHECKER}::uuid, now(), ${CHECKER}::uuid)`));
}
async function draft(tenant: string, over: Record<string, unknown> = {}) {
  const id = (over.id as string | undefined) ?? randomUUID();
  await scoped(tenant, (tx) => tx.insert(financeJournals).values({
    id, tenantId: tenant, voucherNo: `DRAFT-${id}`, type: "journal", postingDate: "2026-05-10", status: "pending_approval",
    lines, createdBy: MAKER, updatedBy: MAKER, ...over,
  }));
  return id;
}

beforeAll(async () => {
  await closePeriod(T, "2026-03", "hard_close");
  await closePeriod(T, "2026-04", "soft_close");
});
afterAll(async () => {
  await scoped(T, (tx) => tx.execute(sql`DELETE FROM gl.finance_period_close WHERE tenant_id = ${T}::uuid`));
  await sqlClient.end();
});
// POST /v1/finance/journals is rate limited (10/min per app instance), so each describe that posts builds its own app.
function useApp() {
  beforeAll(async () => { app = await buildApp(); });
  afterAll(async () => { await app.close(); });
}
afterEach(() => { vi.restoreAllMocks(); });

describe("pure rules", () => {
  it("periodPostingRefusal: open posts, soft-close takes only adjustment/closing, hard-close and unknown never post", () => {
    expect(periodPostingRefusal("open", "journal", "2026-05")).toBeNull();
    expect(periodPostingRefusal("hard_close", "journal", "2026-03")).toMatchObject({ code: "PERIOD_CLOSED" });
    expect(periodPostingRefusal("hard_close", "adjustment", "2026-03")).toMatchObject({ code: "PERIOD_CLOSED" });
    expect(periodPostingRefusal("soft_close", "journal", "2026-04")).toMatchObject({ code: "PERIOD_SOFT_CLOSED" });
    expect(periodPostingRefusal("soft_close", "payment", "2026-04")).toMatchObject({ code: "PERIOD_SOFT_CLOSED" });
    expect(periodPostingRefusal("soft_close", "adjustment", "2026-04")).toBeNull();
    expect(periodPostingRefusal("soft_close", "closing", "2026-04")).toBeNull();
    expect(periodPostingRefusal("unknown", "journal", "2026-13")).toMatchObject({ code: "PERIOD_UNKNOWN" });
  });
  it("voucherNeedsAllocation: blank / AUTO in any case ask the GL to number it; anything else is typed", () => {
    for (const v of ["", "  ", "AUTO", "auto", "Auto", null, undefined]) expect(voucherNeedsAllocation(v)).toBe(true);
    for (const v of ["JV-2026-001", "x", "AUTO-1"]) expect(voucherNeedsAllocation(v)).toBe(false);
  });
});

describe("POST /v1/finance/journals: period is checked before anything is queued (VOUCHERS-NEW-06)", () => {
  useApp();
  it("a date in a hard-closed period is 422 PERIOD_CLOSED with a postingDate field error, and nothing is queued", async () => {
    const publish = vi.spyOn(queue, "publish");
    const res = await post({ voucherNo: "AUTO", postingDate: "2026-03-15" });
    expect(res.statusCode).toBe(422);
    expect(res.json()).toMatchObject({ code: "PERIOD_CLOSED", fieldErrors: [{ field: "postingDate" }] });
    expect(res.json().message).toContain("2026-03");
    expect(publish).not.toHaveBeenCalled();
    // nothing was posted or drafted for this tenant
    const rows = await scoped(T, (tx) => tx.select().from(financeJournals).where(eq(financeJournals.tenantId, T)));
    expect(rows.filter((r) => r.postingDate === "2026-03-15")).toHaveLength(0);
    expect(await scoped(T, (tx) => tx.select().from(financeLedger).where(eq(financeLedger.tenantId, T)))).toHaveLength(0);
  });

  it("every manual voucher type is refused in a hard-closed period", async () => {
    const publish = vi.spyOn(queue, "publish");
    for (const type of ["journal", "payment", "receipt", "contra"]) {
      const res = await post({ voucherNo: "AUTO", postingDate: "2026-03-31", type });
      expect(res.statusCode, type).toBe(422);
      expect(res.json().code).toBe("PERIOD_CLOSED");
    }
    expect(publish).not.toHaveBeenCalled();
  });

  it("a soft-closed period refuses a manual journal: 422 PERIOD_SOFT_CLOSED", async () => {
    const publish = vi.spyOn(queue, "publish");
    const res = await post({ voucherNo: "AUTO", postingDate: "2026-04-10" });
    expect(res.statusCode).toBe(422);
    expect(res.json()).toMatchObject({ code: "PERIOD_SOFT_CLOSED", fieldErrors: [{ field: "postingDate" }] });
    expect(publish).not.toHaveBeenCalled();
  });

  it("a month that is not a month fails closed: 422 PERIOD_UNKNOWN", async () => {
    const publish = vi.spyOn(queue, "publish");
    const res = await post({ voucherNo: "AUTO", postingDate: "2026-13-10" });
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe("PERIOD_UNKNOWN");
    expect(publish).not.toHaveBeenCalled();
  });

  it("an open period is still accepted (202) and queued exactly once", async () => {
    const publish = vi.spyOn(queue, "publish");
    const res = await post({ voucherNo: "AUTO", postingDate: "2026-05-10" });
    expect(res.statusCode).toBe(202);
    expect(publish).toHaveBeenCalledTimes(1);
    expect(publish.mock.calls[0]![0]).toBe(COMMANDS.journalCreate);
  });

  it("the period check is per tenant: another tenant's closed month does not block this one", async () => {
    const res = await post({ voucherNo: "AUTO", postingDate: "2026-03-15" }, maker(OTHER));
    expect(res.statusCode).toBe(202);
  });

  it("role gate is unchanged: a non-finance role is still 403 before any period lookup", async () => {
    const res = await post({ voucherNo: "AUTO", postingDate: "2026-03-15" }, bearer(T, MAKER, ["citizen"]));
    expect(res.statusCode).toBe(403);
  });
});

describe("POST /v1/finance/journals: duplicate typed voucher number (VOUCHERS-NEW-05)", () => {
  useApp();
  it("409 DUPLICATE_VOUCHER as a voucherNo field error when the number is taken (also by a pending draft)", async () => {
    await draft(T, { voucherNo: "JV-2026-001" });
    const publish = vi.spyOn(queue, "publish");
    const res = await post({ voucherNo: "JV-2026-001", postingDate: "2026-05-10" });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ code: "DUPLICATE_VOUCHER", fieldErrors: [{ field: "voucherNo", message: expect.stringMatching(/already exists/) }] });
    expect(publish).not.toHaveBeenCalled();
  });

  it("a new number is accepted; blank and AUTO (any case) are never treated as duplicates", async () => {
    for (const voucherNo of ["JV-2026-NEW", "AUTO", "auto", "Auto"]) {
      const res = await post({ voucherNo, postingDate: "2026-05-10" });
      expect(res.statusCode, voucherNo).toBe(202);
    }
    // two AUTO requests in a row are fine: each gets its own DRAFT- placeholder and a gapless number on approval
    expect((await post({ voucherNo: "AUTO", postingDate: "2026-05-11" })).statusCode).toBe(202);
  });

  it("is tenant-scoped: another tenant's identical number is not a duplicate", async () => {
    await draft(OTHER, { voucherNo: "JV-2026-777" });
    expect((await post({ voucherNo: "JV-2026-777", postingDate: "2026-05-10" })).statusCode).toBe(202);
  });

  it("a retry of the SAME request (same idempotency key) is not rejected as a duplicate of itself", async () => {
    const key = randomUUID();
    await draft(T, { id: idempotentId({ idempotencyKey: key, tenantId: T }), voucherNo: "JV-2026-RETRY" });
    const retry = await post({ voucherNo: "JV-2026-RETRY", postingDate: "2026-05-10" }, { ...maker(), "x-idempotency-key": key });
    expect(retry.statusCode).toBe(202);
    // a DIFFERENT submission reusing the number is a duplicate
    const other = await post({ voucherNo: "JV-2026-RETRY", postingDate: "2026-05-10" }, { ...maker(), "x-idempotency-key": randomUUID() });
    expect(other.statusCode).toBe(409);
  });
});

describe("PATCH /v1/finance/journals/:id/approve: the checker is told about a closed period (VOUCHERS-NEW-06)", () => {
  useApp();
  it("a draft whose period has since closed is 422 PERIOD_CLOSED and nothing is queued", async () => {
    const id = await draft(T, { postingDate: "2026-03-20" });
    const publish = vi.spyOn(queue, "publish");
    const res = await app.inject({ method: "PATCH", url: `/v1/finance/journals/${id}/approve`, headers: checker() });
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe("PERIOD_CLOSED");
    expect(publish).not.toHaveBeenCalled();
    const [row] = await scoped(T, (tx) => tx.select().from(financeJournals).where(eq(financeJournals.id, id)));
    expect(row?.status).toBe("pending_approval");
  });

  it("a draft in an open period is accepted (202); an unknown id falls through to the consumer unchanged (202)", async () => {
    const id = await draft(T, { postingDate: "2026-05-20" });
    const ok = await app.inject({ method: "PATCH", url: `/v1/finance/journals/${id}/approve`, headers: checker() });
    expect(ok.statusCode).toBe(202);
    const unknown = await app.inject({ method: "PATCH", url: `/v1/finance/journals/${randomUUID()}/approve`, headers: checker() });
    expect(unknown.statusCode).toBe(202);
  });

  it("a plain finance_officer is still refused (403) and another tenant's draft is not looked at", async () => {
    const id = await draft(T, { postingDate: "2026-03-20" });
    const denied = await app.inject({ method: "PATCH", url: `/v1/finance/journals/${id}/approve`, headers: maker() });
    expect(denied.statusCode).toBe(403);
    // the checker of ANOTHER tenant cannot see T's draft: RLS hides it, so the route does not 422 on it
    const foreign = await app.inject({ method: "PATCH", url: `/v1/finance/journals/${id}/approve`, headers: checker(OTHER) });
    expect(foreign.statusCode).toBe(202);
  });
});

describe("finance.gl.approve consumer: a period that closed after the request is a non-retryable refusal", () => {
  /** Same shape as dom-024's tenantWrappedQueue: handlers run under the message's tenant GUC. */
  function wrapped(): MemoryQueue {
    const q = new MemoryQueue();
    const raw = q.subscribe.bind(q);
    q.subscribe = ((topic: string, handler: Handler) =>
      raw(topic, (msg: Parameters<Handler>[0]) => runWithTenant(msg.tenantId, () => handler(msg)))) as typeof q.subscribe;
    return q;
  }

  it("dead-letters at once (one attempt, not a retry loop), posts nothing and leaves the draft pending", async () => {
    const head = randomUUID();
    const bank = randomUUID();
    const id = await draft(T, {
      postingDate: "2026-03-20",
      lines: [{ accountCode: head, debitMinor: "50000", creditMinor: "0" }, { accountCode: bank, debitMinor: "0", creditMinor: "50000" }],
    });
    const q = wrapped();
    let attempts = 0;
    const rawSub = q.subscribe.bind(q);
    q.subscribe = ((topic: string, handler: Handler) =>
      rawSub(topic, async (msg: Parameters<Handler>[0]) => { if (topic === COMMANDS.journalApprove) attempts += 1; return handler(msg); })) as typeof q.subscribe;
    registerGlConsumers(q);
    await q.start();
    await q.publish(COMMANDS.journalApprove, {
      messageId: randomUUID(), type: COMMANDS.journalApprove,
      tenantId: T, actorId: CHECKER, correlationId: "corr-vn06", schemaVersion: "1.0",
      payload: { id, tenantId: T },
    });
    await q.drain();
    await q.stop();

    expect(attempts).toBe(1);
    expect(q.dlq).toHaveLength(1);
    expect(q.dlq[0]?.error).toMatch(/PERIOD_CLOSED/);
    const [row] = await scoped(T, (tx) => tx.select().from(financeJournals).where(eq(financeJournals.id, id)));
    expect(row?.status).toBe("pending_approval");
    expect(row?.voucherNo).toBe(`DRAFT-${id}`);
    const ledger = await scoped(T, (tx) => tx.select().from(financeLedger).where(eq(financeLedger.tenantId, T)));
    expect(ledger.some((l) => l.headId === head || l.headId === bank)).toBe(false);
  });
});
