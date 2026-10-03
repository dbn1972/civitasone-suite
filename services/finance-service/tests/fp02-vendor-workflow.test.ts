/**
 * GAP-FINANCE-VENDORS-01 / VENDORS-DETAIL-01 / VENDORS-DETAIL-04 / VENDORS-02 (fp-finance-02): vendor approval
 * (maker != checker, race-safe, bound to the reviewed version), audited PII reveal, masked reads everywhere
 * (including the PATCH/POST echo), the bank-change request workflow and the server-authoritative export.
 *
 * The decision routes only validate and publish (202); the same in-process queue runs the real consumers, and
 * `drain()` waits until every command has committed (or been dead-lettered).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { and, eq } from "drizzle-orm";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { scoped } from "./_tenant.js";
import { financeVendors, financeVendorBankChanges, financePolicy, financePolicyChanges } from "../src/modules/masters/schema.js";
import { encryptPii } from "../src/shared/pii-crypto.js";
import { bearer, auditRows, wipeOutbox, startConsumers, drain } from "./_fp02.js";

const T = "aaaaaaaa-0f02-4000-8000-000000000001";
const OTHER = "aaaaaaaa-0f02-4000-8000-000000000002";
const MAKER = "00000000-0f02-4000-8000-0000000000a1";
const CHECKER = "00000000-0f02-4000-8000-0000000000a2";
const CHECKER2 = "00000000-0f02-4000-8000-0000000000a3";
const OFFICER = "00000000-0f02-4000-8000-0000000000b1";
const AUDITOR = "00000000-0f02-4000-8000-0000000000c1";

const admin = (actor = MAKER, tenant = T) => bearer(tenant, actor, ["finance_admin"]);
const officer = () => bearer(T, OFFICER, ["finance_officer"]);
const auditor = () => bearer(T, AUDITOR, ["audit_officer"]);

let app: Awaited<ReturnType<typeof buildApp>>;
let n = 0;
const pan = () => `FPZZZ${String(1000 + ++n)}F`;
const row = async (id: string) => (await scoped(T, (tx) => tx.select().from(financeVendors).where(eq(financeVendors.id, id))))[0]!;

async function newVendor(by = MAKER): Promise<string> {
  const res = await app.inject({
    method: "POST", url: "/v1/finance/vendors", headers: admin(by),
    payload: {
      name: `FP02 Vendor ${n}`, category: "supplies", pan: pan(), address: "1 Test Road",
      phone: "9876543210", email: "asha.verma@vendor.example",
      bankName: "Test Bank", bankAccount: "123456789012", ifsc: "TEST0123456",
    },
  });
  expect(res.statusCode).toBe(201);
  return res.json().id as string;
}

/** POST a decision with the version the checker is looking at, then wait for the consumer. */
async function decide(id: string, action: "approve" | "reject", who: string, extra: Record<string, unknown> = {}, version?: number) {
  const v = version ?? (await row(id)).version;
  const res = await app.inject({ method: "POST", url: `/v1/finance/vendors/${id}/${action}`, headers: admin(who), payload: { version: v, ...extra } });
  await drain();
  return res;
}
async function approveVendor(id: string, who = CHECKER) {
  const res = await decide(id, "approve", who);
  expect(res.statusCode).toBe(202);
}

async function cleanup() {
  for (const t of [T, OTHER]) {
    await scoped(t, (tx) => tx.delete(financeVendorBankChanges).where(eq(financeVendorBankChanges.tenantId, t)));
    await scoped(t, (tx) => tx.delete(financeVendors).where(eq(financeVendors.tenantId, t)));
    await scoped(t, (tx) => tx.delete(financePolicyChanges).where(eq(financePolicyChanges.tenantId, t)));
    await scoped(t, (tx) => tx.delete(financePolicy).where(eq(financePolicy.tenantId, t)));
    await wipeOutbox(t);
  }
}

beforeAll(async () => { await cleanup(); app = await buildApp(); await startConsumers(); });
afterAll(async () => { await cleanup(); await app.close(); await sqlClient.end(); });

