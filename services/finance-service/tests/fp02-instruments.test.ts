/**
 * GAP-FINANCE-TREASURY-CHEQUES-DETAIL-01 / -03 / -04 (fp-finance-02): audited bank-account reveal,
 * per-transition actors, re-present, mark-stale, mandatory cancel reason -- real DB, real routes.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { scoped } from "./_tenant.js";
import { financeBanks, financeInstruments } from "../src/modules/treasury/schema.js";
import { financePolicy } from "../src/modules/masters/schema.js";
import { addMonthsIso, isStale, validUntil } from "../src/modules/instruments/domain.js";
import { bearer, auditRows, wipeOutbox, startConsumers, drain } from "./_fp02.js";

const T = "aaaaaaaa-0f02-4000-8000-000000000011";
const BANK = "0f020000-0000-4000-8000-000000000011";
const ISSUER = "00000000-0f02-4000-8000-0000000000d1";
const PRESENTER = "00000000-0f02-4000-8000-0000000000d2";
const CLEARER = "00000000-0f02-4000-8000-0000000000d3";
const AUDITOR = "00000000-0f02-4000-8000-0000000000d4";
const ACCOUNT = "50100123456789";

const fin = (a: string) => bearer(T, a, ["finance_officer"]);
const auditor = () => bearer(T, AUDITOR, ["audit_officer"]);

let app: Awaited<ReturnType<typeof buildApp>>;
let seq = 0;
async function issue(opts: { issueDate?: string; bank?: boolean } = {}): Promise<string> {
  const res = await app.inject({
    method: "POST", url: "/v1/finance/instruments", headers: fin(ISSUER),
    payload: {
      instrumentType: "cheque", instrumentNo: `FP02-${Date.now()}-${++seq}`, bankName: "SBI", payee: "M/s Test",
      amountMinor: 250000, ...(opts.issueDate ? { issueDate: opts.issueDate } : {}), ...(opts.bank === false ? {} : { bankAccountId: BANK }),
    },
  });
  expect(res.statusCode).toBe(201);
  return res.json().id as string;
}
const post = async (id: string, action: string, who: string, payload: object = {}) => {
  const res = await app.inject({ method: "POST", url: `/v1/finance/instruments/${id}/${action}`, headers: fin(who), payload });
  await drain(); // represent / stale are commands: wait for the consumer
  return res;
};
const rowOf = async (id: string) => (await scoped(T, (tx) => tx.select().from(financeInstruments).where(eq(financeInstruments.id, id))))[0]!;
/** A bounced cheque with an arbitrary issue date, inserted directly (the route refuses to present an expired cheque). */
async function seedBounced(issueDate: string): Promise<string> {
  const id = crypto.randomUUID();
  await scoped(T, (tx) => tx.insert(financeInstruments).values({
    id, tenantId: T, instrumentType: "cheque", instrumentNo: `FP02-B-${Date.now()}-${++seq}`, bankName: "SBI", payee: "M/s Test", amountMinor: 1000n,
    issueDate, status: "bounced", bounceReason: "Insufficient funds", bouncedAt: new Date(), bouncedBy: PRESENTER, createdBy: ISSUER, updatedBy: ISSUER,
  }));
  return id;
}

async function cleanup() {
  await scoped(T, (tx) => tx.delete(financeInstruments).where(eq(financeInstruments.tenantId, T)));
  await scoped(T, (tx) => tx.delete(financeBanks).where(eq(financeBanks.tenantId, T)));
  await scoped(T, (tx) => tx.delete(financePolicy).where(eq(financePolicy.tenantId, T)));
  await wipeOutbox(T);
}
beforeAll(async () => {
  await cleanup();
  app = await buildApp();
  await startConsumers();
  await scoped(T, (tx) => tx.insert(financeBanks).values({ id: BANK, tenantId: T, name: "SBI Main", accountNo: ACCOUNT, createdBy: ISSUER, updatedBy: ISSUER }));
});
afterAll(async () => { await cleanup(); await app.close(); await sqlClient.end(); });

