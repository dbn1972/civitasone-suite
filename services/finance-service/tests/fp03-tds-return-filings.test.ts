/**
 * GAP-FINANCE-STATUTORY-TDS-RETURNS-04 — quarterly TDS return filing register.
 * Pure domain rules, the consumer (real DB, race-safe single filing, audit once) and the routes.
 */
import { describe, it, expect, afterAll, beforeAll, vi } from "vitest";
import { queue } from "../src/shared/infra.js";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import { runWithTenant } from "@civitasone/db";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { scoped } from "./_tenant.js";
import { registerTdsConsumers } from "../src/modules/tds/consumer.js";
import { tenantScoped } from "../src/shared/tenant-queue.js";
import { COMMANDS } from "../src/topics.js";
import {
  defaultDueDate, quarterEndDate, filingStatus, assertValidAckNo, assertValidFilingDate, TdsFilingError,
} from "../src/modules/tds/filings-domain.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-1111-4000-8000-0000000003f1";
const ACTOR = "00000000-aaaa-4000-8000-0000000003f1";
const token = (roles: string[]) => signToken({ sub: ACTOR, tid: TENANT, roles, sid: "sess-tds-filing" }, SECRET);

describe("filings-domain (pure)", () => {
  it("quarter ends and default due dates follow the Indian fiscal year", () => {
    expect(quarterEndDate("2026-27", "Q1")).toBe("2026-06-30");
    expect(quarterEndDate("2026-27", "Q4")).toBe("2027-03-31");
    expect(defaultDueDate("2026-27", "Q1")).toBe("2026-07-31");
    expect(defaultDueDate("2026-27", "Q2")).toBe("2026-10-31");
    expect(defaultDueDate("2026-27", "Q3")).toBe("2027-01-31");
    expect(defaultDueDate("2026-27", "Q4")).toBe("2027-05-31");
  });
  it("rejects a malformed or non-consecutive fiscal year", () => {
    expect(() => quarterEndDate("2026-28", "Q1")).toThrow(TdsFilingError);
    expect(() => quarterEndDate("26-27", "Q1")).toThrow(TdsFilingError);
  });
  it("status is filed, else pending until the IST due date passes, then overdue", () => {
    expect(filingStatus(true, "2026-07-31", "2027-01-01")).toBe("filed");
    expect(filingStatus(false, "2026-07-31", "2026-07-31")).toBe("pending");
    expect(filingStatus(false, "2026-07-31", "2026-08-01")).toBe("overdue");
  });
  it("validates the acknowledgement number and the filing date", () => {
    expect(() => assertValidAckNo("ABC123")).not.toThrow();
    expect(() => assertValidAckNo("ab 12")).toThrow(/acknowledgement/);
    expect(() => assertValidFilingDate("2026-27", "Q1", "2026-07-15", "2026-10-03")).not.toThrow();
    expect(() => assertValidFilingDate("2026-27", "Q1", "2026-06-30", "2026-10-03")).toThrow(/quarter/);
    expect(() => assertValidFilingDate("2026-27", "Q1", "2026-10-04", "2026-10-03")).toThrow(/future/);
  });
});

