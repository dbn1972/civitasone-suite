/**
 * GAP-PAYROLL-TAX-DECLARATION-02 -- investment-proof upload, verification,
 * retention and legal hold, end to end against a REAL Postgres (migrated
 * through 0080, FORCE RLS, non-superuser payroll_svc), through buildApp() and
 * the real consumers. Object storage is faked in memory.
 *
 * Requires DATABASE_URL pointing at a disposable, migrated instance (see
 * vitest.config.ts REL-035).
 */
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import { runWithTenant } from "@civitasone/db";

const H = vi.hoisted(() => ({
  own: {} as Record<string, string>,
  objects: new Map<string, { contentLength: number; contentType: string }>(),
  deleted: [] as string[],
  failDelete: new Set<string>(),
  puts: [] as Array<Record<string, unknown>>,
}));

vi.mock("../src/shared/hrms-client.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/shared/hrms-client.js")>()),
  fetchEmployeeSummaries: vi.fn(async () => new Map()),
  resolveActorEmployeeId: vi.fn(async (_t: string, actorId: string) => H.own[actorId] ?? null),
}));

vi.mock("@civitasone/storage", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@civitasone/storage")>()),
  presignedPutUrl: vi.fn(async (o: Record<string, unknown>) => { H.puts.push(o); return `https://s3.test/put?k=${String(o.key)}`; }),
  presignedGetUrl: vi.fn(async (o: { key: string; expiresIn?: number }) => `https://s3.test/get?k=${o.key}&e=${o.expiresIn}`),
  headObject: vi.fn(async (key: string) => H.objects.get(key) ?? null),
  deleteObject: vi.fn(async (key: string) => { if (H.failDelete.has(key)) throw new Error("s3 down"); H.deleted.push(key); }),
}));

import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { registerTaxProofConsumers, purgeTenantProofs } from "../src/modules/tax-proofs/consumer.js";
import { publishDuePurges } from "../src/modules/tax-proofs/purge.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = randomUUID();
const OTHER_TENANT = randomUUID();
const FY = "2025-26";

const U_EMP_A = randomUUID();   // employee A login
const EMP_A = randomUUID();     // A's hrms id
const U_EMP_B = randomUUID();
const EMP_B = randomUUID();
const OFFICER_1 = randomUUID();
const OFFICER_2 = randomUUID();
const ADMIN = randomUUID();
const AUDITOR = randomUUID();
const HR = randomUUID();
const FIN = randomUUID();
const MGR = randomUUID();
const TENANT_ADMIN = randomUUID();
const OFFICER_EMP = randomUUID(); // OFFICER_2 is also an employee with their own proofs
const U_OFFICER_EMP = OFFICER_2;

function auth(sub: string, roles: string[], tenant = TENANT) {
  return { authorization: `Bearer ${signToken({ sub, tid: tenant, roles, sid: "tax-proofs" }, SECRET)}` };
}
const asA = () => auth(U_EMP_A, ["employee"]);
const asB = () => auth(U_EMP_B, ["employee"]);
const asOfficer1 = () => auth(OFFICER_1, ["payroll_officer"]);
const asOfficer2 = () => auth(OFFICER_2, ["payroll_officer", "employee"]);
const asAdmin = () => auth(ADMIN, ["payroll_admin"]);

type Row = Record<string, unknown>;
const rowsOf = (r: unknown): Row[] => Array.from(r as Iterable<Row>);
let app: Awaited<ReturnType<typeof buildApp>>;
const handlers = new Map<string, (m: unknown) => Promise<void>>();

const settle = () => new Promise((r) => setTimeout(r, 350));
async function until<T>(fn: () => Promise<T>, pred: (v: T) => boolean, ms = 4000): Promise<T> {
  const end = Date.now() + ms;
  let v = await fn();
  while (!pred(v) && Date.now() < end) { await new Promise((r) => setTimeout(r, 50)); v = await fn(); }
  return v;
}

const T = (fn: () => Promise<unknown>, tenant = TENANT) => runWithTenant(tenant, fn);
async function q(query: ReturnType<typeof sql>, tenant = TENANT): Promise<Row[]> {
  return runWithTenant(tenant, () => db.transaction(async (tx) => rowsOf(await tx.execute(query)))) as Promise<Row[]>;
}
const proof = async (id: string) => (await q(sql`SELECT * FROM payroll.tax_proofs WHERE id = ${id}::uuid`))[0];
const audits = (resourceId: string, tenant = TENANT) => q(sql`
  SELECT actor_id, payload FROM _outbox.messages WHERE topic = 'audit.event.record' AND payload->>'resourceId' = ${resourceId} ORDER BY created_at`, tenant);

/** presign -> "upload" -> submit; returns the proof id once the row exists. */
async function upload(headers: Record<string, string>, opts: { line?: string; fy?: string; type?: string; size?: number; amountMinor?: number; employeeId?: string } = {}) {
  const type = opts.type ?? "application/pdf";
  const size = opts.size ?? 2048;
  const fy = opts.fy ?? FY;
  const line = opts.line ?? "sec80c";
  const pre = await app.inject({
    method: "POST", url: "/v1/payroll/tax-proofs/presign", headers,
    payload: { fy, line, filename: "receipt.pdf", contentType: type, sizeBytes: size, ...(opts.employeeId ? { employeeId: opts.employeeId } : {}) },
  });
  if (pre.statusCode !== 200) return { pre, sub: null, id: null as string | null };
  const { storageKey } = pre.json() as { storageKey: string };
  H.objects.set(storageKey, { contentLength: size, contentType: type });
  const sub = await app.inject({
    method: "POST", url: "/v1/payroll/tax-proofs", headers,
    payload: { fy, line, storageKey, filename: "C:\\scans\\receipt.pdf", ...(opts.amountMinor !== undefined ? { amountMinor: opts.amountMinor } : {}) },
  });
  let id: string | null = null;
  if (sub.statusCode === 202) {
    id = (sub.json() as { id: string }).id;
    await until(() => proof(id!), (r) => r !== undefined);
  }
  return { pre, sub, id, storageKey };
}