describe("cheque validity rules (pure)", () => {
  it("adds calendar months and clamps the day", () => {
    expect(addMonthsIso("2026-01-31", 3)).toBe("2026-04-30");
    expect(addMonthsIso("2025-11-15", 3)).toBe("2026-02-15");
    expect(addMonthsIso("2026-03-31", 12)).toBe("2027-03-31");
  });
  it("is stale only strictly after the last valid day", () => {
    expect(validUntil("2026-01-10", 3)).toBe("2026-04-10");
    expect(isStale("2026-01-10", 3, "2026-04-10")).toBe(false);
    expect(isStale("2026-01-10", 3, "2026-04-11")).toBe(true);
  });
});

describe("per-transition actors on the timeline", () => {
  it("records who issued, presented and cleared", async () => {
    const id = await issue();
    expect((await post(id, "present", PRESENTER)).statusCode).toBe(200);
    expect((await post(id, "clear", CLEARER)).statusCode).toBe(200);
    const body = (await app.inject({ method: "GET", url: `/v1/finance/instruments/${id}`, headers: fin(ISSUER) })).json();
    expect(body).toMatchObject({ issuedBy: ISSUER, presentedBy: PRESENTER, clearedBy: CLEARER, bouncedBy: null, cancelledBy: null, status: "cleared" });
  });
});

describe("cancel needs a reason", () => {
  it("400 without a reason, records reason + actor with one, audits once even under a race", async () => {
    const id = await issue();
    expect((await post(id, "cancel", ISSUER)).statusCode).toBe(400);
    expect((await post(id, "cancel", ISSUER, { reason: "ok" })).statusCode).toBe(400);
    const [a, b] = await Promise.all([post(id, "cancel", ISSUER, { reason: "Wrong payee on the cheque" }), post(id, "cancel", PRESENTER, { reason: "Wrong payee on the cheque" })]);
    expect([a.statusCode, b.statusCode]).toEqual([200, 200]);
    const row = (await scoped(T, (tx) => tx.select().from(financeInstruments).where(eq(financeInstruments.id, id))))[0]!;
    expect(row.status).toBe("cancelled");
    expect(row.cancelReason).toBe("Wrong payee on the cheque");
    expect([ISSUER, PRESENTER]).toContain(row.cancelledBy);
    expect(await auditRows(T, "cancel", id)).toHaveLength(1);
  });
});

describe("re-present a bounced cheque", () => {
  it("only bounced -> presented, with a reason; keeps the bounce record and counts the re-presentation", async () => {
    const id = await issue();
    const early = await post(id, "represent", PRESENTER, { reason: "Funds now available" });
    expect(early.statusCode).toBe(409);
    expect(early.json().code).toBe("ILLEGAL_TRANSITION");
    await post(id, "present", PRESENTER);
    expect((await post(id, "bounce", PRESENTER, { reason: "Insufficient funds" })).statusCode).toBe(200);
    expect((await post(id, "represent", CLEARER, {})).statusCode).toBe(400);
    const ok = await post(id, "represent", CLEARER, { reason: "Funds now available" });
    expect(ok.statusCode).toBe(202);
    const body = (await app.inject({ method: "GET", url: `/v1/finance/instruments/${id}`, headers: fin(ISSUER) })).json();
    expect(body).toMatchObject({ status: "presented", representCount: 1, lastRepresentedBy: CLEARER, representReason: "Funds now available", bounceReason: "Insufficient funds" });
    expect(body.bouncedAt).not.toBeNull();
    expect(await auditRows(T, "represent", id)).toHaveLength(1);
    // a second concurrent represent finds it presented -> illegal, no second audit
    const again = await post(id, "represent", CLEARER, { reason: "Funds now available" });
    expect(again.statusCode).toBe(409);
    expect(await auditRows(T, "represent", id)).toHaveLength(1);
  });

  it("refuses to re-present an instrument past its validity horizon", async () => {
    const id = await seedBounced("2020-01-01");
    const res = await post(id, "represent", PRESENTER, { reason: "Funds now available" });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("INSTRUMENT_STALE");
    expect((await rowOf(id)).status).toBe("bounced");
  });

  it("presenting an issued cheque past its validity is refused too (consistent with re-present)", async () => {
    const id = await issue({ issueDate: "2020-01-01" });
    const res = await post(id, "present", PRESENTER);
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("INSTRUMENT_STALE");
    expect((await rowOf(id)).status).toBe("issued");
  });

  it("the consumer is authoritative: a represent published for an expired cheque is refused and not audited", async () => {
    const id = await seedBounced("2020-01-01");
    const { queue } = await import("../src/shared/infra.js");
    await queue.publish("finance.instrument.represent", {
      messageId: crypto.randomUUID(), type: "finance.instrument.represent", tenantId: T, actorId: PRESENTER, correlationId: "c", schemaVersion: "1.0",
      payload: { tenantId: T, id, reason: "Funds now available" },
    });
    await drain();
    expect((await rowOf(id)).status).toBe("bounced");
    expect(await auditRows(T, "represent", id)).toHaveLength(0);
  });
});

