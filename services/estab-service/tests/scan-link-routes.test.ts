/** estab scan-link read routes — REAL Postgres via buildApp(): lookup exact vs fuzzy, tenant scope, role gating, list. */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import { runWithTenant } from "@civitasone/db";
import type { FastifyInstance } from "fastify";
import { vi } from "vitest";
import { queue } from "../src/shared/infra.js";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { estabFiles } from "../src/modules/files/schema.js";
import { estabFileOperator } from "../src/modules/operators/schema.js";
import { invalidateOperatorCache } from "../src/modules/operators/eligibility.js";
import { fileScannedDocuments } from "../src/modules/scan-link/schema.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
process.env.INTERNAL_SERVICE_SECRET = process.env.INTERNAL_SERVICE_SECRET ?? "scan_link_test_internal_secret_32chars";
const SERVICE_SECRET = process.env.INTERNAL_SERVICE_SECRET as string;
const TA = "5ca00002-0000-4000-8000-00000000000a";
const TB = "5ca00002-0000-4000-8000-00000000000b";
const USER = "5ca00002-0000-4000-8000-0000000000a1";
const BATCH = "5ca00002-0000-4000-8000-0000000000b1";
const hdr = (roles: string[], tenant = TA) => ({
  "x-tenant-id": tenant, // the gateway sets this; the tenant-aware db wrapper reads it for the RLS GUC
  authorization: `Bearer ${signToken({ sub: USER, tid: tenant, roles, sid: "sess-scan-routes" }, SECRET, 3600)}`,
});

/** The service principal document-service sends: x-internal + x-tenant-id + x-service-secret (what the auth plugin elevates to actorType service_account). */
const internalHdr = (tenant = TA) => ({ "x-internal": "1", "x-tenant-id": tenant, "x-service-secret": SERVICE_SECRET });

let app: FastifyInstance;
const ids: Record<string, string> = {};

async function seed(tenant: string, key: string, fileNo: string, subject: string, over: Partial<typeof estabFiles.$inferInsert> = {}) {
  const id = randomUUID();
  ids[key] = id;
  await runWithTenant(tenant, () => db.transaction((tx) => tx.insert(estabFiles).values({
    id, tenantId: tenant, fileNo, subject, dept: "EST", currentWith: USER, status: "active", classification: "public",
    createdBy: USER, updatedBy: USER, ...over,
  })));
}

beforeAll(async () => {
  app = await buildApp();
  await seed(TA, "exact", "ROUTE/2026/0001", "Purchase of office furniture for section A");
  await seed(TA, "fuzzy", "ROUTE/2026/0002", "Office furniture purchase proposal");
  await seed(TA, "closed", "ROUTE/2026/0003", "Furniture purchase archive", { status: "closed" });
  await seed(TA, "secret", "ROUTE/2026/0004", "Furniture purchase confidential", { classification: "secret" });
  await seed(TB, "other", "ROUTE/2026/0001", "Purchase of office furniture for section A");
  for (let i = 0; i < 12; i++) await seed(TA, "bulk" + i, `ROUTE/BULK/${i}`, "Quarterly stationery review meeting notes");
  await runWithTenant(TA, () => db.transaction((tx) => tx.insert(fileScannedDocuments).values([
    { tenantId: TA, fileId: ids.exact!, documentId: randomUUID(), batchId: BATCH, fileName: "a.pdf", docType: "letter", pageCount: 2, ocrConfidence: "0.9100", piiFlags: ["pan"], textPreviewMasked: "masked", linkId: randomUUID(), linkedBy: USER, filedAt: new Date("2026-10-01T00:00:00Z"), createdBy: USER, updatedBy: USER },
    { tenantId: TA, fileId: ids.exact!, documentId: randomUUID(), batchId: BATCH, fileName: "b.pdf", docType: "office_order", pageCount: 1, linkId: randomUUID(), linkedBy: USER, state: "unlinked", unlinkReason: "wrong file", filedAt: new Date("2026-10-02T00:00:00Z"), createdBy: USER, updatedBy: USER },
  ])));
});

afterAll(async () => {
  for (const t of [TA, TB]) {
    await runWithTenant(t, () => db.transaction(async (tx) => {
      await tx.delete(fileScannedDocuments).where(eq(fileScannedDocuments.tenantId, t));
      await tx.delete(estabFiles).where(eq(estabFiles.tenantId, t));
    }));
  }
  await app.close();
  await sqlClient.end();
});