async function seedProof(o: { tenant?: string; employee?: string; fy?: string; status?: string; hold?: boolean; line?: string; key?: string } = {}): Promise<{ id: string; key: string }> {
  const id = randomUUID();
  const tenant = o.tenant ?? TENANT;
  const key = o.key ?? `payroll/${tenant}/tax-proofs/${o.fy ?? FY}/${o.employee ?? EMP_A}/${randomUUID()}.pdf`;
  await runWithTenant(tenant, () => db.transaction(async (tx) => {
    await tx.execute(sql`
      INSERT INTO payroll.tax_proofs (id, tenant_id, employee_id, fy, line, storage_key, filename, content_type, size_bytes, status, rejection_reason, legal_hold, legal_hold_reason, uploaded_by)
      VALUES (${id}::uuid, ${tenant}::uuid, ${o.employee ?? EMP_A}::uuid, ${o.fy ?? FY}, ${o.line ?? "sec80c"}, ${key}, 'seed.pdf', 'application/pdf', 1000,
              ${o.status ?? "pending"}, ${o.status === "rejected" ? "seeded rejection" : null}, ${o.hold ?? false}, ${o.hold ? "court order 123" : null}, ${U_EMP_A}::uuid)
    `);
  }));
  return { id, key };
}

beforeAll(async () => {
  H.own[U_EMP_A] = EMP_A;
  H.own[U_EMP_B] = EMP_B;
  H.own[OFFICER_2] = OFFICER_EMP;

  const q0 = queue as unknown as { subscribe: (t: string, h: (m: { tenantId: string }) => Promise<void>) => void; start?: () => Promise<void> };
  const raw = q0.subscribe.bind(q0);
  registerTaxProofConsumers({
    ...queue,
    subscribe: (topic: string, handler: (m: { tenantId: string }) => Promise<void>) =>
      raw(topic, (m) => runWithTenant(m.tenantId, () => handler(m))),
  } as unknown as Parameters<typeof registerTaxProofConsumers>[0]);
  // Same consumers captured by topic, to drive genuinely concurrent deliveries.
  registerTaxProofConsumers({
    subscribe: (topic: string, handler: (m: unknown) => Promise<void>) => { handlers.set(topic, handler); },
  } as unknown as Parameters<typeof registerTaxProofConsumers>[0]);
  await q0.start?.();
  app = await buildApp();
});

afterAll(async () => {
  await app?.close();
  for (const t of [TENANT, OTHER_TENANT]) {
    await runWithTenant(t, () => db.transaction(async (tx) => {
      await tx.execute(sql`DELETE FROM payroll.tax_proofs WHERE tenant_id = ${t}::uuid`);
      await tx.execute(sql`DELETE FROM payroll.payroll_settings WHERE tenant_id = ${t}::uuid`);
      await tx.execute(sql`DELETE FROM payroll.payroll_tax_declarations WHERE tenant_id = ${t}::uuid`);
    }));
  }
  await sqlClient.end();
});

