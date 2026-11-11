/**
 * Configurable reimbursement receipt policy, end to end against a REAL Postgres
 * (migrated through 0169, run as the NOBYPASSRLS payroll_svc role), through
 * buildApp() and the real consumers. Requires DATABASE_URL pointing at a
 * disposable, migrated instance (see vitest.config.ts REL-035).
 */
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import { withTenantScope } from "@civitasone/db";

const EMPLOYEE_BY_ACTOR = new Map<string, string>();
const UPLOADED = new Map<string, { contentLength: number; contentType: string }>();
const upload = (key: string) => UPLOADED.set(key, { contentLength: 2048, contentType: "application/pdf" });

vi.mock("../src/shared/hrms-client.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/shared/hrms-client.js")>()),
  fetchEmployeeSummaries: vi.fn(async () => new Map()),
  fetchPayrollReadiness: vi.fn(async () => new Map()),
  verifyEmployeeExists: vi.fn(async () => true),
  resolveActorEmployeeId: vi.fn(async (_tenant: string, actor: string) => EMPLOYEE_BY_ACTOR.get(actor) ?? null),
}));
vi.mock("@civitasone/storage", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@civitasone/storage")>()),
  presignedPutUrl: vi.fn(async ({ key }: { key: string }) => `https://bucket.example/put/${key}?sig=1`),
  presignedGetUrl: vi.fn(async ({ key }: { key: string }) => `https://bucket.example/get/${key}?sig=2`),
  headObject: vi.fn(async (key: string) => UPLOADED.get(key) ?? null),
}));

import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { registerPayrollConsumers } from "../src/modules/payroll/consumer.js";
import { registerReceiptPolicyConsumers } from "../src/modules/reimbursement-receipt-policy/consumer.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = randomUUID();
const OTHER_TENANT = randomUUID();
const ADMIN = randomUUID();
const OFFICER = randomUUID();
const EMP_USER = randomUUID();
const EMP_ID = randomUUID();
const URL = "/v1/payroll/reimbursement-receipt-policy";
const REASON = "Audit committee resolved receipts above Rs 5,000";

let app: Awaited<ReturnType<typeof buildApp>>;
type Row = Record<string, unknown>;
const auth = (sub: string, roles: string[], tenant = TENANT) => ({ authorization: `Bearer ${signToken({ sub, tid: tenant, roles, sid: "rrp" }, SECRET)}` });
const q = (text: ReturnType<typeof sql>, tenant = TENANT): Promise<Row[]> =>
  withTenantScope(db as never, tenant, async (tx: { execute: (x: unknown) => Promise<unknown> }) => Array.from((await tx.execute(text)) as Iterable<Row>));
async function until<T>(fn: () => Promise<T>, pred: (v: T) => boolean, ms = 4000): Promise<T> {
  const end = Date.now() + ms;
  let v = await fn();
  while (!pred(v) && Date.now() < end) { await new Promise((r) => setTimeout(r, 50)); v = await fn(); }
  return v;
}
const settle = () => new Promise((r) => setTimeout(r, 300));
const auditsFor = (resourceId: string, action: string) => q(sql`
  SELECT actor_id, payload FROM _outbox.messages
   WHERE topic = 'audit.event.record' AND payload->>'resourceId' = ${resourceId} AND payload->>'action' = ${action}
   ORDER BY created_at`);

const claim = (over: Record<string, unknown> = {}) => ({
  employeeId: EMP_ID, category: "food", amountMinor: 100000, period: "2026-08", billRef: `R-${randomUUID().slice(0, 8)}`, ...over,
});
const post = (payload: Record<string, unknown>, roles = ["employee"], sub = EMP_USER) =>
  app.inject({ method: "POST", url: "/v1/payroll/reimbursements", headers: auth(sub, roles), payload });
const put = (categories: Record<string, unknown>, sub = ADMIN, roles = ["payroll_admin"], extra: Record<string, unknown> = { reason: REASON }) =>
  app.inject({ method: "PUT", url: URL, headers: auth(sub, roles), payload: { categories, ...extra } });