type Handler = (msg: any) => Promise<void>;
class TestQueue {
  handlers = new Map<string, Handler>();
  subscribe(topic: string, handler: Handler) { this.handlers.set(topic, handler); }
  deliver(topic: string, msg: any) { return this.handlers.get(topic)!(msg); }
}
const cmd = (payload: Record<string, unknown>) => ({
  messageId: randomUUID(), tenantId: TENANT, actorId: ACTOR, correlationId: randomUUID(), payload: { tenantId: TENANT, ...payload },
});
async function filings() {
  return scoped(TENANT, async (tx) => {
    const r: any = await tx.execute(sql`SELECT quarter, ack_no, status, filed_by::text AS filed_by FROM gl.finance_tds_return_filings WHERE tenant_id = ${TENANT}::uuid`);
    return Array.isArray(r) ? r : r.rows ?? [];
  });
}
async function auditCount(correlationIds: string[]) {
  return runWithTenant(TENANT, () => db.transaction(async (tx) => {
    const r: any = await tx.execute(sql`SELECT count(*)::int AS n FROM _outbox.messages WHERE topic = 'audit.event.record' AND correlation_id IN (${sql.join(correlationIds.map((c) => sql`${c}`), sql`, `)})`);
    return (Array.isArray(r) ? r : r.rows)[0].n as number;
  }));
}
async function seedDeduction(status: string, quarter = "Q1") {
  await scoped(TENANT, (tx) => tx.execute(sql`
    INSERT INTO gl.finance_vendor_tds (id, tenant_id, vendor_id, section, gross_amount_minor, tds_rate_pct, tds_amount_minor, net_payment_minor, deduction_date, quarter, fy, status)
    VALUES (gen_random_uuid(), ${TENANT}::uuid, gen_random_uuid(), '194C', 100000, 2, 2000, 98000, '2026-05-10', ${quarter}, '2026-27', ${status})`));
}
async function cleanup() {
  await scoped(TENANT, (tx) => tx.execute(sql`DELETE FROM gl.finance_tds_return_filings WHERE tenant_id = ${TENANT}::uuid`));
  await scoped(TENANT, (tx) => tx.execute(sql`DELETE FROM gl.finance_vendor_tds WHERE tenant_id = ${TENANT}::uuid`));
}
beforeAll(cleanup);
afterAll(async () => { await cleanup(); await sqlClient.end(); });

describe("tdsReturnFile consumer", () => {
  it("records the filing, marks deposited deductions filed (not undeposited ones), and audits once", async () => {
    await cleanup();
    await seedDeduction("deposited");
    await seedDeduction("deducted");
    const q = new TestQueue();
    registerTdsConsumers(tenantScoped(q as any));
    const m = cmd({ id: randomUUID(), fy: "2026-27", quarter: "Q1", formType: "26Q", ackNo: "ACK123456", filedOn: "2026-07-20", dueDate: "2026-07-31" });
    await q.deliver(COMMANDS.tdsReturnFile, m);
    const rows = await filings();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ quarter: "Q1", ack_no: "ACK123456", status: "filed", filed_by: ACTOR });
    const st = await scoped(TENANT, async (tx) => {
      const r: any = await tx.execute(sql`SELECT status, count(*)::int AS n FROM gl.finance_vendor_tds WHERE tenant_id = ${TENANT}::uuid GROUP BY status`);
      return Object.fromEntries((Array.isArray(r) ? r : r.rows).map((x: any) => [x.status, x.n]));
    });
    expect(st).toEqual({ filed: 1, deducted: 1 });
    expect(await auditCount([m.correlationId])).toBe(1);
  });

  it("redelivery of the same message is a no-op", async () => {
    await cleanup();
    const q = new TestQueue();
    registerTdsConsumers(tenantScoped(q as any));
    const m = cmd({ id: randomUUID(), fy: "2026-27", quarter: "Q2", formType: "26Q", ackNo: "ACK222222", filedOn: "2026-10-20", dueDate: "2026-10-31" });
    await q.deliver(COMMANDS.tdsReturnFile, m);
    await q.deliver(COMMANDS.tdsReturnFile, m);
    expect(await filings()).toHaveLength(1);
    expect(await auditCount([m.correlationId])).toBe(1);
  });

  it("two concurrent recordings of the same quarter: exactly one wins, one filing, one audit", async () => {
    await cleanup();
    const q = new TestQueue();
    registerTdsConsumers(tenantScoped(q as any));
    const a = cmd({ id: randomUUID(), fy: "2026-27", quarter: "Q3", formType: "26Q", ackNo: "ACKAAAAAA", filedOn: "2027-01-20", dueDate: "2027-01-31" });
    const b = cmd({ id: randomUUID(), fy: "2026-27", quarter: "Q3", formType: "26Q", ackNo: "ACKBBBBBB", filedOn: "2027-01-21", dueDate: "2027-01-31" });
    await Promise.all([q.deliver(COMMANDS.tdsReturnFile, a), q.deliver(COMMANDS.tdsReturnFile, b)]);
    const rows = await filings();
    expect(rows).toHaveLength(1);
    expect(["ACKAAAAAA", "ACKBBBBBB"]).toContain(rows[0].ack_no);
    expect(await auditCount([a.correlationId, b.correlationId])).toBe(1);
  });
});