describe("upload: presign + attach", () => {
  it("issues a tenant/employee/FY-scoped server key, signs size + SSE, and attaches after a HEAD check", async () => {
    const { pre, sub, id } = await upload(asA(), { amountMinor: 1_00_000 });
    expect(pre.statusCode).toBe(200);
    const body = pre.json() as { storageKey: string; expiresInSeconds: number; headers: Record<string, string> };
    // The browser must send exactly these headers (the SSE header is part of the signature).
    expect(body.headers).toEqual({ "content-type": "application/pdf", "x-amz-server-side-encryption": "AES256" });
    expect(body.storageKey.startsWith(`payroll/${TENANT}/tax-proofs/${FY}/${EMP_A}/`)).toBe(true);
    expect(body.expiresInSeconds).toBeLessThanOrEqual(300);
    expect(pre.headers["cache-control"]).toBe("no-store");
    const last = H.puts[H.puts.length - 1]!;
    expect(last).toMatchObject({ contentType: "application/pdf", contentLength: 2048, serverSideEncryption: "AES256", expiresIn: 300 });
    expect(sub!.statusCode).toBe(202);
    const row = await proof(id!);
    expect(row).toMatchObject({ status: "pending", employee_id: EMP_A, fy: FY, line: "sec80c", filename: "receipt.pdf", size_bytes: "2048", content_type: "application/pdf" });
    expect(String(row!.amount_minor)).toBe("100000");
    expect((await until(() => audits(id!), (a) => a.length > 0))[0]!.payload).toMatchObject({ action: "upload", resourceType: "payroll_tax_proof" });
  });

  it("refuses oversize and wrong-type files at presign with 422", async () => {
    const big = await app.inject({ method: "POST", url: "/v1/payroll/tax-proofs/presign", headers: asA(), payload: { fy: FY, line: "rent", filename: "a.pdf", contentType: "application/pdf", sizeBytes: 10 * 1024 * 1024 + 1 } });
    expect(big.statusCode).toBe(422);
    expect(big.json().code).toBe("PROOF_TOO_LARGE");
    const exe = await app.inject({ method: "POST", url: "/v1/payroll/tax-proofs/presign", headers: asA(), payload: { fy: FY, line: "rent", filename: "a.exe", contentType: "application/x-msdownload", sizeBytes: 100 } });
    expect(exe.statusCode).toBe(422);
    expect(exe.json().code).toBe("PROOF_TYPE_INVALID");
    const zero = await app.inject({ method: "POST", url: "/v1/payroll/tax-proofs/presign", headers: asA(), payload: { fy: FY, line: "rent", filename: "a.pdf", contentType: "application/pdf", sizeBytes: 0 } });
    expect(zero.statusCode).toBe(422);
  });

  it("refuses at attach when the stored object is oversize or the wrong type (HEAD, not the client's word) with 422", async () => {
    const ok = await app.inject({ method: "POST", url: "/v1/payroll/tax-proofs/presign", headers: asA(), payload: { fy: FY, line: "rent", filename: "a.pdf", contentType: "application/pdf", sizeBytes: 100 } });
    const key = (ok.json() as { storageKey: string }).storageKey;
    H.objects.set(key, { contentLength: 11 * 1024 * 1024, contentType: "application/pdf" });
    const big = await app.inject({ method: "POST", url: "/v1/payroll/tax-proofs", headers: asA(), payload: { fy: FY, line: "rent", storageKey: key, filename: "a.pdf" } });
    expect(big.statusCode).toBe(422);
    expect(big.json().code).toBe("PROOF_TOO_LARGE");
    H.objects.set(key, { contentLength: 100, contentType: "image/png" });
    const wrong = await app.inject({ method: "POST", url: "/v1/payroll/tax-proofs", headers: asA(), payload: { fy: FY, line: "rent", storageKey: key, filename: "a.pdf" } });
    expect(wrong.statusCode).toBe(422);
    expect(wrong.json().code).toBe("PROOF_TYPE_INVALID");
    H.objects.delete(key);
    const missing = await app.inject({ method: "POST", url: "/v1/payroll/tax-proofs", headers: asA(), payload: { fy: FY, line: "rent", storageKey: key, filename: "a.pdf" } });
    expect(missing.statusCode).toBe(422);
    expect(missing.json().code).toBe("PROOF_FILE_MISSING");
  });

  it("rejects a foreign or forged storage key with 422 and writes nothing", async () => {
    const own = await app.inject({ method: "POST", url: "/v1/payroll/tax-proofs/presign", headers: asB(), payload: { fy: FY, line: "rent", filename: "b.pdf", contentType: "application/pdf", sizeBytes: 100 } });
    const bKey = (own.json() as { storageKey: string }).storageKey;
    H.objects.set(bKey, { contentLength: 100, contentType: "application/pdf" });
    const forged = [
      bKey, // another employee's real key
      `payroll/${OTHER_TENANT}/tax-proofs/${FY}/${EMP_A}/${randomUUID()}.pdf`, // another tenant
      `payroll/${TENANT}/tax-proofs/${FY}/${EMP_A}/../${EMP_B}/${randomUUID()}.pdf`, // traversal
      `payroll/${TENANT}/tax-proofs/2024-25/${EMP_A}/${randomUUID()}.pdf`, // other FY
      "reimbursements/some/secret.pdf",
    ];
    const before = (await q(sql`SELECT count(*)::int AS n FROM payroll.tax_proofs`))[0]!.n;
    for (const storageKey of forged) {
      H.objects.set(storageKey, { contentLength: 100, contentType: "application/pdf" });
      const res = await app.inject({ method: "POST", url: "/v1/payroll/tax-proofs", headers: asA(), payload: { fy: FY, line: "rent", storageKey, filename: "x.pdf" } });
      expect(res.statusCode, storageKey).toBe(422);
      expect(res.json().code).toBe("INVALID_STORAGE_KEY");
    }
    await settle();
    expect((await q(sql`SELECT count(*)::int AS n FROM payroll.tax_proofs`))[0]!.n).toBe(before);
  });

  it("an employee cannot upload for someone else, and non-employee roles cannot upload at all", async () => {
    const other = await app.inject({ method: "POST", url: "/v1/payroll/tax-proofs/presign", headers: asA(), payload: { employeeId: EMP_B, fy: FY, line: "rent", filename: "a.pdf", contentType: "application/pdf", sizeBytes: 10 } });
    expect(other.statusCode).toBe(403);
    for (const [sub, roles] of [[HR, ["hr_admin"]], [FIN, ["finance_officer"]], [ADMIN, ["payroll_admin"]], [AUDITOR, ["auditor"]]] as const) {
      const res = await app.inject({ method: "POST", url: "/v1/payroll/tax-proofs/presign", headers: auth(sub, [...roles]), payload: { fy: FY, line: "rent", filename: "a.pdf", contentType: "application/pdf", sizeBytes: 10 } });
      expect(res.statusCode, roles.join()).toBe(403);
    }
  });

  it("caps a declaration line at 10 files (409), counted per line", async () => {
    const fy = "2024-25";
    for (let i = 0; i < 10; i += 1) await seedProof({ employee: EMP_B, fy, line: "sec80d" });
    const res = await app.inject({ method: "POST", url: "/v1/payroll/tax-proofs/presign", headers: asB(), payload: { fy, line: "sec80d", filename: "a.pdf", contentType: "application/pdf", sizeBytes: 10 } });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("PROOF_LIMIT_REACHED");
    const otherLine = await app.inject({ method: "POST", url: "/v1/payroll/tax-proofs/presign", headers: asB(), payload: { fy, line: "sec80g", filename: "a.pdf", contentType: "application/pdf", sizeBytes: 10 } });
    expect(otherLine.statusCode).toBe(200);
  });

  it("the consumer enforces the per-line cap itself under concurrent submits", async () => {
    const fy = "2023-24";
    for (let i = 0; i < 9; i += 1) await seedProof({ employee: EMP_B, fy, line: "other" });
    const submit = handlers.get("payroll.tax_proof.submit")!;
    const msgs = Array.from({ length: 4 }, () => {
      const key = `payroll/${TENANT}/tax-proofs/${fy}/${EMP_B}/${randomUUID()}.pdf`;
      return { messageId: randomUUID(), tenantId: TENANT, actorId: U_EMP_B, correlationId: randomUUID(),
        payload: { id: randomUUID(), employeeId: EMP_B, fy, line: "other", storageKey: key, filename: "c.pdf", contentType: "application/pdf", sizeBytes: 10 } };
    });
    await Promise.all(msgs.map((m) => T(() => submit(m))));
    expect((await q(sql`SELECT count(*)::int AS n FROM payroll.tax_proofs WHERE employee_id = ${EMP_B}::uuid AND fy = ${fy} AND line = 'other'`))[0]!.n).toBe(10);
  });
});