const stored = async (id: string) => (await until(() => q(sql`SELECT * FROM payroll.payroll_reimbursements WHERE id = ${id}::uuid`), (r) => r.length > 0))[0]!;
const code = (res: { json: () => unknown }) => (res.json() as { code: string }).code;
const receipt = async (): Promise<string> => {
  const presign = await app.inject({ method: "POST", url: "/v1/payroll/reimbursements/attachments/presign", headers: auth(EMP_USER, ["employee"]), payload: { filename: "bill.pdf", contentType: "application/pdf", sizeBytes: 100 } });
  const key = (presign.json() as { storageKey: string }).storageKey;
  upload(key);
  return key;
};

beforeAll(async () => {
  registerPayrollConsumers(queue);
  registerReceiptPolicyConsumers(queue);
  await (queue as unknown as { start?: () => Promise<void> }).start?.();
  app = await buildApp();
  EMPLOYEE_BY_ACTOR.set(EMP_USER, EMP_ID);
});
afterAll(async () => { await app?.close(); await sqlClient.end(); });

describe("receipt policy: default parity (no policy saved)", () => {
  it("GET reports the built-in default; medical/lta/travel are refused without a receipt, other kinds are accepted", async () => {
    const res = await app.inject({ method: "GET", url: URL, headers: auth(EMP_USER, ["employee"]) });
    expect(res.statusCode).toBe(200);
    const b = res.json() as { isDefault: boolean; categories: Record<string, { mode: string }> };
    expect(b.isDefault).toBe(true);
    expect(Object.fromEntries(Object.entries(b.categories).map(([k, v]) => [k, v.mode]))).toEqual({
      medical: "always", travel: "always", lta: "always", food: "never", telephone: "never", internet: "never", fuel: "never", other: "never",
    });
    for (const category of ["medical", "lta", "travel"]) {
      const r = await post(claim({ category }));
      expect(r.statusCode, category).toBe(422);
      expect(code(r)).toBe("RECEIPT_REQUIRED");
      expect((r.json() as { message: string }).message).toContain(`a ${category} claim needs at least one receipt`);
      expect((r.json() as { message: string }).message).toContain("rule:");
    }
    for (const category of ["food", "telephone", "internet", "fuel", "other"]) {
      const r = await post(claim({ category }));
      expect(r.statusCode, category).toBe(202);
      expect((await stored((r.json() as { id: string }).id)).receipt_basis).toBe("not_required");
    }
    // a self-declaration has no effect under the default
    expect((await post(claim({ category: "medical", selfDeclaration: true }))).statusCode).toBe(422);
  });

  it("a medical claim with a receipt is stored as receipt-backed and the list exposes receipt_basis", async () => {
    const key = await receipt();
    const r = await post(claim({ category: "medical", attachmentKeys: [key] }));
    expect(r.statusCode).toBe(202);
    const id = (r.json() as { id: string }).id;
    expect((await stored(id)).receipt_basis).toBe("receipt");
    const list = await app.inject({ method: "GET", url: "/v1/payroll/reimbursements", headers: auth(OFFICER, ["payroll_officer"]) });
    const row = (list.json() as { data: Row[] }).data.find((x) => x.id === id)!;
    expect(row).toMatchObject({ receipt_basis: "receipt", attachment_count: 1 });
  });
});

describe("receipt policy: who may change it", () => {
  it("only payroll_admin / super_admin can PUT; others get 403 and nothing is queued", async () => {
    const body = { food: { mode: "always" } };
    for (const roles of [["payroll_officer"], ["hr_admin"], ["employee"], ["finance_officer"]]) {
      expect((await put(body, OFFICER, roles)).statusCode, roles.join()).toBe(403);
    }
    await settle();
    const g = await app.inject({ method: "GET", url: URL, headers: auth(ADMIN, ["payroll_admin"]) });
    expect((g.json() as { isDefault: boolean }).isDefault).toBe(true);
    // read is open to claim filers and payroll staff, not to unrelated roles
    expect((await app.inject({ method: "GET", url: URL, headers: auth(OFFICER, ["finance_officer"]) })).statusCode).toBe(403);
    expect((await app.inject({ method: "GET", url: URL, headers: auth(OFFICER, ["payroll_officer"]) })).statusCode).toBe(200);
  });

  it("rejects an incoherent policy with 422 and a malformed one with 400", async () => {
    const a = await put({ food: { mode: "above_amount" } });
    expect(a.statusCode).toBe(422);
    expect(code(a)).toBe("RECEIPT_POLICY_INVALID");
    expect(a.json()).toMatchObject({ message: expect.stringContaining("thresholdMinor") });
    expect((await put({ food: { mode: "sometimes" } })).statusCode).toBe(400);
    expect((await put({ spaceship: { mode: "always" } })).statusCode).toBe(400);
    expect((await put({ food: { mode: "always" } }, ADMIN, ["payroll_admin"], { reason: "short" })).statusCode).toBe(400);
  });
});