describe("TDS return filing routes", () => {
  it("GET lists the four quarters with deduction totals and the recorded filing", async () => {
    await cleanup();
    await seedDeduction("deposited");
    const q = new TestQueue();
    registerTdsConsumers(tenantScoped(q as any));
    await q.deliver(COMMANDS.tdsReturnFile, cmd({ id: randomUUID(), fy: "2026-27", quarter: "Q1", formType: "26Q", ackNo: "ACK123456", filedOn: "2026-07-20", dueDate: "2026-07-31" }));
    const app = await buildApp();
    try {
      const res = await app.inject({ method: "GET", url: "/v1/finance/tds-returns?fy=2026-27", headers: { authorization: `Bearer ${token(["audit_officer"])}` } });
      expect(res.statusCode).toBe(200);
      const data = res.json().data as any[];
      expect(data.map((d) => d.quarter)).toEqual(["Q1", "Q2", "Q3", "Q4"]);
      expect(data[0]).toMatchObject({ status: "filed", ackNo: "ACK123456", deductionCount: 1, totalTdsMinor: "2000" });
      expect(data[1]).toMatchObject({ ackNo: null, deductionCount: 0, totalTdsMinor: "0" });
      expect(["pending", "overdue"]).toContain(data[1].status);
    } finally { await app.close(); }
  });

  it("POST validates the ack number and date, forbids read-only roles, and 409s an already-filed quarter", async () => {
    await cleanup();
    const app = await buildApp();
    try {
      const post = (roles: string[], quarter: string, payload: unknown) =>
        app.inject({ method: "POST", url: `/v1/finance/tds-returns/2026-27/${quarter}/file`, headers: { authorization: `Bearer ${token(roles)}` }, payload: payload as any });
      expect((await post(["audit_officer"], "Q1", { ackNo: "ACK123456", filedOn: "2026-07-20" })).statusCode).toBe(403);
      expect((await post(["finance_officer"], "Q1", { ackNo: "no", filedOn: "2026-07-20" })).json().code).toBe("INVALID_ACK_NO");
      expect((await post(["finance_officer"], "Q1", { ackNo: "ACK123456", filedOn: "2026-06-30" })).json().code).toBe("FILED_BEFORE_QUARTER_END");
      expect((await post(["finance_officer"], "Q1", { ackNo: "ACK123456", filedOn: "2999-01-01" })).json().code).toBe("FILED_ON_IN_FUTURE");
      // A due-date override in the body is ignored: the statutory default is always recorded.
      const published: any[] = [];
      const spy = vi.spyOn(queue, "publish").mockImplementation(async (_t: any, m: any) => { published.push(m); });
      expect((await post(["finance_officer"], "Q1", { ackNo: "ACK123456", filedOn: "2026-07-20", dueDate: "2099-12-31" })).statusCode).toBe(202);
      expect(published[0].payload.dueDate).toBe("2026-07-31");
      spy.mockRestore();
      // Once the consumer has recorded it, a second recording is a 409.
      const q = new TestQueue();
      registerTdsConsumers(tenantScoped(q as any));
      await q.deliver(COMMANDS.tdsReturnFile, cmd({ id: randomUUID(), fy: "2026-27", quarter: "Q1", formType: "26Q", ackNo: "ACK123456", filedOn: "2026-07-20", dueDate: "2026-07-31" }));
      const again = await post(["finance_officer"], "Q1", { ackNo: "ACK999999", filedOn: "2026-07-21" });
      expect(again.statusCode).toBe(409);
      expect(again.json().code).toBe("ALREADY_FILED");
    } finally { await app.close(); }
  });
});