// `as` omitted = the internal service principal; an array = a USER token carrying those roles (must always be 403).
const lookup = (q: string, as?: string[], tenant = TA) =>
  app.inject({ method: "GET", url: `/internal/v1/scan-link/lookup?${q}`, headers: as ? hdr(as, tenant) : internalHdr(tenant) });

describe("GET /internal/v1/scan-link/lookup", () => {
  it("exact file number scores 1.0 and ranks first; fuzzy subject matches score lower", async () => {
    const res = await lookup("fileNo=ROUTE/2026/0001&subject=office%20furniture%20purchase");
    expect(res.statusCode).toBe(200);
    const data = res.json().data as Array<{ targetId: string; confidence: number; target: string; reference: string }>;
    expect(data[0]).toMatchObject({ targetId: ids.exact, confidence: 1, target: "eoffice_file", reference: "ROUTE/2026/0001" });
    const fuzzy = data.find((c) => c.targetId === ids.fuzzy)!;
    expect(fuzzy.confidence).toBeGreaterThan(0);
    expect(fuzzy.confidence).toBeLessThan(1);
  });

  it("subject-only query never returns confidence 1; marks closed files", async () => {
    const res = await lookup("subject=furniture%20purchase");
    const data = res.json().data as Array<{ targetId: string; confidence: number; label: string }>;
    expect(data.length).toBeGreaterThan(0);
    expect(data.every((c) => c.confidence < 1)).toBe(true);
    expect(data.find((c) => c.targetId === ids.closed)?.label).toMatch(/\[closed\]$/);
  });

  it("is tenant scoped: tenant B's identically-numbered file is never returned to tenant A (and vice versa)", async () => {
    const a = (await lookup("fileNo=ROUTE/2026/0001")).json().data as Array<{ targetId: string }>;
    expect(a.map((c) => c.targetId)).toEqual([ids.exact]);
    const b = (await lookup("fileNo=ROUTE/2026/0001", undefined, TB)).json().data as Array<{ targetId: string }>;
    expect(b.map((c) => c.targetId)).toEqual([ids.other]);
  });

  it("never offers secret/top-secret files", async () => {
    const data = (await lookup("fileNo=ROUTE/2026/0004&subject=furniture%20purchase%20confidential")).json().data as Array<{ targetId: string }>;
    expect(data.map((c) => c.targetId)).not.toContain(ids.secret);
  });

  it("caps at 10 candidates", async () => {
    const data = (await lookup("subject=quarterly%20stationery%20review")).json().data as unknown[];
    expect(data).toHaveLength(10);
  });

  it("treats LIKE wildcards literally", async () => {
    const data = (await lookup("fileNo=%25%25%25%25")).json().data as unknown[];
    expect(data).toHaveLength(0);
  });

  it("requires fileNo or subject (400)", async () => {
    expect((await lookup("")).statusCode).toBe(400);
  });

  it("service-account only: the internal principal gets 200; EVERY user token (incl. super_admin, estab roles, document_admin, even one carrying a service_account role) gets 403; bad secret 401; anonymous 401", async () => {
    expect((await lookup("fileNo=ROUTE/2026/0001")).statusCode).toBe(200);
    for (const r of ["estab_officer", "estab_admin", "estab_deputy_secretary", "audit_officer", "document_admin", "super_admin", "service_account", "citizen", "hr_officer", "document_user"]) {
      expect((await lookup("fileNo=ROUTE/2026/0001", [r])).statusCode, r).toBe(403);
    }
    const badSecret = await app.inject({ method: "GET", url: "/internal/v1/scan-link/lookup?fileNo=x", headers: { ...internalHdr(), "x-service-secret": "wrong" } });
    expect(badSecret.statusCode).toBe(401);
    const anon = await app.inject({ method: "GET", url: "/internal/v1/scan-link/lookup?fileNo=x" });
    expect(anon.statusCode).toBe(401);
  });
});