describe("receipt policy: modes, thresholds, self-declaration, audit", () => {
  it("saving the policy is audited with before (null) / after / reason, and GET reflects it", async () => {
    const res = await put({
      food: { mode: "always" },
      medical: { mode: "never" },
      travel: { mode: "above_amount", thresholdMinor: 500000 },
      lta: { mode: "always", selfDeclarationUpToMinor: 200000 },
    });
    expect(res.statusCode).toBe(202);
    const id = (res.json() as { id: string }).id;
    const g = await until(() => app.inject({ method: "GET", url: URL, headers: auth(ADMIN, ["payroll_admin"]) }), (r) => (r.json() as { isDefault: boolean }).isDefault === false);
    const b = g.json() as { categories: Record<string, Record<string, unknown>> };
    expect(b.categories.travel).toMatchObject({ mode: "above_amount", thresholdMinor: 500000 });
    expect(b.categories.lta).toMatchObject({ mode: "always", selfDeclarationUpToMinor: 200000 });
    expect(b.categories.fuel).toMatchObject({ mode: "never" }); // untouched category keeps its default
    const audit = await until(() => auditsFor(TENANT, "reimbursement_receipt_policy_updated"), (a) => a.length > 0);
    expect(audit[0]!.actor_id).toBe(ADMIN);
    const detail = (audit[0]!.payload as { detail: { before: unknown; after: { categories: Record<string, unknown> }; reason: string } }).detail;
    expect(detail.before).toBeNull();
    expect(detail.after.categories.travel).toMatchObject({ mode: "above_amount", thresholdMinor: 500000 });
    expect(detail.reason).toBe(REASON);
    expect(id).toBeTruthy();
  });

  it("always overrides the default (food) and never overrides it (medical)", async () => {
    const f = await post(claim({ category: "food" }));
    expect(f.statusCode).toBe(422);
    expect(code(f)).toBe("RECEIPT_REQUIRED");
    expect((await post(claim({ category: "food", attachmentKeys: [await receipt()] }))).statusCode).toBe(202);
    const m = await post(claim({ category: "medical", amountMinor: 9_000_000 }));
    expect(m.statusCode).toBe(202);
    expect((await stored((m.json() as { id: string }).id)).receipt_basis).toBe("not_required");
  });

  it("above_amount threshold edges: below and equal pass, one paisa above is refused with the rule named", async () => {
    for (const amountMinor of [499999, 500000]) {
      expect((await post(claim({ category: "travel", amountMinor }))).statusCode, String(amountMinor)).toBe(202);
    }
    const over = await post(claim({ category: "travel", amountMinor: 500001 }));
    expect(over.statusCode).toBe(422);
    expect(code(over)).toBe("RECEIPT_REQUIRED");
    expect((over.json() as { message: string }).message).toContain("above Rs 5,000.00");
    expect((await post(claim({ category: "travel", amountMinor: 500001, attachmentKeys: [await receipt()] }))).statusCode).toBe(202);
  });

  it("self-declaration: accepted up to its limit, recorded on the claim and in the audit; refused above the limit or when not asserted", async () => {
    const ok = await post(claim({ category: "lta", amountMinor: 200000, selfDeclaration: true }));
    expect(ok.statusCode).toBe(202);
    const id = (ok.json() as { id: string }).id;
    const row = await stored(id);
    expect(row).toMatchObject({ receipt_basis: "self_declaration", self_declared_by: EMP_USER });
    expect(row.self_declared_at).toBeTruthy();
    expect(row.attachment_keys).toEqual([]);
    const audit = await until(() => auditsFor(id, "create"), (a) => a.length > 0);
    expect(audit[0]!.payload).toMatchObject({ receiptBasis: "self_declaration", selfDeclaredBy: EMP_USER });
    expect((audit[0]!.payload as { receiptRule: string }).receiptRule).toContain("self-declaration");
    const list = await app.inject({ method: "GET", url: "/v1/payroll/reimbursements", headers: auth(OFFICER, ["payroll_officer"]) });
    expect((list.json() as { data: Row[] }).data.find((x) => x.id === id)).toMatchObject({ receipt_basis: "self_declaration" });

    const above = await post(claim({ category: "lta", amountMinor: 200001, selfDeclaration: true }));
    expect(above.statusCode).toBe(422);
    expect(code(above)).toBe("RECEIPT_REQUIRED");
    const notAsserted = await post(claim({ category: "lta", amountMinor: 200000 }));
    expect(notAsserted.statusCode).toBe(422);
    expect((notAsserted.json() as { message: string }).message).toContain("self-declaration is accepted");
    // a category with no self-declaration limit does not honour one
    expect((await post(claim({ category: "food", selfDeclaration: true }))).statusCode).toBe(422);
  });

  it("a receipt wins over a self-declaration (basis receipt, nobody recorded as signer)", async () => {
    const r = await post(claim({ category: "lta", amountMinor: 1000, selfDeclaration: true, attachmentKeys: [await receipt()] }));
    expect(r.statusCode).toBe(202);
    const row = await stored((r.json() as { id: string }).id);
    expect(row.receipt_basis).toBe("receipt");
    expect(row.self_declared_by).toBeNull();
  });

  it("the consumer re-checks the rule when a command is published without the route (nothing inserted)", async () => {
    const ref = `DIRECT-${randomUUID().slice(0, 6)}`;
    const publish = (payload: Record<string, unknown>) => (queue as unknown as { publish: (t: string, m: unknown) => Promise<void> }).publish("payroll.reimbursement.create", {
      messageId: randomUUID(), type: "payroll.reimbursement.create", tenantId: TENANT, actorId: EMP_USER, correlationId: randomUUID(), schemaVersion: "1.0", payload,
    });
    const base = { tenantId: TENANT, employeeId: EMP_ID, period: "2026-08", billRef: ref };
    await publish({ ...base, id: randomUUID(), category: "food", amountMinor: 100 });                            // food = always
    await publish({ ...base, id: randomUUID(), category: "travel", amountMinor: 500001 });                       // above threshold
    await publish({ ...base, id: randomUUID(), category: "lta", amountMinor: 200001, selfDeclaration: true });   // above limit
    await settle();
    expect(await q(sql`SELECT 1 FROM payroll.payroll_reimbursements WHERE bill_ref = ${ref}`)).toHaveLength(0);
    const okId = randomUUID();
    await publish({ ...base, id: okId, category: "lta", amountMinor: 200000, selfDeclaration: true });
    expect((await stored(okId)).receipt_basis).toBe("self_declaration");
  });

  it("another tenant is unaffected (still on the default)", async () => {
    const g = await app.inject({ method: "GET", url: URL, headers: auth(ADMIN, ["payroll_admin"], OTHER_TENANT) });
    expect((g.json() as { isDefault: boolean }).isDefault).toBe(true);
    const r = await app.inject({ method: "POST", url: "/v1/payroll/reimbursements", headers: auth(OFFICER, ["payroll_officer"], OTHER_TENANT), payload: claim({ category: "medical" }) });
    expect(r.statusCode).toBe(422);
  });

  it("saving an empty policy returns the tenant to the defaults", async () => {
    expect((await put({})).statusCode).toBe(202);
    await until(() => app.inject({ method: "GET", url: URL, headers: auth(ADMIN, ["payroll_admin"]) }), (r) => (r.json() as { categories: { food: { mode: string } } }).categories.food.mode === "never");
    expect((await post(claim({ category: "medical" }))).statusCode).toBe(422);
    expect((await post(claim({ category: "food" }))).statusCode).toBe(202);
  });
});