describe("vendor approval workflow (maker != checker)", () => {
  it("a new vendor starts pending under the default policy and cannot transact", async () => {
    const id = await newVendor();
    const r = await row(id);
    expect(r.status).toBe("pending");
    expect(r.isActive).toBe(false);
    const detail = await app.inject({ method: "GET", url: `/v1/finance/vendors/${id}`, headers: admin(CHECKER) });
    expect(detail.json().status).toBe("pending");
  });

  it("the creator cannot approve their own vendor (409 MAKER_CHECKER_VIOLATION); a different admin can, and it is audited once", async () => {
    const id = await newVendor();
    const self = await decide(id, "approve", MAKER);
    expect(self.statusCode).toBe(409);
    expect(self.json().code).toBe("MAKER_CHECKER_VIOLATION");
    expect((await row(id)).status).toBe("pending");
    const ok = await decide(id, "approve", CHECKER, { reason: "KYC verified" });
    expect(ok.statusCode).toBe(202);
    const r = await row(id);
    expect(r.status).toBe("active");
    expect(r.isActive).toBe(true);
    expect(r.approvedBy).toBe(CHECKER);
    expect(await auditRows(T, "vendor_approve", id)).toHaveLength(1);
  });

  it("the consumer is authoritative: a command that bypasses the route pre-check by the creator is still refused", async () => {
    const id = await newVendor();
    const { queue } = await import("../src/shared/infra.js");
    await queue.publish("finance.vendor.decide", {
      messageId: crypto.randomUUID(), type: "finance.vendor.decide", tenantId: T, actorId: MAKER, correlationId: "c", schemaVersion: "1.0",
      payload: { tenantId: T, id, decision: "approve", expectedVersion: (await row(id)).version },
    });
    await drain();
    expect((await row(id)).status).toBe("pending");
    expect(await auditRows(T, "vendor_approve", id)).toHaveLength(0);
  });

  it("two checkers approving at once: exactly one decision commits, one audit event, the second approve is refused", async () => {
    const id = await newVendor();
    const version = (await row(id)).version;
    const [a, b] = await Promise.all([
      app.inject({ method: "POST", url: `/v1/finance/vendors/${id}/approve`, headers: admin(CHECKER), payload: { version } }),
      app.inject({ method: "POST", url: `/v1/finance/vendors/${id}/approve`, headers: admin(CHECKER2), payload: { version } }),
    ]);
    // both are accepted unless the first consumer already committed before the second pre-check ran (then 409)
    const codes = [a.statusCode, b.statusCode];
    expect(codes).toContain(202);
    for (const c of codes) expect([202, 409]).toContain(c);
    await drain();
    expect((await row(id)).status).toBe("active");
    expect(await auditRows(T, "vendor_approve", id)).toHaveLength(1);
    const again = await decide(id, "approve", CHECKER2);
    expect(again.statusCode).toBe(409);
    expect(again.json().code).toBe("VENDOR_NOT_PENDING");
  });

  it("approve is bound to the version the checker reviewed: a vendor edited after the page loaded is refused", async () => {
    const id = await newVendor();
    const seen = (await row(id)).version;
    // the vendor is edited after the checker opened it (a PATCH bumps the version)
    const patch = await app.inject({ method: "PATCH", url: `/v1/finance/vendors/${id}`, headers: admin(MAKER), payload: { version: seen, address: "2 New Road" } });
    expect(patch.statusCode).toBe(200);
    const stale = await decide(id, "approve", CHECKER, {}, seen);
    expect(stale.statusCode).toBe(409);
    expect(stale.json().code).toBe("VERSION_CONFLICT");
    expect((await row(id)).status).toBe("pending");
    expect((await decide(id, "approve", CHECKER)).statusCode).toBe(202);
    expect((await row(id)).status).toBe("active");
  });

  it("a stale version that slips past the pre-check is refused by the consumer too", async () => {
    const id = await newVendor();
    const seen = (await row(id)).version;
    await app.inject({ method: "PATCH", url: `/v1/finance/vendors/${id}`, headers: admin(MAKER), payload: { version: seen, address: "3 New Road" } });
    const { queue } = await import("../src/shared/infra.js");
    await queue.publish("finance.vendor.decide", {
      messageId: crypto.randomUUID(), type: "finance.vendor.decide", tenantId: T, actorId: CHECKER, correlationId: "c", schemaVersion: "1.0",
      payload: { tenantId: T, id, decision: "approve", expectedVersion: seen },
    });
    await drain();
    expect((await row(id)).status).toBe("pending");
  });

  it("reject needs a reason and leaves the vendor unable to transact; activate/deactivate cannot bypass approval", async () => {
    const id = await newVendor();
    const noReason = await decide(id, "reject", CHECKER);
    expect(noReason.statusCode).toBe(400);
    const bypass = await app.inject({ method: "PATCH", url: `/v1/finance/vendors/${id}`, headers: admin(CHECKER), payload: { version: 1, isActive: true } });
    expect(bypass.statusCode).toBe(409);
    expect(bypass.json().code).toBe("VENDOR_NOT_APPROVED");
    const rej = await decide(id, "reject", CHECKER, { reason: "PAN mismatch" });
    expect(rej.statusCode).toBe(202);
    const r = await row(id);
    expect(r.status).toBe("rejected");
    expect(r.isActive).toBe(false);
  });

  it("deactivate / reactivate of an approved vendor keeps status and is_active in step", async () => {
    const id = await newVendor();
    await approveVendor(id);
    const v = await row(id);
    const off = await app.inject({ method: "PATCH", url: `/v1/finance/vendors/${id}`, headers: admin(CHECKER), payload: { version: v.version, isActive: false } });
    expect(off.statusCode).toBe(200);
    expect(off.json().status).toBe("inactive");
    const r = await row(id);
    expect(r.status).toBe("inactive");
    expect(r.isActive).toBe(false);
  });

  it("switching the approval check OFF is itself a two-person act; once approved a new vendor is active immediately", async () => {
    const put = await app.inject({ method: "PUT", url: "/v1/finance/policy", headers: admin(MAKER), payload: { vendorMakerChecker: false } });
    expect(put.statusCode).toBe(202);
    expect(put.json().data.requiresApproval).toBe(true);
    await drain();
    // nothing changed yet: a new vendor is still pending
    const stillPending = await newVendor();
    expect((await row(stillPending)).status).toBe("pending");
    const changeId = put.json().data.changeId as string;
    // the proposer cannot approve their own loosening
    const self = await app.inject({ method: "POST", url: `/v1/finance/policy/changes/${changeId}/approve`, headers: admin(MAKER), payload: {} });
    expect(self.statusCode).toBe(409);
    expect(self.json().code).toBe("MAKER_CHECKER_VIOLATION");
    const ok = await app.inject({ method: "POST", url: `/v1/finance/policy/changes/${changeId}/approve`, headers: admin(CHECKER), payload: {} });
    expect(ok.statusCode).toBe(202);
    await drain();
    const id = await newVendor();
    const r = await row(id);
    expect(r.status).toBe("active");
    expect(r.isActive).toBe(true);
    expect((await auditRows(T, "policy_change_approve")).length).toBeGreaterThan(0);
    // enabling it again is a tightening: immediate, no second admin
    const on = await app.inject({ method: "PUT", url: "/v1/finance/policy", headers: admin(MAKER), payload: { vendorMakerChecker: true } });
    expect(on.json().data.requiresApproval).toBe(false);
    await drain();
    expect((await row(await newVendor())).status).toBe("pending");
  });

  it("approving a vendor from another tenant is a 404", async () => {
    const id = await newVendor();
    const res = await app.inject({ method: "POST", url: `/v1/finance/vendors/${id}/approve`, headers: admin(CHECKER, OTHER), payload: { version: 1 } });
    expect(res.statusCode).toBe(404);
  });
});