describe("GET /v1/estab/files/:id/scanned-documents", () => {
  const list = (id: string, q = "", roles = ["estab_officer"], tenant = TA) =>
    app.inject({ method: "GET", url: `/v1/estab/files/${id}/scanned-documents${q}`, headers: hdr(roles, tenant) });

  it("lists linked documents by default, masked metadata only", async () => {
    const res = await list(ids.exact!);
    expect(res.statusCode).toBe(200);
    const data = res.json().data as Array<Record<string, unknown>>;
    expect(data).toHaveLength(1);
    expect(data[0]).toMatchObject({ fileName: "a.pdf", docType: "letter", pageCount: 2, ocrConfidence: 0.91, piiFlags: ["pan"], state: "linked" });
    expect(data[0]).not.toHaveProperty("tenantId");
  });

  it("state=all includes unlinked with the reason", async () => {
    const data = (await list(ids.exact!, "?state=all")).json().data as Array<{ state: string; unlinkReason: string | null }>;
    expect(data.map((d) => d.state).sort()).toEqual(["linked", "unlinked"]);
    expect(data.find((d) => d.state === "unlinked")?.unlinkReason).toBe("wrong file");
  });

  it("empty file returns an empty list (200), unknown/other-tenant file is 404", async () => {
    expect((await list(ids.fuzzy!)).json().data).toEqual([]);
    expect((await list(ids.other!)).statusCode).toBe(404);
    expect((await list(randomUUID())).statusCode).toBe(404);
  });

  it("uses the same roles that can view a file (estab roles + audit_officer); others get 403", async () => {
    for (const r of ["estab_officer", "estab_admin", "estab_deputy_secretary", "audit_officer", "super_admin"]) {
      expect((await list(ids.exact!, "", [r])).statusCode, r).toBe(200);
    }
    for (const r of ["citizen", "document_admin", "hr_officer"]) {
      expect((await list(ids.exact!, "", [r])).statusCode, r).toBe(403);
    }
  });

  it("rejects a bad id and a bad state (400)", async () => {
    expect((await list("not-a-uuid")).statusCode).toBe(400);
    expect((await list(ids.exact!, "?state=bogus")).statusCode).toBe(400);
  });
});

describe("audit-on-read (DPDP)", () => {
  const url = (id: string) => `/v1/estab/files/${id}/scanned-documents`;
  const auditCalls = (spy: { mock: { calls: unknown[][] } }) =>
    spy.mock.calls.filter((c) => c[0] === "audit.event.record").map((c) => c[1] as Record<string, unknown>);

  it("a successful view emits exactly one audit event with only actor, file, document ids, purpose and route", async () => {
    const spy = vi.spyOn(queue, "publish");
    const res = await app.inject({ method: "GET", url: url(ids.exact!), headers: hdr(["estab_officer"]) });
    expect(res.statusCode).toBe(200);
    const events = auditCalls(spy);
    expect(events).toHaveLength(1);
    const e = events[0]!;
    expect(e.actorId).toBe(USER);
    expect(e.payload).toEqual({
      service: "estab", action: "view_scanned_documents", purpose: "view_scanned_documents",
      resourceType: "file", resourceId: ids.exact, outcome: "success",
      route: "GET /v1/estab/files/:id/scanned-documents",
      documentIds: [(res.json().data as Array<{ documentId: string }>)[0]!.documentId],
    });
    expect(JSON.stringify(e)).not.toMatch(/a\.pdf|masked/);
    spy.mockRestore();
  });

  it("403 and 404 emit no view audit event", async () => {
    const spy = vi.spyOn(queue, "publish");
    expect((await app.inject({ method: "GET", url: url(ids.exact!), headers: hdr(["citizen"]) })).statusCode).toBe(403);
    expect((await app.inject({ method: "GET", url: url(randomUUID()), headers: hdr(["estab_officer"]) })).statusCode).toBe(404);
    expect(auditCalls(spy).filter((e) => (e.payload as { action: string }).action === "view_scanned_documents")).toHaveLength(0);
    spy.mockRestore();
  });
});