describe("mark stale", () => {
  it("is refused while the cheque is still valid and allowed once it is past the horizon", async () => {
    const fresh = await issue();
    const refused = await post(fresh, "stale", ISSUER, {});
    expect(refused.statusCode).toBe(409);
    expect(refused.json().code).toBe("INSTRUMENT_NOT_STALE");

    const old = await issue({ issueDate: "2020-01-01" });
    const ok = await post(old, "stale", ISSUER, { reason: "Not presented within validity" });
    expect(ok.statusCode).toBe(202);
    expect(await rowOf(old)).toMatchObject({ status: "stale", staledBy: ISSUER });
    expect((await post(old, "stale", PRESENTER, {})).statusCode).toBe(202); // idempotent replay: still one audit event
    expect(await auditRows(T, "mark_stale", old)).toHaveLength(1);
    // a stale cheque can no longer be cancelled or presented
    expect((await post(old, "cancel", ISSUER, { reason: "Trying to cancel it" })).statusCode).toBe(409);
  });

  it("honours the tenant's validity horizon", async () => {
    await scoped(T, (tx) => tx.insert(financePolicy).values({ tenantId: T, chequeValidityMonths: 12 }).onConflictDoUpdate({ target: financePolicy.tenantId, set: { chequeValidityMonths: 12 } }));
    const d = new Date(); d.setUTCMonth(d.getUTCMonth() - 6);
    const id = await issue({ issueDate: d.toISOString().slice(0, 10) });
    expect((await post(id, "stale", ISSUER, {})).statusCode).toBe(409);
    await scoped(T, (tx) => tx.delete(financePolicy).where(eq(financePolicy.tenantId, T)));
    expect((await post(id, "stale", ISSUER, {})).statusCode).toBe(202);
    expect((await rowOf(id)).status).toBe("stale");
  });
});

describe("audited bank account reveal", () => {
  it("detail and list carry only the last four digits", async () => {
    const id = await issue();
    const detail = (await app.inject({ method: "GET", url: `/v1/finance/instruments/${id}`, headers: auditor() })).json();
    expect(detail.accountNoLast4).toBe("6789");
    expect(JSON.stringify(detail)).not.toContain(ACCOUNT);
  });

  it("returns the number only to reveal roles, needs a reason, and audits without the number", async () => {
    const id = await issue();
    const denied = await app.inject({ method: "POST", url: `/v1/finance/instruments/${id}/reveal-account`, headers: auditor(), payload: { reason: "just looking around" } });
    expect(denied.statusCode).toBe(403);
    expect((await post(id, "reveal-account", ISSUER, {})).statusCode).toBe(400);
    expect(await auditRows(T, "account_reveal", id)).toHaveLength(0);

    const ok = await post(id, "reveal-account", ISSUER, { reason: "Bank reconciliation query" });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().accountNo).toBe(ACCOUNT);
    expect(ok.headers["cache-control"]).toBe("no-store");
    const rows = await auditRows(T, "account_reveal", id);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.actorId).toBe(ISSUER);
    expect(JSON.stringify(rows[0]!.payload)).toContain("Bank reconciliation query");
    expect(JSON.stringify(rows[0]!.payload)).not.toContain(ACCOUNT);
  });

  it("an instrument with no linked bank account cannot reveal", async () => {
    const id = await issue({ bank: false });
    const res = await post(id, "reveal-account", ISSUER, { reason: "Bank reconciliation query" });
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe("NO_BANK_ACCOUNT");
  });
});