describe("masked reads and audited reveal", () => {
  it("GET detail never carries the clear PAN, account, phone or email", async () => {
    const id = await newVendor();
    const res = await app.inject({ method: "GET", url: `/v1/finance/vendors/${id}`, headers: admin(CHECKER) });
    const body = res.json();
    expect(body.pan).toMatch(/^FPZZZ\*\*\*\*F$/);
    expect(body.bankAccount).toBe("********9012");
    expect(body.phone).toBe("******3210");
    expect(body.email).toBe("a***@vendor.example");
    expect(JSON.stringify(body)).not.toContain("123456789012");
    expect(JSON.stringify(body)).not.toContain("9876543210");
  });

  it("a name-only PATCH (and the POST echo) never returns the clear PAN, account, phone or email", async () => {
    const id = await newVendor();
    const v = await row(id);
    const patch = await app.inject({ method: "PATCH", url: `/v1/finance/vendors/${id}`, headers: admin(MAKER), payload: { version: v.version, name: "Renamed Vendor" } });
    expect(patch.statusCode).toBe(200);
    const text = JSON.stringify(patch.json());
    expect(text).not.toContain(v.pan);
    expect(text).not.toContain("123456789012");
    expect(text).not.toContain("9876543210");
    expect(text).not.toContain("asha.verma@vendor.example");
    expect(patch.json().pan).toMatch(/^FPZZZ\*\*\*\*F$/);
    expect(patch.json().bankAccount).toBe("********9012");
    const created = await app.inject({
      method: "POST", url: "/v1/finance/vendors", headers: admin(MAKER),
      payload: { name: "Echo Vendor", category: "supplies", pan: pan(), address: "1 Road", phone: "9876543211", email: "b.rao@vendor.example", bankName: "Bank", bankAccount: "555566667777", ifsc: "TEST0123456" },
    });
    expect(created.statusCode).toBe(201);
    const echo = JSON.stringify(created.json());
    for (const clear of ["555566667777", "9876543211", "b.rao@vendor.example"]) expect(echo).not.toContain(clear);
  });

  it("the list masks PAN too", async () => {
    await newVendor();
    const res = await app.inject({ method: "GET", url: "/v1/finance/vendors", headers: admin(CHECKER) });
    for (const v of res.json().data as Array<{ pan: string }>) expect(v.pan).toMatch(/^[A-Z]{5}\*\*\*\*[A-Z]$/);
  });

  it("reveal returns the clear values, needs a reason, is role-gated, and the audit event holds no values", async () => {
    const id = await newVendor();
    const noReason = await app.inject({ method: "POST", url: `/v1/finance/vendors/${id}/reveal`, headers: officer(), payload: { fields: ["pan"] } });
    expect(noReason.statusCode).toBe(400);
    const denied = await app.inject({ method: "POST", url: `/v1/finance/vendors/${id}/reveal`, headers: auditor(), payload: { fields: ["pan"], reason: "curiosity about this" } });
    expect(denied.statusCode).toBe(403);
    expect(await auditRows(T, "pii_reveal", id)).toHaveLength(0);

    const ok = await app.inject({ method: "POST", url: `/v1/finance/vendors/${id}/reveal`, headers: officer(), payload: { fields: ["pan", "bankAccount"], reason: "Preparing TDS challan" } });
    expect(ok.statusCode).toBe(200);
    expect(ok.headers["cache-control"]).toBe("no-store");
    expect(ok.json().values.bankAccount).toBe("123456789012");
    expect(ok.json().values.pan).toMatch(/^FPZZZ\d{4}F$/);
    const rows = await auditRows(T, "pii_reveal", id);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.actorId).toBe(OFFICER);
    const payload = JSON.stringify(rows[0]!.payload);
    expect(payload).toContain("Preparing TDS challan");
    expect(payload).not.toContain("123456789012");
  });
});