// ─── Policy version stamp: an accepted claim is processed under the rule it passed ───
describe("receipt policy: version stamped at the route", () => {
  const OFFICER_2 = randomUUID();
  const currentVersion = async (): Promise<number> =>
    (await app.inject({ method: "GET", url: URL, headers: auth(ADMIN, ["payroll_admin"]) })).json<{ version: number }>().version;
  const waitVersion = async (v: number) => { await until(currentVersion, (x) => x >= v); };
  const publishRaw = (payload: Record<string, unknown>) => (queue as unknown as { publish: (t: string, m: unknown) => Promise<void> }).publish("payroll.reimbursement.create", {
    messageId: randomUUID(), type: "payroll.reimbursement.create", tenantId: TENANT, actorId: EMP_USER, correlationId: randomUUID(), schemaVersion: "1.0", payload,
  });

  it("each save bumps the version; GET reports it", async () => {
    const v0 = await currentVersion();
    expect((await put({ food: { mode: "never" } })).statusCode).toBe(202);
    await waitVersion(v0 + 1);
    expect((await put({})).statusCode).toBe(202);
    await waitVersion(v0 + 2);
    const rows = await q(sql`SELECT reimbursement_receipt_policy_version AS v, jsonb_array_length(reimbursement_receipt_policy_history) AS n FROM payroll.payroll_settings WHERE tenant_id = ${TENANT}::uuid`);
    expect(rows[0]!.v).toBe(v0 + 2);
    expect(Number(rows[0]!.n)).toBeGreaterThanOrEqual(2);
  });

  it("MID-FLIGHT: a claim accepted under the old rule is stored even if the policy is tightened before the consumer runs, and the audit names the version", async () => {
    const v0 = await currentVersion();
    // hold the command back: accepted by the route, not yet processed
    const real = (queue as unknown as { publish: (t: string, m: unknown) => Promise<void> }).publish.bind(queue);
    let held: { t: string; m: unknown } | null = null;
    const spy = vi.spyOn(queue as unknown as { publish: (t: string, m: unknown) => Promise<void> }, "publish").mockImplementation(async (t, m) => {
      if (t === "payroll.reimbursement.create" && !held) { held = { t, m }; return; }
      return real(t, m);
    });
    const ref = `MID-${randomUUID().slice(0, 6)}`;
    const res = await post(claim({ category: "food", billRef: ref }));
    spy.mockRestore();
    expect(res.statusCode).toBe(202);
    expect((held as { m: { payload: { receiptPolicyVersion: number } } } | null)!.m.payload.receiptPolicyVersion).toBe(v0);
    // policy tightened: food now needs a receipt
    expect((await put({ food: { mode: "always" } })).statusCode).toBe(202);
    await waitVersion(v0 + 1);
    expect((await post(claim({ category: "food" }))).statusCode).toBe(422); // new claims see the new rule
    // the held claim is now delivered: processed under the version it was accepted under
    await real(held!.t, held!.m);
    const id = (res.json() as { id: string }).id;
    const row = await stored(id);
    expect(row).toMatchObject({ receipt_basis: "not_required", receipt_policy_version: v0 });
    const audit = await until(() => auditsFor(id, "create"), (a) => a.length > 0);
    expect(audit[0]!.payload).toMatchObject({ receiptPolicyVersion: v0 });
  });

  it("a stamp naming a version that does not exist, or the current stricter version, is refused", async () => {
    const vNow = await currentVersion(); // food = always
    const ref = `FORGE-${randomUUID().slice(0, 6)}`;
    const base = { tenantId: TENANT, employeeId: EMP_ID, period: "2026-08", billRef: ref, category: "food", amountMinor: 100 };
    await publishRaw({ ...base, id: randomUUID(), receiptPolicyVersion: vNow + 7 });      // future / nonexistent
    await publishRaw({ ...base, id: randomUUID(), receiptPolicyVersion: -1 });
    await publishRaw({ ...base, id: randomUUID(), receiptPolicyVersion: vNow });          // exists, but food needs a receipt
    await settle();
    expect(await q(sql`SELECT 1 FROM payroll.payroll_reimbursements WHERE bill_ref = ${ref}`)).toHaveLength(0);
  });

  it("a stamp for a version superseded long ago is refused (stale)", async () => {
    const vOld = (await currentVersion()) - 1; // lenient version, superseded by the current one
    await q(sql`UPDATE payroll.payroll_settings SET reimbursement_receipt_policy_history =
      (SELECT jsonb_agg(jsonb_set(e, '{at}', '"2020-01-01T00:00:00Z"'::jsonb)) FROM jsonb_array_elements(reimbursement_receipt_policy_history) e)
      WHERE tenant_id = ${TENANT}::uuid`);
    const ref = `STALE-${randomUUID().slice(0, 6)}`;
    await publishRaw({ tenantId: TENANT, employeeId: EMP_ID, period: "2026-08", billRef: ref, category: "food", amountMinor: 100, id: randomUUID(), receiptPolicyVersion: vOld });
    await settle();
    expect(await q(sql`SELECT 1 FROM payroll.payroll_reimbursements WHERE bill_ref = ${ref}`)).toHaveLength(0);
  });

  it("a route-accepted claim stores the version it passed", async () => {
    const v = await currentVersion();
    const r = await post(claim({ category: "food", attachmentKeys: [await receipt()] }));
    expect(r.statusCode).toBe(202);
    expect((await stored((r.json() as { id: string }).id)).receipt_policy_version).toBe(v);
  });

  // ─── self-declaration filed by HR on someone's behalf ───
  it("HR filing a self-declaration for an employee: both people recorded, marked 'on behalf' in the claim, list and audit; the filer cannot approve it", async () => {
    const OFFICER_EMP = randomUUID();
    EMPLOYEE_BY_ACTOR.set(OFFICER, OFFICER_EMP);
    const v = await currentVersion();
    expect((await put({ lta: { mode: "always", selfDeclarationUpToMinor: 200000 } })).statusCode).toBe(202);
    await waitVersion(v + 1);

    const hr = await post(claim({ category: "lta", amountMinor: 150000, selfDeclaration: true }), ["payroll_officer"], OFFICER);
    expect(hr.statusCode).toBe(202);
    const hrId = (hr.json() as { id: string }).id;
    const row = await stored(hrId);
    expect(row).toMatchObject({ receipt_basis: "self_declaration", self_declared_on_behalf: true, self_declared_by: OFFICER, created_by: OFFICER, employee_id: EMP_ID });
    const audit = await until(() => auditsFor(hrId, "create"), (a) => a.length > 0);
    expect(audit[0]!.payload).toMatchObject({ receiptBasis: "self_declaration", selfDeclaredOnBehalf: true, selfDeclaredBy: OFFICER, selfDeclaredFor: EMP_ID });

    // the employee declaring for themselves is NOT marked on behalf
    const own = await post(claim({ category: "lta", amountMinor: 150000, selfDeclaration: true }));
    expect(own.statusCode).toBe(202);
    const ownRow = await stored((own.json() as { id: string }).id);
    expect(ownRow).toMatchObject({ self_declared_on_behalf: false, self_declared_by: EMP_USER });

    const list = await app.inject({ method: "GET", url: "/v1/payroll/reimbursements", headers: auth(OFFICER_2, ["payroll_officer"]) });
    expect((list.json() as { data: Row[] }).data.find((x) => x.id === hrId)).toMatchObject({ self_declared_on_behalf: true });

    // approver cannot be the filer
    const self = await app.inject({ method: "PATCH", url: `/v1/payroll/reimbursements/${hrId}/approve`, headers: auth(OFFICER, ["payroll_officer"]), payload: {} });
    expect(self.statusCode).toBe(403);
    expect(code(self)).toBe("SELF_APPROVAL_FORBIDDEN");
    const other = await app.inject({ method: "PATCH", url: `/v1/payroll/reimbursements/${hrId}/approve`, headers: auth(OFFICER_2, ["payroll_officer"]), payload: {} });
    expect(other.statusCode).toBe(202);
  });
});