describe("who may read", () => {
  let proofId: string;
  beforeAll(async () => { proofId = (await upload(asA(), { line: "rent" })).id!; });

  it("access matrix for the view link: own yes, other employee no, hr/finance/manager denied, payroll + auditor allowed", async () => {
    const get = (headers: Record<string, string>) => app.inject({ method: "GET", url: `/v1/payroll/tax-proofs/${proofId}/url`, headers });

    const own = await get(asA());
    expect(own.statusCode).toBe(200);
    expect(own.headers["cache-control"]).toBe("no-store");
    const ownBody = own.json() as { url: string; expiresInSeconds: number };
    expect(ownBody.expiresInSeconds).toBeLessThanOrEqual(300);
    expect(ownBody.url).toContain("e=300");

    expect((await get(asB())).statusCode).toBe(404);
    for (const [sub, roles] of [[HR, ["hr_admin"]], [HR, ["hr_officer"]], [FIN, ["finance_officer"]], [MGR, ["manager"]], [TENANT_ADMIN, ["tenant_admin"]], [HR, ["hr_admin", "employee"]]] as const) {
      const res = await get(auth(sub, [...roles]));
      expect([403, 404], roles.join()).toContain(res.statusCode);
      if (!roles.includes("employee")) expect(res.statusCode, roles.join()).toBe(403);
    }
    for (const headers of [asOfficer1(), asAdmin(), auth(AUDITOR, ["auditor"])]) {
      const res = await get(headers);
      expect(res.statusCode).toBe(200);
      expect(res.headers["cache-control"]).toBe("no-store");
    }
    // Another tenant's staff cannot reach it at all.
    expect((await get(auth(ADMIN, ["payroll_admin"], OTHER_TENANT))).statusCode).toBe(404);
  });

  it("every view is audited (actor + proof) and the audit is queued before the link is issued", async () => {
    await app.inject({ method: "GET", url: `/v1/payroll/tax-proofs/${proofId}/url`, headers: asOfficer1() });
    const trail = await until(() => audits(proofId), (a) => a.some((r) => (r.payload as { action: string }).action === "view" && r.actor_id === OFFICER_1));
    const view = trail.find((r) => (r.payload as { action: string }).action === "view" && r.actor_id === OFFICER_1)!;
    expect(view.payload).toMatchObject({ resourceType: "payroll_tax_proof", details: { viewerKind: "staff", fy: FY, line: "rent", ttlSeconds: 300 } });
  });

  it("lists return counts and file metadata, never storage keys", async () => {
    const queue1 = await app.inject({ method: "GET", url: `/v1/payroll/tax-proofs?fy=${FY}`, headers: asOfficer1() });
    expect(queue1.statusCode).toBe(200);
    const body = queue1.json() as { data: Array<Record<string, unknown>>; meta: { total: number; counts: Record<string, number> } };
    expect(body.data.length).toBeGreaterThan(0);
    expect(body.meta.total).toBeGreaterThan(0);
    expect(JSON.stringify(body)).not.toContain("payroll/");
    expect(JSON.stringify(body)).not.toContain("storage");
    const mine = await app.inject({ method: "GET", url: `/v1/payroll/tax-proofs/mine?fy=${FY}`, headers: asA() });
    expect(mine.statusCode).toBe(200);
    expect(JSON.stringify(mine.json())).not.toContain("payroll/");
    expect(JSON.stringify(mine.json())).not.toContain("storage");
    expect((mine.json() as { items: Array<{ employeeId?: string }> }).items.every((i) => i.employeeId === undefined)).toBe(true);
  });

  it("the queue is closed to employees, hr, finance and managers; the auditor may list", async () => {
    for (const [sub, roles] of [[U_EMP_A, ["employee"]], [HR, ["hr_admin"]], [FIN, ["finance_officer"]], [MGR, ["manager"]]] as const) {
      expect((await app.inject({ method: "GET", url: "/v1/payroll/tax-proofs", headers: auth(sub, [...roles]) })).statusCode, roles.join()).toBe(403);
    }
    expect((await app.inject({ method: "GET", url: "/v1/payroll/tax-proofs", headers: auth(AUDITOR, ["auditor"]) })).statusCode).toBe(200);
    // an auditor is read-only
    const id = (await seedProof()).id;
    expect((await app.inject({ method: "POST", url: `/v1/payroll/tax-proofs/${id}/accept`, headers: auth(AUDITOR, ["auditor"]), payload: {} })).statusCode).toBe(403);
  });

  it("an employee sees only their own proofs in /mine, and the queue is tenant-isolated", async () => {
    const mine = await app.inject({ method: "GET", url: `/v1/payroll/tax-proofs/mine?fy=${FY}`, headers: asB() });
    const items = (mine.json() as { items: Array<{ id: string }> }).items;
    expect(items.find((i) => i.id === proofId)).toBeUndefined();
    await seedProof({ tenant: OTHER_TENANT });
    const otherQueue = await app.inject({ method: "GET", url: "/v1/payroll/tax-proofs", headers: asOfficer1() });
    const ids = (otherQueue.json() as { data: Array<{ id: string }> }).data.map((d) => d.id);
    const foreign = (await q(sql`SELECT id::text AS id FROM payroll.tax_proofs`, OTHER_TENANT)).map((r) => String(r.id));
    expect(foreign.length).toBeGreaterThan(0);
    expect(ids.some((i) => foreign.includes(i))).toBe(false);
  });
});