describe("bank-detail change request (maker != checker)", () => {
  async function activeVendor(): Promise<string> {
    const id = await newVendor();
    await approveVendor(id);
    return id;
  }
  const change = { bankName: "New Bank", bankAccount: "998877665544", ifsc: "NEWB0654321", reason: "Vendor moved banks (letter 12/09)" };
  const propose = async (id: string, who = MAKER) => {
    const res = await app.inject({ method: "POST", url: `/v1/finance/vendors/${id}/bank-change`, headers: admin(who), payload: change });
    await drain();
    return res;
  };
  const pendingId = async (id: string) => {
    const d = await app.inject({ method: "GET", url: `/v1/finance/vendors/${id}`, headers: admin(CHECKER) });
    return d.json().pendingBankChange as { id: string; proposedBy: string; accountMasked: string } | null;
  };
  const decideChange = async (id: string, changeId: string, action: "approve" | "reject", who: string, payload: object = {}) => {
    const res = await app.inject({ method: "POST", url: `/v1/finance/vendors/${id}/bank-change/${changeId}/${action}`, headers: admin(who), payload });
    await drain();
    return res;
  };

  it("PATCH cannot change bank details while maker-checker is on", async () => {
    const id = await activeVendor();
    const v = await row(id);
    const res = await app.inject({ method: "PATCH", url: `/v1/finance/vendors/${id}`, headers: admin(MAKER), payload: { version: v.version, bankAccount: "111122223333" } });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("BANK_CHANGE_REQUIRES_APPROVAL");
  });

  it("the proposer cannot approve; a different admin approves and the live bank details change", async () => {
    const id = await activeVendor();
    const prop = await propose(id);
    expect(prop.statusCode).toBe(202);
    const pending = (await pendingId(id))!;
    expect(pending).toMatchObject({ proposedBy: MAKER, accountMasked: "********5544" });
    const detail = await app.inject({ method: "GET", url: `/v1/finance/vendors/${id}`, headers: admin(CHECKER) });
    expect(JSON.stringify(detail.json())).not.toContain("998877665544");

    const dup = await propose(id, CHECKER);
    expect(dup.statusCode).toBe(409);
    expect(dup.json().code).toBe("BANK_CHANGE_PENDING");

    const self = await decideChange(id, pending.id, "approve", MAKER);
    expect(self.statusCode).toBe(409);
    expect(self.json().code).toBe("MAKER_CHECKER_VIOLATION");
    expect((await row(id)).bankAccountNo).toBe("123456789012");

    const ok = await decideChange(id, pending.id, "approve", CHECKER);
    expect(ok.statusCode).toBe(202);
    const r = await row(id);
    expect(r.bankAccountNo).toBe("998877665544");
    expect(r.bankName).toBe("New Bank");
    expect(await auditRows(T, "bank_change_approve", id)).toHaveLength(1);

    const replay = await decideChange(id, pending.id, "approve", CHECKER2);
    expect(replay.statusCode).toBe(404); // no longer pending
  });

  it("the account number is not carried in clear on the queue", async () => {
    const id = await activeVendor();
    const { queue } = await import("../src/shared/infra.js");
    const seen: string[] = [];
    const orig = queue.publish.bind(queue);
    (queue as unknown as { publish: unknown }).publish = async (topic: string, msg: unknown) => { seen.push(JSON.stringify(msg)); return orig(topic, msg as never); };
    try { await propose(id); } finally { (queue as unknown as { publish: unknown }).publish = orig; }
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.join("")).not.toContain("998877665544");
  });

  it("two proposals racing past the route pre-check: one request, the loser is a 409 dead-letter (not a retry loop)", async () => {
    const id = await activeVendor();
    const { queue } = await import("../src/shared/infra.js");
    const q = queue as unknown as { dlq: Array<{ topic: string; error: string }> };
    const dlqBefore = q.dlq.length;
    const publish = (actor: string) => queue.publish("finance.vendor.bank_change_propose", {
      messageId: crypto.randomUUID(), type: "finance.vendor.bank_change_propose", tenantId: T, actorId: actor, correlationId: "c", schemaVersion: "1.0",
      payload: { tenantId: T, changeId: crypto.randomUUID(), vendorId: id, bankName: "New Bank", bankAccountEnc: encryptPii("998877665544"), ifsc: "NEWB0654321", reason: "Vendor moved banks (letter 12/09)" },
    });
    await Promise.all([publish(MAKER), publish(CHECKER)]);
    await drain();
    const rows = await scoped(T, (tx) => tx.select().from(financeVendorBankChanges).where(and(eq(financeVendorBankChanges.vendorId, id), eq(financeVendorBankChanges.status, "pending"))));
    expect(rows).toHaveLength(1);
    expect(await auditRows(T, "bank_change_propose", id)).toHaveLength(1);
    const added = q.dlq.slice(dlqBefore).filter((d) => d.topic === "finance.vendor.bank_change_propose");
    expect(added).toHaveLength(1);
    expect(added[0]!.error).toContain("BANK_CHANGE_PENDING");
  });

  it("the vendor's status is re-checked inside the applying transaction: a change is not applied to a vendor that is no longer approved", async () => {
    const id = await activeVendor();
    await propose(id);
    const pending = (await pendingId(id))!;
    // the vendor leaves the approved state between the proposal and the checker's click
    await scoped(T, (tx) => tx.update(financeVendors).set({ status: "rejected", isActive: false }).where(eq(financeVendors.id, id)));
    const res = await decideChange(id, pending.id, "approve", CHECKER);
    expect(res.statusCode).toBe(202); // the pre-check cannot see it; the consumer is authoritative
    const r = await row(id);
    expect(r.bankAccountNo).toBe("123456789012");
    expect(r.bankName).not.toBe("New Bank");
    const change = (await scoped(T, (tx) => tx.select().from(financeVendorBankChanges).where(eq(financeVendorBankChanges.id, pending.id))))[0]!;
    expect(change.status).toBe("pending");
    expect(await auditRows(T, "bank_change_approve", id)).toHaveLength(0);
  });

  it("a rejected change leaves the bank details untouched and frees the vendor for a new proposal", async () => {
    const id = await activeVendor();
    await propose(id);
    const pending = (await pendingId(id))!;
    const rej = await decideChange(id, pending.id, "reject", CHECKER, { reason: "Letter not on letterhead" });
    expect(rej.statusCode).toBe(202);
    expect((await row(id)).bankAccountNo).toBe("123456789012");
    expect((await propose(id, MAKER)).statusCode).toBe(202);
  });

  it("two checkers deciding the same request at once: exactly one wins", async () => {
    const id = await activeVendor();
    await propose(id);
    const pending = (await pendingId(id))!;
    const [a, b] = await Promise.all([
      app.inject({ method: "POST", url: `/v1/finance/vendors/${id}/bank-change/${pending.id}/approve`, headers: admin(CHECKER), payload: {} }),
      app.inject({ method: "POST", url: `/v1/finance/vendors/${id}/bank-change/${pending.id}/approve`, headers: admin(CHECKER2), payload: {} }),
    ]);
    const codes = [a.statusCode, b.statusCode];
    expect(codes).toContain(202);
    for (const c of codes) expect([202, 404, 409]).toContain(c); // the loser may already see it decided
    await drain();
    const rows = await scoped(T, (tx) => tx.select().from(financeVendorBankChanges).where(and(eq(financeVendorBankChanges.vendorId, id), eq(financeVendorBankChanges.status, "approved"))));
    expect(rows).toHaveLength(1);
    expect(await auditRows(T, "bank_change_approve", id)).toHaveLength(1);
  });
});

describe("server-authoritative vendor register export", () => {
  it("audits first, returns CSV built from MASKED data, role-gated", async () => {
    await newVendor();
    const ok = await app.inject({ method: "POST", url: "/v1/finance/vendors/export", headers: officer(), payload: {} });
    expect(ok.statusCode).toBe(200);
    expect(ok.headers["cache-control"]).toBe("no-store");
    const { csv, rowCount } = ok.json() as { csv: string; rowCount: number };
    expect(csv.split("\n")[0]).toBe("Vendor Name,PAN,GSTIN,Category,Status");
    expect(rowCount).toBeGreaterThan(0);
    expect(csv).toMatch(/FPZZZ\*\*\*\*F/);
    expect(csv).not.toMatch(/FPZZZ\d{4}F/);
    const rows = await auditRows(T, "export");
    expect(rows.some((r) => r.actorId === OFFICER && (r.payload as { details?: { rowCount?: number } }).details?.rowCount === rowCount)).toBe(true);
    const denied = await app.inject({ method: "POST", url: "/v1/finance/vendors/export", headers: auditor(), payload: {} });
    expect(denied.statusCode).toBe(403);
  });
});