describe("GET /internal/v1/scan-link/clearance", () => {
  const TC = "5ca00002-0000-4000-8000-00000000000c"; // own tenant: enrolling operators flips the tenant to the operator model
  const CLEARED = "5ca00002-0000-4000-8000-0000000000c1";
  const LOW = "5ca00002-0000-4000-8000-0000000000c2";
  const NOOP = "5ca00002-0000-4000-8000-0000000000c3";
  let secretFile = "";
  const check = (o: { fileId: string; userId: string; roles?: string; tenant?: string; as?: string[] }) =>
    app.inject({
      method: "GET",
      url: `/internal/v1/scan-link/clearance?fileId=${o.fileId}&userId=${o.userId}&roles=${o.roles ?? "estab_officer"}`,
      headers: o.as ? hdr(o.as, o.tenant ?? TC) : internalHdr(o.tenant ?? TC),
    });
  const verdict = async (r: Awaited<ReturnType<typeof check>>) => r.json().data as { allowed: boolean; reason: string | null };

  beforeAll(async () => {
    secretFile = randomUUID();
    await runWithTenant(TC, () => db.transaction(async (tx) => {
      await tx.insert(estabFiles).values({ id: secretFile, tenantId: TC, fileNo: "CLR/1", subject: "classified", dept: "EST", currentWith: USER, status: "active", classification: "secret", createdBy: USER, updatedBy: USER });
      await tx.insert(estabFileOperator).values([
        { tenantId: TC, employeeId: CLEARED, division: "D", clearanceLevel: 3, assignedBy: USER, createdBy: USER, updatedBy: USER },
        { tenantId: TC, employeeId: LOW, division: "D", clearanceLevel: 1, assignedBy: USER, createdBy: USER, updatedBy: USER },
      ]);
    }));
    await invalidateOperatorCache(TC, CLEARED);
    await invalidateOperatorCache(TC, LOW);
  });
  afterAll(async () => {
    await runWithTenant(TC, () => db.transaction(async (tx) => {
      await tx.delete(estabFileOperator).where(eq(estabFileOperator.tenantId, TC));
      await tx.delete(estabFiles).where(eq(estabFiles.tenantId, TC));
    }));
  });

  it("classified file: insufficient clearance => allowed:false CLASSIFIED; cleared => true (same rule as file detail)", async () => {
    expect(await verdict(await check({ fileId: secretFile, userId: LOW }))).toEqual({ allowed: false, reason: "CLASSIFIED" });
    expect(await verdict(await check({ fileId: secretFile, userId: NOOP }))).toEqual({ allowed: false, reason: "CLASSIFIED" });
    expect(await verdict(await check({ fileId: secretFile, userId: CLEARED }))).toEqual({ allowed: true, reason: null });
  });

  it("insufficient ROLES (no estab reader role) => allowed:false even for a cleared user", async () => {
    expect(await verdict(await check({ fileId: secretFile, userId: CLEARED, roles: "citizen,hr_officer" }))).toEqual({ allowed: false, reason: "FORBIDDEN_ROLE" });
    expect(await verdict(await check({ fileId: secretFile, userId: CLEARED, roles: "" }))).toMatchObject({ allowed: false });
    expect((await verdict(await check({ fileId: secretFile, userId: CLEARED, roles: "audit_officer,citizen" }))).allowed).toBe(true);
  });

  it("reclassification flips the verdict immediately", async () => {
    const id = randomUUID();
    await runWithTenant(TC, () => db.transaction((tx) => tx.insert(estabFiles).values({ id, tenantId: TC, fileNo: "CLR/2", subject: "flip", dept: "EST", currentWith: USER, status: "active", classification: "public", createdBy: USER, updatedBy: USER })));
    expect((await verdict(await check({ fileId: id, userId: LOW }))).allowed).toBe(true);
    await runWithTenant(TC, () => db.transaction((tx) => tx.update(estabFiles).set({ classification: "top_secret" }).where(eq(estabFiles.id, id))));
    expect(await verdict(await check({ fileId: id, userId: LOW }))).toEqual({ allowed: false, reason: "CLASSIFIED" });
    expect(await verdict(await check({ fileId: id, userId: CLEARED }))).toEqual({ allowed: false, reason: "CLASSIFIED" }); // level 3 < top_secret 4
  });

  it("unknown and other-tenant files => 200 allowed:false TARGET_NOT_FOUND", async () => {
    expect(await verdict(await check({ fileId: randomUUID(), userId: CLEARED }))).toEqual({ allowed: false, reason: "TARGET_NOT_FOUND" });
    expect(await verdict(await check({ fileId: ids.exact!, userId: CLEARED }))).toEqual({ allowed: false, reason: "TARGET_NOT_FOUND" }); // TA file, TC caller
  });

  it("bad params 400; user token 403; no token 401", async () => {
    expect((await check({ fileId: "nope", userId: CLEARED })).statusCode).toBe(400);
    expect((await check({ fileId: secretFile, userId: "nope" })).statusCode).toBe(400);
    for (const r of ["estab_officer", "estab_admin", "document_admin", "super_admin", "service_account"]) {
      expect((await check({ fileId: secretFile, userId: CLEARED, as: [r] })).statusCode, r).toBe(403);
    }
    const anon = await app.inject({ method: "GET", url: `/internal/v1/scan-link/clearance?fileId=${secretFile}&userId=${CLEARED}` });
    expect(anon.statusCode).toBe(401);
  });

  it("route stays read-only: only a denial audit is published, nothing for allowed", async () => {
    const spy = vi.spyOn(queue, "publish");
    await check({ fileId: secretFile, userId: CLEARED });
    expect(spy.mock.calls.filter((c) => c[0] === "audit.event.record")).toHaveLength(0);
    await check({ fileId: secretFile, userId: LOW });
    expect(spy.mock.calls.filter((c) => c[0] === "audit.event.record")).toHaveLength(1);
    spy.mockRestore();
  });
});