describe("verification workflow", () => {
  it("accept: pending -> accepted by another officer, audited, and the verified amount feeds the per-line summary", async () => {
    const { id } = await upload(asA(), { line: "sec80c", fy: "2022-23", amountMinor: 50_000_00 });
    await runWithTenant(TENANT, () => db.transaction(async (tx) => {
      await tx.execute(sql`
        INSERT INTO payroll.payroll_tax_declarations (id, tenant_id, employee_id, fy, regime, section_80c, created_by)
        VALUES (${randomUUID()}::uuid, ${TENANT}::uuid, ${EMP_A}::uuid, '2022-23', 'old', 15000000, ${U_EMP_A}::uuid)
        ON CONFLICT DO NOTHING`);
    }));
    const res = await app.inject({ method: "POST", url: `/v1/payroll/tax-proofs/${id}/accept`, headers: asOfficer1(), payload: { amountMinor: 4_000_000 } });
    expect(res.statusCode).toBe(202);
    const row = await until(() => proof(id!), (r) => r?.status === "accepted");
    expect(row).toMatchObject({ status: "accepted", decided_by: OFFICER_1 });
    expect(String(row!.amount_minor)).toBe("4000000");
    const trail = await until(() => audits(id!), (a) => a.some((r) => (r.payload as { action: string }).action === "accept"));
    const acc = trail.find((r) => (r.payload as { action: string }).action === "accept")!;
    expect(acc.actor_id).toBe(OFFICER_1);
    expect(acc.payload).toMatchObject({ details: { decision: "accepted", amountBeforeMinor: "5000000", amountAfterMinor: "4000000" } });

    const mine = (await app.inject({ method: "GET", url: "/v1/payroll/tax-proofs/mine?fy=2022-23", headers: asA() })).json() as {
      summary: Array<{ line: string; accepted: number; declaredMinor: string | null; verifiedMinor: string }>;
    };
    const line = mine.summary.find((s) => s.line === "sec80c")!;
    expect(line).toMatchObject({ accepted: 1, declaredMinor: "15000000", verifiedMinor: "4000000" });
  });

  it("accepting a proof with NO stored amount and no amount in the body is refused (422 AMOUNT_REQUIRED); with an amount it verifies", async () => {
    const { id } = await upload(asA(), { line: "sec80c", fy: "2022-23" }); // employee typed no amount
    expect((await proof(id!))!.amount_minor).toBeNull();
    const refused = await app.inject({ method: "POST", url: `/v1/payroll/tax-proofs/${id}/accept`, headers: asOfficer1(), payload: {} });
    expect(refused.statusCode).toBe(422);
    expect(refused.json().code).toBe("AMOUNT_REQUIRED");
    await settle();
    expect((await proof(id!))!.status).toBe("pending");
    // the consumer re-asserts it even if the route check is bypassed
    const decide = handlers.get("payroll.tax_proof.decide")!;
    await T(() => decide({ messageId: randomUUID(), tenantId: TENANT, actorId: OFFICER_1, correlationId: randomUUID(), payload: { id, decision: "accepted", deciderEmployeeId: null } }));
    expect((await proof(id!))!.status).toBe("pending");
    // an amount from the officer makes it count
    expect((await app.inject({ method: "POST", url: `/v1/payroll/tax-proofs/${id}/accept`, headers: asOfficer1(), payload: { amountMinor: 7_500_000 } })).statusCode).toBe(202);
    const row = await until(() => proof(id!), (r) => r?.status === "accepted");
    expect(String(row!.amount_minor)).toBe("7500000");
    // a proof the employee DID give an amount for accepts without restating it
    const stated = await upload(asA(), { line: "sec80c", fy: "2022-23", amountMinor: 20_000 });
    expect((await app.inject({ method: "POST", url: `/v1/payroll/tax-proofs/${stated.id}/accept`, headers: asOfficer1(), payload: {} })).statusCode).toBe(202);
  });

  it("GET /mine tells the employee the cutoff date only when the tenant has opted in to verified-amount TDS", async () => {
    await runWithTenant(TENANT, () => db.transaction(async (tx) => {
      await tx.execute(sql`DELETE FROM payroll.payroll_settings WHERE tenant_id = ${TENANT}::uuid`);
    }));
    const get = async (fy: string) => (await app.inject({ method: "GET", url: `/v1/payroll/tax-proofs/mine?fy=${fy}`, headers: asA() })).json() as { verifiedTdsEnabled: boolean; cutoffDate: string | null };
    expect(await get("2026-27")).toMatchObject({ verifiedTdsEnabled: false, cutoffDate: null });
    await runWithTenant(TENANT, () => db.transaction(async (tx) => {
      await tx.execute(sql`INSERT INTO payroll.payroll_settings (tenant_id, tax_proof_verified_from_fy, tax_proof_cutoff_md) VALUES (${TENANT}::uuid, '2026-27', '02-15')`);
    }));
    expect(await get("2026-27")).toMatchObject({ verifiedTdsEnabled: true, cutoffDate: "2027-02-15" });
    expect(await get("2025-26")).toMatchObject({ verifiedTdsEnabled: false, cutoffDate: null }); // before the flag
    await runWithTenant(TENANT, () => db.transaction(async (tx) => {
      await tx.execute(sql`DELETE FROM payroll.payroll_settings WHERE tenant_id = ${TENANT}::uuid`);
    }));
  });

  it("reject needs a reason and records it; a decided proof cannot be decided again (409)", async () => {
    const { id } = await upload(asA(), { line: "sec80d", fy: "2022-23" });
    const noReason = await app.inject({ method: "POST", url: `/v1/payroll/tax-proofs/${id}/reject`, headers: asOfficer1(), payload: { reason: "bad" } });
    expect(noReason.statusCode).toBe(400);
    const res = await app.inject({ method: "POST", url: `/v1/payroll/tax-proofs/${id}/reject`, headers: asOfficer1(), payload: { reason: "Receipt is illegible, please re-upload" } });
    expect(res.statusCode).toBe(202);
    const row = await until(() => proof(id!), (r) => r?.status === "rejected");
    expect(row).toMatchObject({ status: "rejected", rejection_reason: "Receipt is illegible, please re-upload" });
    const again = await app.inject({ method: "POST", url: `/v1/payroll/tax-proofs/${id}/accept`, headers: asAdmin(), payload: {} });
    expect(again.statusCode).toBe(409);
  });

  it("an officer cannot verify their own proof (403), and the consumer re-asserts it", async () => {
    // OFFICER_2 is also an employee: their own upload.
    const own = await upload(asOfficer2(), { line: "other", fy: "2022-23" });
    expect(own.sub!.statusCode).toBe(202);
    const res = await app.inject({ method: "POST", url: `/v1/payroll/tax-proofs/${own.id}/accept`, headers: asOfficer2(), payload: {} });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe("SELF_VERIFY_FORBIDDEN");
    // payroll_admin who is the same person is blocked too
    const asAdminEmployee = auth(OFFICER_2, ["payroll_admin", "employee"]);
    expect((await app.inject({ method: "POST", url: `/v1/payroll/tax-proofs/${own.id}/reject`, headers: asAdminEmployee, payload: { reason: "not a real receipt" } })).statusCode).toBe(403);

    // Bypass the route: publish the decision straight at the consumer.
    const decide = handlers.get("payroll.tax_proof.decide")!;
    await T(() => decide({ messageId: randomUUID(), tenantId: TENANT, actorId: OFFICER_2, correlationId: randomUUID(),
      payload: { id: own.id, decision: "accepted", amountMinor: 1000, deciderEmployeeId: OFFICER_EMP } }));
    await T(() => decide({ messageId: randomUUID(), tenantId: TENANT, actorId: OFFICER_2, correlationId: randomUUID(),
      payload: { id: own.id, decision: "accepted", amountMinor: 1000, deciderEmployeeId: null } })); // uploader == actor
    await settle();
    expect((await proof(own.id!))?.status).toBe("pending");
    expect((await audits(own.id!)).filter((r) => (r.payload as { action: string }).action === "accept")).toHaveLength(0);
    // ... but a different officer can.
    expect((await app.inject({ method: "POST", url: `/v1/payroll/tax-proofs/${own.id}/accept`, headers: asOfficer1(), payload: { amountMinor: 1000 } })).statusCode).toBe(202);
    expect((await until(() => proof(own.id!), (r) => r?.status === "accepted"))?.status).toBe("accepted");
  });

  it("concurrent verification yields exactly one decision and one audit event", async () => {
    const { id } = await seedProof({ fy: "2022-23" });
    const decide = handlers.get("payroll.tax_proof.decide")!;
    const mk = (actor: string, decision: "accepted" | "rejected") => ({
      messageId: randomUUID(), tenantId: TENANT, actorId: actor, correlationId: randomUUID(),
      payload: { id, decision, amountMinor: decision === "accepted" ? 1000 : undefined, reason: decision === "rejected" ? "does not match the declaration" : undefined, deciderEmployeeId: null },
    });
    await Promise.all([
      T(() => decide(mk(OFFICER_1, "accepted"))), T(() => decide(mk(ADMIN, "rejected"))),
      T(() => decide(mk(OFFICER_1, "accepted"))), T(() => decide(mk(ADMIN, "rejected"))),
    ]);
    const row = (await proof(id))!;
    expect(["accepted", "rejected"]).toContain(row.status);
    const decisions = (await audits(id)).filter((r) => ["accept", "reject"].includes((r.payload as { action: string }).action));
    expect(decisions).toHaveLength(1);
    expect(row.decided_by).toBe(decisions[0]!.actor_id);
  });

  it("a duplicate delivery of the same message id decides nothing twice", async () => {
    const { id } = await seedProof({ fy: "2022-23" });
    const decide = handlers.get("payroll.tax_proof.decide")!;
    const m = { messageId: randomUUID(), tenantId: TENANT, actorId: OFFICER_1, correlationId: randomUUID(), payload: { id, decision: "accepted", amountMinor: 1000, deciderEmployeeId: null } };
    await T(() => decide(m));
    await T(() => decide(m));
    expect((await audits(id)).filter((r) => (r.payload as { action: string }).action === "accept")).toHaveLength(1);
  });

  it("hr, finance and managers cannot verify; the employee can withdraw only a pending proof", async () => {
    const { id } = await seedProof({ employee: EMP_A, fy: "2022-23" });
    for (const [sub, roles] of [[HR, ["hr_admin"]], [FIN, ["finance_officer"]], [MGR, ["manager"]]] as const) {
      expect((await app.inject({ method: "POST", url: `/v1/payroll/tax-proofs/${id}/accept`, headers: auth(sub, [...roles]), payload: {} })).statusCode).toBe(403);
    }
    expect((await app.inject({ method: "DELETE", url: `/v1/payroll/tax-proofs/${id}`, headers: asB() })).statusCode).toBe(404);
    expect((await app.inject({ method: "DELETE", url: `/v1/payroll/tax-proofs/${id}`, headers: asA() })).statusCode).toBe(202);
    expect((await until(() => proof(id), (r) => r?.status === "removed"))?.status).toBe("removed");
    const decided = await seedProof({ status: "accepted", fy: "2022-23" });
    expect((await app.inject({ method: "DELETE", url: `/v1/payroll/tax-proofs/${decided.id}`, headers: asA() })).statusCode).toBe(409);
    // a withdrawn proof no longer shows up or opens
    const mine = (await app.inject({ method: "GET", url: "/v1/payroll/tax-proofs/mine?fy=2022-23", headers: asA() })).json() as { items: Array<{ id: string }> };
    expect(mine.items.find((i) => i.id === id)).toBeUndefined();
    expect((await app.inject({ method: "GET", url: `/v1/payroll/tax-proofs/${id}/url`, headers: asA() })).statusCode).toBe(404);
  });
});

