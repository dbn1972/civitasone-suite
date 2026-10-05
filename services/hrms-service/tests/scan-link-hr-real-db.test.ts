/**
 * GAP-ADMIN-BULK-SCAN-02 (H-LINK-HR) -- real-Postgres suite for the hr_employee scan-link target:
 * link / reject / cross-tenant / idempotent redelivery / unlink / RLS isolation / lookup / role gating.
 * Runs against a disposable DB reached through DATABASE_URL (hrms_svc: NOSUPERUSER NOBYPASSRLS, so
 * FORCE RLS is genuinely enforced for every assertion below).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import type { FastifyInstance } from "fastify";
import type { MemoryQueue } from "@civitasone/queue";
import { signToken } from "@civitasone/auth";
import { runWithTenant } from "@civitasone/db";
import { LINK_TOPICS } from "@civitasone/scan-link";

process.env.INTERNAL_SERVICE_SECRET = process.env.INTERNAL_SERVICE_SECRET ?? "scan_link_internal_test_secret_32chars";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { registerScanLinkConsumers } from "../src/modules/employee/scan-link-consumer.js";

registerScanLinkConsumers(queue);
const drain = (): Promise<void> => (queue as unknown as MemoryQueue).drain();

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TA = "5ca11a00-0001-4000-8000-00000000000a";
const TB = "5ca11a00-0001-4000-8000-00000000000b";
const ACTOR = "5ca11a00-0001-4000-8000-0000000000a1";
const DEPT = { A: "5ca11a00-0002-4000-8000-00000000000a", B: "5ca11a00-0002-4000-8000-00000000000b" };
const DESG = { A: "5ca11a00-0003-4000-8000-00000000000a", B: "5ca11a00-0003-4000-8000-00000000000b" };
const EMP_A = "5ca11a00-0004-4000-8000-00000000000a";
const EMP_A2 = "5ca11a00-0004-4000-8000-0000000000a2";
const EMP_B = "5ca11a00-0004-4000-8000-00000000000b";
const auth = (roles: string[], tid = TA) => ({ authorization: `Bearer ${signToken({ sub: ACTOR, tid, roles, sid: "s" }, SECRET)}` });
const internalHeaders = (tid = TA) => ({ "x-internal": "1", "x-tenant-id": tid, "x-service-secret": process.env.INTERNAL_SERVICE_SECRET as string });

let app: FastifyInstance;
let db: postgres.Sql;

async function asTenant<T>(tid: string, fn: (tx: postgres.TransactionSql) => Promise<T>): Promise<T> {
  return db.begin(async (tx) => {
    await tx.unsafe(`select set_config('app.tenant_id', '${tid}', true)`);
    return fn(tx);
  });
}

function linkPayload(over: { linkId?: string; targetId?: string; documentId?: string; preview?: string | null } = {}) {
  return {
    linkId: over.linkId ?? randomUUID(),
    target: "hr_employee" as const,
    targetId: over.targetId ?? EMP_A,
    document: {
      documentId: over.documentId ?? randomUUID(), batchId: randomUUID(), fileName: "service-book-p1.pdf", mimeType: "application/pdf",
      docType: "service_book", pageCount: 3, ocrConfidence: 0.912, piiFlags: ["aadhaar"],
      textPreviewMasked: over.preview === undefined ? "Service book of XXXX XXXX 1234" : over.preview, filedAt: new Date().toISOString(),
    },
    requestedBy: ACTOR, approvedBy: randomUUID(),
  };
}

async function send(topic: string, tenantId: string, payload: unknown, messageId = randomUUID()): Promise<void> {
  await runWithTenant(tenantId, () => queue.publish(topic, {
    messageId, type: topic, tenantId, actorId: ACTOR, correlationId: randomUUID(), schemaVersion: "1.0", payload,
  } as never));
  await drain();
}
const sendLink = (tid: string, p: unknown, mid?: string) => send(LINK_TOPICS.request("hrms"), tid, p, mid);
const sendUnlink = (tid: string, p: unknown, mid?: string) => send(LINK_TOPICS.unlinkRequest("hrms"), tid, p, mid);

async function outbox(tid: string, topic: string, linkId?: string): Promise<Array<Record<string, unknown>>> {
  const rows = await asTenant(tid, (tx) => tx`SELECT payload FROM _outbox.messages WHERE tenant_id = ${tid} AND topic = ${topic} ORDER BY created_at`);
  const all = rows.map((r) => r.payload as Record<string, unknown>);
  return linkId ? all.filter((p) => p.linkId === linkId || (p.metadata as { linkId?: string } | undefined)?.linkId === linkId) : all;
}
const rowsFor = (tid: string, linkId: string) => asTenant(tid, (tx) => tx`SELECT * FROM employee.hrms_employee_scanned_documents WHERE tenant_id = ${tid} AND link_id = ${linkId}`);

async function seedTenant(tid: string, k: "A" | "B", emps: Array<{ id: string; no: string; name: string }>): Promise<void> {
  await asTenant(tid, async (tx) => {
    await tx`DELETE FROM employee.hrms_employee_scanned_documents WHERE tenant_id = ${tid}`;
    await tx`DELETE FROM employee.hrms_employees WHERE tenant_id = ${tid}`;
    await tx`DELETE FROM employee.hrms_designations WHERE tenant_id = ${tid}`;
    await tx`DELETE FROM employee.hrms_departments WHERE tenant_id = ${tid}`;
    await tx`INSERT INTO employee.hrms_departments (id, tenant_id, code, name, created_by, updated_by) VALUES (${DEPT[k]}, ${tid}, 'SL', 'Scan Link Dept', ${ACTOR}, ${ACTOR})`;
    await tx`INSERT INTO employee.hrms_designations (id, tenant_id, code, name, created_by, updated_by) VALUES (${DESG[k]}, ${tid}, 'SL', 'Scan Link Desg', ${ACTOR}, ${ACTOR})`;
    for (const e of emps) {
      await tx`INSERT INTO employee.hrms_employees (id, tenant_id, employee_no, full_name, department_id, designation_id, date_of_joining, created_by, updated_by)
               VALUES (${e.id}, ${tid}, ${e.no}, ${e.name}, ${DEPT[k]}, ${DESG[k]}, '2012-04-01', ${ACTOR}, ${ACTOR})`;
    }
  });
}

beforeAll(async () => {
  db = postgres(process.env.DATABASE_URL as string, { max: 4 });
  const [role] = await db<{ rolsuper: boolean; rolbypassrls: boolean }[]>`SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`;
  expect(role).toMatchObject({ rolsuper: false, rolbypassrls: false });
  await seedTenant(TA, "A", [
    { id: EMP_A, no: "EMP-0042", name: "Rajesh Kumar" },
    { id: EMP_A2, no: "EMP-0043", name: "Rajesh Kumar Singh" },
  ]);
  await seedTenant(TB, "B", [{ id: EMP_B, no: "EMP-0042", name: "Rajesh Kumar" }]);
  app = await buildApp();
});

afterAll(async () => {
  for (const [tid] of [[TA], [TB]]) {
    await asTenant(tid as string, async (tx) => {
      await tx`DELETE FROM employee.hrms_employee_scanned_documents WHERE tenant_id = ${tid as string}`;
      await tx`DELETE FROM employee.hrms_employees WHERE tenant_id = ${tid as string}`;
      await tx`DELETE FROM employee.hrms_designations WHERE tenant_id = ${tid as string}`;
      await tx`DELETE FROM employee.hrms_departments WHERE tenant_id = ${tid as string}`;
      await tx`DELETE FROM _outbox.messages WHERE tenant_id = ${tid as string}`;
    });
  }
  await app.close();
  await db.end({ timeout: 5 });
  await sqlClient.end();
});

describe("link request (consumer)", () => {
  it("happy path: row linked, audit outbox row without PII values, linked result event", async () => {
    const p = linkPayload();
    await sendLink(TA, p);
    const [row] = await rowsFor(TA, p.linkId);
    expect(row).toMatchObject({ employee_id: EMP_A, document_id: p.document.documentId, state: "linked", doc_type: "service_book", page_count: 3, pii_flags: ["aadhaar"] });
    expect(Number(row?.ocr_confidence)).toBeCloseTo(0.912, 3);
    const audits = await outbox(TA, "audit.event.record", p.linkId);
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ service: "hrms", action: "scan_link", resourceType: "employee", resourceId: EMP_A, outcome: "success" });
    const json = JSON.stringify(audits[0]);
    expect(json).not.toContain("Service book");      // no extracted text
    expect(json).not.toContain("1234");
    const results = await outbox(TA, "hrms.scan-link.result", p.linkId);
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ linkId: p.linkId, targetId: EMP_A, documentId: p.document.documentId, status: "linked", reason: null });
  });

  it("unknown employee id: rejected TARGET_NOT_FOUND, nothing inserted, failure audit", async () => {
    const p = linkPayload({ targetId: randomUUID() });
    await sendLink(TA, p);
    expect(await rowsFor(TA, p.linkId)).toHaveLength(0);
    const results = await outbox(TA, "hrms.scan-link.result", p.linkId);
    expect(results[0]).toMatchObject({ status: "rejected", reason: "TARGET_NOT_FOUND" });
    const audits = await outbox(TA, "audit.event.record", p.linkId);
    expect(audits[0]).toMatchObject({ action: "scan_link", outcome: "failure" });
  });

  it("maker == checker is rejected MAKER_CHECKER_VIOLATION: no row, failure audit, rejected result; approvedBy null (maker-checker off) still links", async () => {
    const p = { ...linkPayload(), approvedBy: ACTOR }; // requestedBy is ACTOR
    await sendLink(TA, p);
    expect(await rowsFor(TA, p.linkId)).toHaveLength(0);
    expect((await outbox(TA, "hrms.scan-link.result", p.linkId))[0]).toMatchObject({ status: "rejected", reason: "MAKER_CHECKER_VIOLATION" });
    expect((await outbox(TA, "audit.event.record", p.linkId))[0]).toMatchObject({ action: "scan_link", outcome: "failure", metadata: { reason: "MAKER_CHECKER_VIOLATION" } });
    const off = { ...linkPayload(), approvedBy: null };
    await sendLink(TA, off);
    expect(await rowsFor(TA, off.linkId)).toHaveLength(1);
  });

  it("non-uuid target id is rejected TARGET_NOT_FOUND (no SQL error)", async () => {
    const p = linkPayload({ targetId: "EMP-0042" });
    await sendLink(TA, p);
    expect((await outbox(TA, "hrms.scan-link.result", p.linkId))[0]).toMatchObject({ status: "rejected", reason: "TARGET_NOT_FOUND" });
  });

  it("cross-tenant: tenant B message naming tenant A's employee id is rejected and writes nothing", async () => {
    const p = linkPayload({ targetId: EMP_A });
    await sendLink(TB, p);
    expect(await rowsFor(TB, p.linkId)).toHaveLength(0);
    expect(await rowsFor(TA, p.linkId)).toHaveLength(0);
    expect((await outbox(TB, "hrms.scan-link.result", p.linkId))[0]).toMatchObject({ status: "rejected", reason: "TARGET_NOT_FOUND" });
  });

  it("idempotent: same messageId redelivered and same linkId re-sent with a new messageId both leave ONE row, ONE audit", async () => {
    const p = linkPayload();
    const mid = randomUUID();
    await sendLink(TA, p, mid);
    await sendLink(TA, p, mid);               // redelivery
    await sendLink(TA, p, randomUUID());      // re-publish by document-service
    expect(await rowsFor(TA, p.linkId)).toHaveLength(1);
    expect(await outbox(TA, "audit.event.record", p.linkId)).toHaveLength(1);
    const results = await outbox(TA, "hrms.scan-link.result", p.linkId);
    expect(results.map((r) => r.status)).toEqual(["linked", "linked"]);   // 2nd messageId re-answers; redelivery is silent
  });

  it("the same document cannot be actively linked to the same employee twice", async () => {
    const documentId = randomUUID();
    await sendLink(TA, linkPayload({ documentId }));
    const second = linkPayload({ documentId });
    await sendLink(TA, second);
    expect(await rowsFor(TA, second.linkId)).toHaveLength(0);
    expect((await outbox(TA, "hrms.scan-link.result", second.linkId))[0]).toMatchObject({ status: "rejected", reason: "DOCUMENT_ALREADY_LINKED" });
  });

  it("unsupported target kind is rejected without touching the table", async () => {
    const p = { ...linkPayload(), target: "finance_payment" as const };
    await sendLink(TA, p);
    expect(await rowsFor(TA, p.linkId)).toHaveLength(0);
    expect((await outbox(TA, "hrms.scan-link.result", p.linkId))[0]).toMatchObject({ status: "rejected", reason: "UNSUPPORTED_TARGET" });
  });
});

describe("unlink request (consumer)", () => {
  it("unlinks with a reason: soft state change, audited with the reason, unlinked result", async () => {
    const p = linkPayload();
    await sendLink(TA, p);
    const u = { linkId: p.linkId, target: "hr_employee" as const, targetId: EMP_A, documentId: p.document.documentId, reason: "Filed to wrong employee", requestedBy: ACTOR };
    await sendUnlink(TA, u);
    const [row] = await rowsFor(TA, p.linkId);
    expect(row).toMatchObject({ state: "unlinked", unlink_reason: "Filed to wrong employee", version: 2 });
    const audits = (await outbox(TA, "audit.event.record", p.linkId)).filter((a) => a.action === "scan_unlink");
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ resourceType: "employee", resourceId: EMP_A, outcome: "success" });
    expect((audits[0]?.metadata as { reason?: string }).reason).toBe("Filed to wrong employee");
    expect((await outbox(TA, "hrms.scan-link.unlink.result", p.linkId))[0]).toMatchObject({ status: "unlinked", documentId: p.document.documentId });
    // a re-send is idempotent: still unlinked, no second audit
    await sendUnlink(TA, u);
    expect((await outbox(TA, "audit.event.record", p.linkId)).filter((a) => a.action === "scan_unlink")).toHaveLength(1);
    // and the document can be linked again with a new link id
    const again = linkPayload({ documentId: p.document.documentId });
    await sendLink(TA, again);
    expect((await rowsFor(TA, again.linkId))[0]).toMatchObject({ state: "linked" });
  });

  it("unlink reason with Aadhaar + phone is stored masked in the table AND the audit payload; raw digits appear nowhere", async () => {
    const p = linkPayload();
    await sendLink(TA, p);
    await sendUnlink(TA, { linkId: p.linkId, target: "hr_employee", targetId: EMP_A, documentId: p.document.documentId, reason: "wrong person, aadhaar 1234 5678 9012 call 9876543210", requestedBy: ACTOR });
    const [row] = await rowsFor(TA, p.linkId);
    expect(row?.state).toBe("unlinked");
    const audit = (await outbox(TA, "audit.event.record", p.linkId)).find((a) => a.action === "scan_unlink");
    const blob = JSON.stringify(row) + JSON.stringify(audit);
    for (const raw of ["1234 5678 9012", "123456789012", "9876543210"]) expect(blob).not.toContain(raw);
    expect(row?.unlink_reason).toBe("wrong person, aadhaar XXXX XXXX 9012 call XXXXXX3210");   // scrubReasonText masks all but the last 4 digits
    expect((audit?.metadata as { reason: string }).reason).toBe(row?.unlink_reason);
  });

  it("reason shorter than 5 chars never unlinks (schema) and a whitespace-padded one is rejected REASON_REQUIRED", async () => {
    const p = linkPayload();
    await sendLink(TA, p);
    const base = { linkId: p.linkId, target: "hr_employee" as const, targetId: EMP_A, documentId: p.document.documentId, requestedBy: ACTOR };
    await sendUnlink(TA, { ...base, reason: "oops" });
    expect((await rowsFor(TA, p.linkId))[0]).toMatchObject({ state: "linked" });
    await sendUnlink(TA, { ...base, reason: "    a    " });
    expect((await rowsFor(TA, p.linkId))[0]).toMatchObject({ state: "linked" });
    expect((await outbox(TA, "hrms.scan-link.unlink.result", p.linkId))[0]).toMatchObject({ status: "rejected", reason: "REASON_REQUIRED" });
  });

  it("unknown link, or another tenant's link, is rejected LINK_NOT_FOUND", async () => {
    const p = linkPayload();
    await sendLink(TA, p);
    const u = { linkId: p.linkId, target: "hr_employee" as const, targetId: EMP_A, documentId: p.document.documentId, reason: "cross tenant attempt", requestedBy: ACTOR };
    await sendUnlink(TB, u);
    expect((await rowsFor(TA, p.linkId))[0]).toMatchObject({ state: "linked" });
    expect((await outbox(TB, "hrms.scan-link.unlink.result", p.linkId))[0]).toMatchObject({ status: "rejected", reason: "LINK_NOT_FOUND" });
  });
});

describe("RLS isolation (FORCE RLS, NOBYPASSRLS role)", () => {
  it("tenant B cannot read, update or insert into tenant A's scanned-document rows", async () => {
    const p = linkPayload();
    await sendLink(TA, p);
    expect((await asTenant(TA, (tx) => tx`SELECT count(*)::int AS n FROM employee.hrms_employee_scanned_documents`))[0]?.n).toBeGreaterThan(0);
    expect((await asTenant(TB, (tx) => tx`SELECT count(*)::int AS n FROM employee.hrms_employee_scanned_documents WHERE link_id = ${p.linkId}`))[0]?.n).toBe(0);
    const upd = await asTenant(TB, (tx) => tx`UPDATE employee.hrms_employee_scanned_documents SET state = 'unlinked', unlink_reason = 'hijack attempt' WHERE link_id = ${p.linkId}`);
    expect(upd.count).toBe(0);
    await expect(asTenant(TB, (tx) => tx`INSERT INTO employee.hrms_employee_scanned_documents
      (tenant_id, employee_id, document_id, batch_id, file_name, doc_type, link_id, linked_by, filed_at, created_by, updated_by)
      VALUES (${TA}, ${EMP_A}, ${randomUUID()}, ${randomUUID()}, 'x.pdf', 'other', ${randomUUID()}, ${ACTOR}, now(), ${ACTOR}, ${ACTOR})`)).rejects.toThrow(/row-level security/i);
    // no GUC at all: fail-closed, zero rows
    // (on a pooled connection that earlier SET LOCAL the GUC, the empty setting makes the policy raise instead of
    // returning rows -- also fail-closed; either way no row is ever visible)
    const noGuc = await db`SELECT count(*)::int AS n FROM employee.hrms_employee_scanned_documents`.then((r) => r[0]?.n ?? 0, () => 0);
    expect(noGuc).toBe(0);
  });

  it("table has RLS enabled AND forced", async () => {
    const [r] = await db<{ relrowsecurity: boolean; relforcerowsecurity: boolean }[]>`SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE oid = 'employee.hrms_employee_scanned_documents'::regclass`;
    expect(r).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
  });
});

describe("GET /internal/v1/scan-link/lookup", () => {
  const get = (qs: string, headers: Record<string, string> = internalHeaders()) => app.inject({ method: "GET", url: `/internal/v1/scan-link/lookup?${qs}`, headers });

  it("exact employee number -> confidence 1.0 first, tenant-scoped", async () => {
    const r = await get("employeeNo=emp-0042");
    expect(r.statusCode).toBe(200);
    const data = r.json().data as Array<{ targetId: string; confidence: number; label: string; target: string }>;
    expect(data).toHaveLength(1);
    expect(data[0]).toMatchObject({ target: "hr_employee", targetId: EMP_A, confidence: 1 });
    expect(data[0]?.label).toBe("EMP-0042 - Rajesh Kumar");
    // tenant B has the same employee number but must resolve to ITS employee
    const b = (await get("employeeNo=EMP-0042", internalHeaders(TB))).json().data as Array<{ targetId: string }>;
    expect(b.map((x) => x.targetId)).toEqual([EMP_B]);
  });

  it("name fuzzy match: lower confidence than exact, max 5, ranked, no extra PII fields", async () => {
    const r = await get("name=" + encodeURIComponent("rajesh kumar"));
    const data = r.json().data as Array<Record<string, unknown>>;
    expect(data.length).toBeGreaterThanOrEqual(2);
    expect(data[0]).toMatchObject({ targetId: EMP_A, confidence: 0.9 });
    expect(data[1]).toMatchObject({ targetId: EMP_A2, confidence: 0.7 });
    expect(data.every((d) => (d.confidence as number) < 1)).toBe(true);
    expect(Object.keys(data[0] as object).sort()).toEqual(["amountMinor", "confidence", "label", "reference", "target", "targetId"]);
    expect(data.length).toBeLessThanOrEqual(5);
  });

  it("employee number wins over a name that also matches; wildcard characters are matched literally", async () => {
    const both = (await get("employeeNo=EMP-0043&name=" + encodeURIComponent("Rajesh Kumar"))).json().data as Array<{ targetId: string; confidence: number }>;
    expect(both[0]).toMatchObject({ targetId: EMP_A2, confidence: 1 });
    expect((await get("name=" + encodeURIComponent("%%"))).json().data).toEqual([]);
  });

  it("requires a query param (400) and the service secret (401); an end-user role is 403", async () => {
    expect((await get("")).statusCode).toBe(400);
    expect((await get("employeeNo=EMP-0042", { ...internalHeaders(), "x-service-secret": "wrong" })).statusCode).toBe(401);
    expect((await get("employeeNo=EMP-0042", auth(["hr_admin"]))).statusCode).toBe(403);
  });

  it("service-account only: every USER token gets 403 (super_admin, hr roles, document_admin, even a service_account role claim); the internal principal gets 200", async () => {
    expect((await get("employeeNo=EMP-0042")).statusCode).toBe(200);
    for (const r of ["super_admin", "hr_admin", "hr_officer", "document_admin", "tenant_admin", "service_account"]) {
      expect((await get("employeeNo=EMP-0042", auth([r]))).statusCode, r).toBe(403);
    }
  });
});

describe("GET /v1/hrms/employees/:id/scanned-documents", () => {
  const url = (id: string, qs = "") => `/v1/hrms/employees/${id}/scanned-documents${qs}`;

  it("HR roles get masked metadata (preview re-masked at read); unlinked rows only on request", async () => {
    const p = linkPayload({ preview: "Contact 9876543210 PAN ABCDE1234F a@b.in" });
    await sendLink(TA, p);
    const r = await app.inject({ method: "GET", url: url(EMP_A), headers: auth(["hr_officer"]) });
    expect(r.statusCode).toBe(200);
    await drain();
    const viewed = (await outbox(TA, "audit.event.record")).filter((a) => a.action === "view_scanned_documents" && a.resourceId === EMP_A);
    expect(viewed).toHaveLength(1);
    expect(viewed[0]).toMatchObject({ service: "hrms", resourceType: "employee", outcome: "success" });
    const md = viewed[0]?.metadata as { purpose: string; documentIds: string[]; route: string };
    expect(Object.keys(md).sort()).toEqual(["documentIds", "purpose", "route"]);
    expect(md).toMatchObject({ purpose: "view_scanned_documents", route: "GET /v1/hrms/employees/:id/scanned-documents" });
    expect(md.documentIds).toContain(p.document.documentId);
    expect(JSON.stringify(viewed[0])).not.toContain("Contact");
    const body = r.json() as { data: Array<Record<string, unknown>>; total: number };
    const doc = body.data.find((d) => d.documentId === p.document.documentId);
    expect(doc).toMatchObject({ docType: "service_book", pageCount: 3, ocrConfidence: 0.912, state: "linked", piiFlags: ["aadhaar"] });
    expect(doc?.textPreviewMasked).toBe("Contact [phone] PAN [PAN] [email]");
    expect(Object.keys(doc as object)).not.toContain("linkedBy");
    await sendUnlink(TA, { linkId: p.linkId, target: "hr_employee", targetId: EMP_A, documentId: p.document.documentId, reason: "duplicate upload", requestedBy: ACTOR });
    const linkedOnly = (await app.inject({ method: "GET", url: url(EMP_A), headers: auth(["hr_admin"]) })).json().data as Array<{ documentId: string }>;
    expect(linkedOnly.some((d) => d.documentId === p.document.documentId)).toBe(false);
    const all = (await app.inject({ method: "GET", url: url(EMP_A, "?state=all"), headers: auth(["hr_admin"]) })).json().data as Array<{ documentId: string; unlinkReason: string | null }>;
    expect(all.find((d) => d.documentId === p.document.documentId)?.unlinkReason).toBe("duplicate upload");
  });

  it("403 / 404 / 400 emit no content-view audit event", async () => {
    const count = async () => (await outbox(TA, "audit.event.record")).filter((a) => a.action === "view_scanned_documents").length;
    await drain();
    const before = await count();
    await app.inject({ method: "GET", url: url(EMP_A), headers: auth(["manager"]) });
    await app.inject({ method: "GET", url: url(randomUUID()), headers: auth(["hr_admin"]) });
    await app.inject({ method: "GET", url: url("bad"), headers: auth(["hr_admin"]) });
    await drain();
    expect(await count()).toBe(before);
  });

  it("role gating: employee / manager / payroll -> 403, no token -> 401", async () => {
    for (const role of ["employee", "manager", "payroll_admin"]) {
      expect((await app.inject({ method: "GET", url: url(EMP_A), headers: auth([role]) })).statusCode).toBe(403);
    }
    expect((await app.inject({ method: "GET", url: url(EMP_A) })).statusCode).toBe(401);
    expect((await app.inject({ method: "GET", url: url(EMP_A), headers: auth(["super_admin"]) })).statusCode).toBe(200);
  });

  it("404 for an unknown employee and for another tenant's employee; 400 for a bad id", async () => {
    expect((await app.inject({ method: "GET", url: url(randomUUID()), headers: auth(["hr_admin"]) })).statusCode).toBe(404);
    expect((await app.inject({ method: "GET", url: url(EMP_B), headers: auth(["hr_admin"]) })).statusCode).toBe(404);
    expect((await app.inject({ method: "GET", url: url("not-a-uuid"), headers: auth(["hr_admin"]) })).statusCode).toBe(400);
  });

  it("tenant B HR cannot see tenant A's scanned docs even for tenant A's employee id", async () => {
    await sendLink(TA, linkPayload());
    const r = await app.inject({ method: "GET", url: url(EMP_A), headers: auth(["hr_admin"], TB) });
    expect(r.statusCode).toBe(404);
  });
});