describe("retention setting + legal hold + purge", () => {
  it("defaults to 8 years; payroll_admin / tenant_admin / super_admin edit it with before/after audited; others cannot", async () => {
    const get = await app.inject({ method: "GET", url: "/v1/payroll/tax-proofs/settings", headers: asAdmin() });
    expect(get.json()).toMatchObject({ taxProofRetentionYears: 8, defaultYears: 8, minYears: 1, maxYears: 10, canEdit: true, canHold: true });

    for (const [sub, roles] of [[OFFICER_1, ["payroll_officer"]], [HR, ["hr_admin"]], [FIN, ["finance_officer"]], [AUDITOR, ["auditor"]], [U_EMP_A, ["employee"]]] as const) {
      expect((await app.inject({ method: "PUT", url: "/v1/payroll/tax-proofs/settings", headers: auth(sub, [...roles]), payload: { taxProofRetentionYears: 5 } })).statusCode, roles.join()).toBe(403);
    }
    for (const bad of [0, 11, 2.5, "7"]) {
      expect((await app.inject({ method: "PUT", url: "/v1/payroll/tax-proofs/settings", headers: asAdmin(), payload: { taxProofRetentionYears: bad } })).statusCode, String(bad)).toBe(400);
    }

    const put = await app.inject({ method: "PUT", url: "/v1/payroll/tax-proofs/settings", headers: auth(TENANT_ADMIN, ["tenant_admin"]), payload: { taxProofRetentionYears: 6, reason: "Legal advised six years" } });
    expect(put.statusCode).toBe(202);
    await until(() => audits(TENANT), (a) => a.length > 0);
    expect((await app.inject({ method: "GET", url: "/v1/payroll/tax-proofs/settings", headers: asAdmin() })).json()).toMatchObject({ taxProofRetentionYears: 6 });
    const put2 = await app.inject({ method: "PUT", url: "/v1/payroll/tax-proofs/settings", headers: auth(ADMIN, ["super_admin"]), payload: { taxProofRetentionYears: 8 } });
    expect(put2.statusCode).toBe(202);
    const trail = await until(() => audits(TENANT), (a) => a.length >= 2);
    expect(trail.map((r) => r.payload)).toEqual([
      expect.objectContaining({ action: "retention_update", details: { before: { taxProofRetentionYears: 8 }, after: { taxProofRetentionYears: 6 }, reason: "Legal advised six years" } }),
      expect.objectContaining({ action: "retention_update", details: { before: { taxProofRetentionYears: 6 }, after: { taxProofRetentionYears: 8 }, reason: null } }),
    ]);
    expect(trail[0]!.actor_id).toBe(TENANT_ADMIN);
    // both fields in one call: one acknowledgement that names every command
    const both = await app.inject({ method: "PUT", url: "/v1/payroll/tax-proofs/settings", headers: asAdmin(), payload: { taxProofRetentionYears: 8, taxProofCutoff: "01-31" } });
    expect(both.statusCode).toBe(202);
    expect((both.json() as { data: { applied: Array<{ field: string }> } }).data.applied.map((a) => a.field)).toEqual(["taxProofRetentionYears", "taxProofCutoff"]);
    // the CHECK constraint is the backstop for any writer
    await expect(runWithTenant(TENANT, () => db.transaction(async (tx) => {
      await tx.execute(sql`UPDATE payroll.payroll_settings SET tax_proof_retention_years = 0 WHERE tenant_id = ${TENANT}::uuid`);
    }))).rejects.toThrow();
  });

  it("only payroll_admin sets a legal hold, with a reason, audited", async () => {
    const { id } = await seedProof({ fy: "2018-19", status: "accepted" });
    const url = `/v1/payroll/tax-proofs/${id}/legal-hold`;
    for (const [sub, roles] of [[OFFICER_1, ["payroll_officer"]], [HR, ["hr_admin"]], [AUDITOR, ["auditor"]]] as const) {
      expect((await app.inject({ method: "PUT", url, headers: auth(sub, [...roles]), payload: { hold: true, reason: "court order 123" } })).statusCode, roles.join()).toBe(403);
    }
    expect((await app.inject({ method: "PUT", url, headers: asAdmin(), payload: { hold: true, reason: "x" } })).statusCode).toBe(400);
    expect((await app.inject({ method: "PUT", url, headers: asAdmin(), payload: { hold: true, reason: "court order 123" } })).statusCode).toBe(202);
    const row = await until(() => proof(id), (r) => r?.legal_hold === true);
    expect(row).toMatchObject({ legal_hold: true, legal_hold_reason: "court order 123", legal_hold_by: ADMIN });
    const trail = await until(() => audits(id), (a) => a.length > 0);
    expect(trail[0]!.payload).toMatchObject({ action: "legal_hold_set", details: { before: { legalHold: false }, after: { legalHold: true }, reason: "court order 123" } });
    // lists show the hold to staff
    const list = (await app.inject({ method: "GET", url: `/v1/payroll/tax-proofs?fy=2018-19`, headers: asAdmin() })).json() as { data: Array<{ id: string; legalHold: boolean }> };
    expect(list.data.find((d) => d.id === id)?.legalHold).toBe(true);
    // a held proof cannot be withdrawn either
    const pending = await seedProof({ fy: "2018-19", hold: true });
    expect((await app.inject({ method: "DELETE", url: `/v1/payroll/tax-proofs/${pending.id}`, headers: asA() })).statusCode).toBe(409);
  });

  it("purge respects retention, never touches a legal hold, deletes object then row, audits each, and is idempotent", async () => {
    await runWithTenant(TENANT, () => db.transaction(async (tx) => {
      await tx.execute(sql`DELETE FROM payroll.tax_proofs WHERE tenant_id = ${TENANT}::uuid`);
      await tx.execute(sql`DELETE FROM payroll.payroll_settings WHERE tenant_id = ${TENANT}::uuid`);
    }));
    // Default retention 8 (no settings row). now = 2029-04-01: FY 2020-21 ended 31 Mar 2021 -> due; FY 2021-22 -> retained.
    const due = await seedProof({ fy: "2020-21", status: "accepted" });
    const dueRejected = await seedProof({ fy: "2020-21", status: "rejected" });
    const held = await seedProof({ fy: "2020-21", status: "accepted", hold: true });
    const recent = await seedProof({ fy: "2021-22", status: "accepted" });
    const withdrawn = await seedProof({ fy: "2025-26", status: "removed" });
    const msg = { tenantId: TENANT, actorId: "00000000-0000-0000-0000-000000000099", correlationId: randomUUID() };
    H.deleted.length = 0;

    const before = await purgeTenantProofs(msg, { now: new Date("2029-03-31T12:00:00Z") });
    expect(before.purged).toBe(1); // only the withdrawn one: nothing is past retention yet on 31 Mar
    expect(H.deleted).toEqual([withdrawn.key]);
    H.deleted.length = 0;

    const res = await purgeTenantProofs(msg, { now: new Date("2029-04-01T00:00:00Z") });
    expect(res).toMatchObject({ purged: 2, failed: 0 });
    expect(H.deleted.sort()).toEqual([due.key, dueRejected.key].sort());
    expect(await proof(due.id)).toBeUndefined();
    expect(await proof(dueRejected.id)).toBeUndefined();
    expect(await proof(held.id)).toBeDefined();
    expect(await proof(recent.id)).toBeDefined();
    const purgeAudit = await audits(due.id);
    expect(purgeAudit).toHaveLength(1);
    expect(purgeAudit[0]!.payload).toMatchObject({ action: "purge", details: { fy: "2020-21", retentionYears: 8, reason: "retention_elapsed" } });
    expect(purgeAudit[0]!.actor_id).toBe(msg.actorId);

    // Idempotent: nothing left to do, nothing deleted twice, no extra audit rows.
    H.deleted.length = 0;
    expect(await purgeTenantProofs(msg, { now: new Date("2029-04-01T00:00:00Z") })).toMatchObject({ purged: 0 });
    expect(H.deleted).toEqual([]);
    expect(await audits(due.id)).toHaveLength(1);

    // Releasing the hold makes it purgeable; far in the future everything unheld goes.
    expect((await app.inject({ method: "PUT", url: `/v1/payroll/tax-proofs/${held.id}/legal-hold`, headers: asAdmin(), payload: { hold: false, reason: "matter closed 2029" } })).statusCode).toBe(202);
    await until(() => proof(held.id), (r) => r?.legal_hold === false);
    expect(await purgeTenantProofs(msg, { now: new Date("2040-01-01T00:00:00Z") })).toMatchObject({ purged: 2 });
    expect(await proof(held.id)).toBeUndefined();
  });

  it("uses the tenant's own retention years (shorter or longer than the default)", async () => {
    const a = await seedProof({ fy: "2020-21", status: "accepted" });
    const msg = { tenantId: TENANT, actorId: "00000000-0000-0000-0000-000000000099", correlationId: randomUUID() };
    await runWithTenant(TENANT, () => db.transaction(async (tx) => {
      await tx.execute(sql`INSERT INTO payroll.payroll_settings (tenant_id, tax_proof_retention_years) VALUES (${TENANT}::uuid, 10)
        ON CONFLICT (tenant_id) DO UPDATE SET tax_proof_retention_years = 10`);
    }));
    // 10y: retained through 31 Mar 2031.
    expect(await purgeTenantProofs(msg, { now: new Date("2030-01-01T00:00:00Z") })).toMatchObject({ purged: 0 });
    expect(await proof(a.id)).toBeDefined();
    await runWithTenant(TENANT, () => db.transaction(async (tx) => {
      await tx.execute(sql`UPDATE payroll.payroll_settings SET tax_proof_retention_years = 1 WHERE tenant_id = ${TENANT}::uuid`);
    }));
    expect(await purgeTenantProofs(msg, { now: new Date("2030-01-01T00:00:00Z") })).toMatchObject({ purged: 1 });
    expect(await proof(a.id)).toBeUndefined();
  });

  it("a failed object delete keeps the row (no orphaned record) and the next run finishes the job", async () => {
    await runWithTenant(TENANT, () => db.transaction(async (tx) => {
      await tx.execute(sql`DELETE FROM payroll.payroll_settings WHERE tenant_id = ${TENANT}::uuid`);
    }));
    const s = await seedProof({ fy: "2010-11", status: "accepted" });
    const msg = { tenantId: TENANT, actorId: "00000000-0000-0000-0000-000000000099", correlationId: randomUUID() };
    H.failDelete.add(s.key);
    expect(await purgeTenantProofs(msg, { now: new Date("2030-01-01T00:00:00Z") })).toMatchObject({ purged: 0, failed: 1 });
    expect(await proof(s.id)).toBeDefined();
    H.failDelete.delete(s.key);
    expect(await purgeTenantProofs(msg, { now: new Date("2030-01-01T00:00:00Z") })).toMatchObject({ purged: 1 });
    expect(await proof(s.id)).toBeUndefined();
  });

  it("the scheduler finds tenants with purge-due rows across tenants and publishes one command each", async () => {
    await seedProof({ tenant: OTHER_TENANT, fy: "2005-06", status: "accepted" });
    const published = await publishDuePurges(new Date("2030-01-01T00:00:00Z"));
    expect(published).toBeGreaterThanOrEqual(1);
    await settle();
    expect((await q(sql`SELECT count(*)::int AS n FROM payroll.tax_proofs WHERE fy = '2005-06'`, OTHER_TENANT))[0]!.n).toBe(0);
  });
});
