/**
 * DM-002 — document type / mandatory-document / expiry route integration tests.
 *
 * Covers every endpoint (happy + 400 + 401 + 403 + 404 + 409 + 422), the
 * compliance report, and the expiry scan including its idempotency: a second
 * scan must not re-emit an alert for a document already in the right status.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";

const { buildApp } = await import("../src/app.js");
const { sqlClient } = await import("../src/shared/db.js");
const { queue } = await import("../src/shared/infra.js");
const { registerAllF3Consumers } = await import("./helpers/register-all-f3-consumers.js");

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";

const T_MAIN = "d0000000-0000-4000-8000-0000000000e1";
const T_SCAN = "d0000000-0000-4000-8000-0000000000e2";
const T_ALT = "d0000000-0000-4000-8000-0000000000e3";
const TENANTS = [T_MAIN, T_SCAN, T_ALT];
const ACTOR = "d0111111-0000-4000-8000-000000000001";
const MISSING_ID = "d0999999-0000-4000-8000-000000000099";

const DAY = 24 * 60 * 60_000;

function auth(roles: string[] = ["tenant_admin"], tenantId = T_MAIN): { authorization: string } {
  return { authorization: `Bearer ${signToken({ sub: ACTOR, tid: tenantId, roles, sid: "sess-dm2" }, SECRET, 3600)}` };
}

function asTenant<T>(tenantId: string, run: (sql: typeof sqlClient) => Promise<T>): Promise<T> {
  return sqlClient.begin(async (sql) => {
    await sql`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
    return run(sql as typeof sqlClient);
  }) as Promise<T>;
}

async function wipe(): Promise<void> {
  for (const t of TENANTS) {
    await asTenant(t, async (sql) => {
      await sql`DELETE FROM uploads.documents WHERE tenant_id = ${t}`;
      await sql`DELETE FROM uploads.document_requirements WHERE tenant_id = ${t}`;
      await sql`DELETE FROM uploads.document_types WHERE tenant_id = ${t}`;
    });
  }
}

let app: FastifyInstance;
beforeAll(async () => {
  // F3 CONSUMER WIRING — this suite's app comes from src/app.ts alone; the
  // uploads/doc-governance F3 consumer (and the rest of worker.ts's set) is
  // never registered against this test's in-memory Queue singleton, so
  // every write here (createType, register, approve, expiry-scan) publishes
  // a command that nothing ever applies. Registering the full worker.ts
  // consumer set here so writes actually land — same pattern as
  // tests/integration-settings-ssrf.test.ts / tests/security-incident.test.ts.
  registerAllF3Consumers(queue);
  await queue.start();
  app = await buildApp();
  await wipe();
});
afterAll(async () => { await wipe(); await app.close(); await queue.stop(); await sqlClient.end(); });

interface SingleBody<T> { data: T }
interface ListBody<T> { data: T[]; meta: { page: number; pageSize: number; total: number } }
interface ErrBody { error: { code: string; message: string; correlationId: string; details?: Record<string, string> } }

interface DocType {
  id: string; code: string; name: string; category: string; allowedExtensions: string[];
  maxSizeMb: number; expiryRequired: boolean; expiryWarnDays: number; status: string; version: number;
}
interface Requirement { id: string; contextType: string; contextKey: string; documentTypeCode: string; mandatory: boolean; version: number }
interface Doc {
  id: string; documentTypeCode: string; contextType: string; contextKey: string; subjectId: string;
  storageKey: string; issuedAt: string | null; expiresAt: string | null; status: string;
  lastAlertAt: string | null; version: number;
}
interface Compliance {
  contextType: string; contextKey: string; compliant: boolean;
  missingCount: number; expiredCount: number; expiringCount: number;
  lines: Array<{ documentTypeCode: string; mandatory: boolean; outcome: string; daysRemaining: number | null }>;
}
interface ScanResult { scanned: number; expiring: number; expired: number; unchanged: number; horizon: string }

let seq = 0;
function nextCode(prefix: string): string {
  seq += 1;
  return `${prefix}-${seq}`;
}
const AT = (offsetMs: number): string => new Date(Date.now() + offsetMs).toISOString();

async function createType(over: Record<string, unknown> = {}, tenantId = T_MAIN): Promise<DocType> {
  const res = await app.inject({
    method: "POST", url: "/v1/admin/document-types", headers: auth(["tenant_admin"], tenantId),
    payload: { code: nextCode("type"), name: "A Type", ...over },
  });
  expect(res.statusCode).toBe(201);
  return (res.json() as SingleBody<DocType>).data;
}

async function registerDoc(over: Record<string, unknown>, tenantId = T_MAIN, roles = ["tenant_admin"]): Promise<Doc> {
  const res = await app.inject({
    method: "POST", url: "/v1/admin/documents", headers: auth(roles, tenantId),
    payload: {
      contextType: "employee_onboarding", contextKey: "emp-1",
      storageKey: `tenant/${tenantId}/file.pdf`, ...over,
    },
  });
  expect(res.statusCode).toBe(201);
  return (res.json() as SingleBody<Doc>).data;
}

// ── auth ────────────────────────────────────────────────────────────────────

describe("document governance — authentication", () => {
  const cases: Array<[string, string, Record<string, unknown> | undefined]> = [
    ["POST", "/v1/admin/document-types", { code: "abc", name: "A" }],
    ["GET", "/v1/admin/document-types?limit=10", undefined],
    ["PATCH", `/v1/admin/document-types/${MISSING_ID}`, { expectedVersion: 1, name: "B" }],
    ["POST", "/v1/admin/document-requirements", { contextType: "ctx", contextKey: "k", documentTypeCode: "abc" }],
    ["GET", "/v1/admin/document-requirements?limit=10", undefined],
    ["POST", "/v1/admin/documents", { documentTypeCode: "abc", contextType: "ctx", contextKey: "k", storageKey: "a/b.pdf" }],
    ["GET", "/v1/admin/documents?limit=10", undefined],
    ["GET", "/v1/admin/documents/compliance?limit=10&contextType=ctx&contextKey=k", undefined],
    ["POST", "/v1/admin/documents/expiry-scan", {}],
  ];

  for (const [method, url, payload] of cases) {
    it(`401 without a token — ${method} ${url.split("?")[0] ?? url}`, async () => {
      const res = await app.inject({ method: method as "GET", url, ...(payload ? { payload } : {}) });
      expect(res.statusCode).toBe(401);
    });
    it(`403 for a role outside the module — ${method} ${url.split("?")[0] ?? url}`, async () => {
      const res = await app.inject({
        method: method as "GET", url, headers: auth(["citizen"]), ...(payload ? { payload } : {}),
      });
      expect(res.statusCode).toBe(403);
    });
  }

  it("403 for hr_officer on the admin-only write endpoints", async () => {
    for (const [url, payload] of [
      ["/v1/admin/document-types", { code: "abc", name: "A" }],
      ["/v1/admin/document-requirements", { contextType: "ctx", contextKey: "k", documentTypeCode: "abc" }],
      ["/v1/admin/documents/expiry-scan", {}],
    ] as Array<[string, Record<string, unknown>]>) {
      const res = await app.inject({ method: "POST", url, headers: auth(["hr_officer"]), payload });
      expect(res.statusCode).toBe(403);
    }
  });

  it("hr_officer CAN read types and register a document", async () => {
    const type = await createType({ allowedExtensions: ["pdf"] });
    const list = await app.inject({
      method: "GET", url: "/v1/admin/document-types?limit=10", headers: auth(["hr_officer"]),
    });
    expect(list.statusCode).toBe(200);
    const doc = await registerDoc({ documentTypeCode: type.code }, T_MAIN, ["hr_officer"]);
    expect(doc.status).toBe("active");
  });
});

// ── document types ─────────────────────────────────────────────────────────

describe("document types", () => {
  it("creates a type with defaults", async () => {
    const t = await createType();
    expect(t).toMatchObject({
      category: "document", allowedExtensions: [], maxSizeMb: 10,
      expiryRequired: false, expiryWarnDays: 30, status: "active", version: 1,
    });
  });

  it("creates a type with explicit expiry rules and extensions", async () => {
    const t = await createType({
      category: "licence", allowedExtensions: ["pdf", "jpg"], maxSizeMb: 25,
      expiryRequired: true, expiryWarnDays: 45,
    });
    expect(t).toMatchObject({
      category: "licence", allowedExtensions: ["pdf", "jpg"], maxSizeMb: 25,
      expiryRequired: true, expiryWarnDays: 45,
    });
  });

  it("409 TYPE_EXISTS on a duplicate code", async () => {
    const t = await createType();
    const res = await app.inject({
      method: "POST", url: "/v1/admin/document-types", headers: auth(),
      payload: { code: t.code, name: "Again" },
    });
    expect(res.statusCode).toBe(409);
    expect((res.json() as ErrBody).error.code).toBe("TYPE_EXISTS");
  });

  it("allows the same type code in a different tenant", async () => {
    const code = nextCode("shared");
    const a = await app.inject({
      method: "POST", url: "/v1/admin/document-types", headers: auth(["tenant_admin"], T_MAIN),
      payload: { code, name: "Main" },
    });
    expect(a.statusCode).toBe(201);
    const b = await app.inject({
      method: "POST", url: "/v1/admin/document-types", headers: auth(["tenant_admin"], T_ALT),
      payload: { code, name: "Alt" },
    });
    expect(b.statusCode).toBe(201);
  });

  it("400 for an unknown category", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/admin/document-types", headers: auth(),
      payload: { code: nextCode("cat"), name: "X", category: "hologram" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("400 for a code outside the identifier charset", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/admin/document-types", headers: auth(),
      payload: { code: "Bad Code", name: "X" },
    });
    expect(res.statusCode).toBe(400);
    expect((res.json() as ErrBody).error.details).toHaveProperty("code");
  });

  it("400 for maxSizeMb above the ceiling and expiryWarnDays out of range", async () => {
    const big = await app.inject({
      method: "POST", url: "/v1/admin/document-types", headers: auth(),
      payload: { code: nextCode("big"), name: "X", maxSizeMb: 201 },
    });
    expect(big.statusCode).toBe(400);
    const warn = await app.inject({
      method: "POST", url: "/v1/admin/document-types", headers: auth(),
      payload: { code: nextCode("warn"), name: "X", expiryWarnDays: 400 },
    });
    expect(warn.statusCode).toBe(400);
  });

  it("400 for an extension that is not lower-case alphanumeric", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/admin/document-types", headers: auth(),
      payload: { code: nextCode("ext"), name: "X", allowedExtensions: [".PDF"] },
    });
    expect(res.statusCode).toBe(400);
  });

  it("lists types with the list envelope and a status filter", async () => {
    const t = await createType();
    const res = await app.inject({ method: "GET", url: "/v1/admin/document-types?limit=200&status=active", headers: auth() });
    expect(res.statusCode).toBe(200);
    expect((res.json() as ListBody<DocType>).data.map((r) => r.code)).toContain(t.code);
  });

  it("400 without limit and 400 for an unknown status filter", async () => {
    expect((await app.inject({ method: "GET", url: "/v1/admin/document-types", headers: auth() })).statusCode).toBe(400);
    expect((await app.inject({
      method: "GET", url: "/v1/admin/document-types?limit=10&status=gone", headers: auth(),
    })).statusCode).toBe(400);
  });

  it("patches a type under an optimistic lock", async () => {
    const t = await createType();
    const res = await app.inject({
      method: "PATCH", url: `/v1/admin/document-types/${t.id}`, headers: auth(),
      payload: { expectedVersion: t.version, name: "Renamed", expiryWarnDays: 60 },
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as SingleBody<{ version: number }>).data.version).toBe(2);

    const list = await app.inject({ method: "GET", url: "/v1/admin/document-types?limit=200", headers: auth() });
    const found = (list.json() as ListBody<DocType>).data.find((r) => r.id === t.id);
    expect(found).toMatchObject({ name: "Renamed", expiryWarnDays: 60, version: 2 });
  });

  it("409 VERSION_CONFLICT on a stale patch", async () => {
    const t = await createType();
    const res = await app.inject({
      method: "PATCH", url: `/v1/admin/document-types/${t.id}`, headers: auth(),
      payload: { expectedVersion: t.version + 3, name: "Nope" },
    });
    expect(res.statusCode).toBe(409);
    expect((res.json() as ErrBody).error.code).toBe("VERSION_CONFLICT");
  });

  it("409 when the same expectedVersion is replayed after a successful patch", async () => {
    const t = await createType();
    await app.inject({
      method: "PATCH", url: `/v1/admin/document-types/${t.id}`, headers: auth(),
      payload: { expectedVersion: 1, name: "One" },
    });
    const again = await app.inject({
      method: "PATCH", url: `/v1/admin/document-types/${t.id}`, headers: auth(),
      payload: { expectedVersion: 1, name: "Two" },
    });
    expect(again.statusCode).toBe(409);
  });

  it("400 EMPTY_PATCH when no updatable field is supplied", async () => {
    const t = await createType();
    const res = await app.inject({
      method: "PATCH", url: `/v1/admin/document-types/${t.id}`, headers: auth(),
      payload: { expectedVersion: t.version },
    });
    expect(res.statusCode).toBe(400);
    expect((res.json() as ErrBody).error.code).toBe("EMPTY_PATCH");
  });

  it("404 patching an unknown type and 400 for a non-uuid id", async () => {
    const missing = await app.inject({
      method: "PATCH", url: `/v1/admin/document-types/${MISSING_ID}`, headers: auth(),
      payload: { expectedVersion: 1, name: "X" },
    });
    expect(missing.statusCode).toBe(404);
    const bad = await app.inject({
      method: "PATCH", url: "/v1/admin/document-types/nope", headers: auth(),
      payload: { expectedVersion: 1, name: "X" },
    });
    expect(bad.statusCode).toBe(400);
  });
});

// ── requirements ───────────────────────────────────────────────────────────

describe("document requirements", () => {
  it("marks a type mandatory for a context", async () => {
    const t = await createType();
    const res = await app.inject({
      method: "POST", url: "/v1/admin/document-requirements", headers: auth(),
      payload: { contextType: "employee_onboarding", contextKey: "grade-a", documentTypeCode: t.code },
    });
    expect(res.statusCode).toBe(201);
    expect((res.json() as SingleBody<Requirement>).data).toMatchObject({ mandatory: true, version: 1 });
  });

  it("upserts on (contextType, contextKey, typeCode), bumping the version", async () => {
    const t = await createType();
    const body = { contextType: "vendor_kyc", contextKey: "tier-1", documentTypeCode: t.code };
    const first = await app.inject({ method: "POST", url: "/v1/admin/document-requirements", headers: auth(), payload: body });
    const second = await app.inject({
      method: "POST", url: "/v1/admin/document-requirements", headers: auth(),
      payload: { ...body, mandatory: false },
    });
    expect(second.statusCode).toBe(201);
    const a = (first.json() as SingleBody<Requirement>).data;
    const b = (second.json() as SingleBody<Requirement>).data;
    expect(b.id).toBe(a.id);
    expect(b.mandatory).toBe(false);
    expect(b.version).toBe(2);
  });

  it("404 when the document type does not exist", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/admin/document-requirements", headers: auth(),
      payload: { contextType: "ctx_a", contextKey: "k", documentTypeCode: "no-such-type" },
    });
    expect(res.statusCode).toBe(404);
    expect((res.json() as ErrBody).error.code).toBe("NOT_FOUND");
  });

  it("422 DOCUMENT_TYPE_RETIRED for a retired type", async () => {
    const t = await createType();
    await app.inject({
      method: "PATCH", url: `/v1/admin/document-types/${t.id}`, headers: auth(),
      payload: { expectedVersion: t.version, status: "retired" },
    });
    const res = await app.inject({
      method: "POST", url: "/v1/admin/document-requirements", headers: auth(),
      payload: { contextType: "ctx_b", contextKey: "k", documentTypeCode: t.code },
    });
    expect(res.statusCode).toBe(422);
    expect((res.json() as ErrBody).error.code).toBe("DOCUMENT_TYPE_RETIRED");
  });

  it("400 for a contextType outside the allowed charset", async () => {
    const t = await createType();
    const res = await app.inject({
      method: "POST", url: "/v1/admin/document-requirements", headers: auth(),
      payload: { contextType: "Employee-Onboarding", contextKey: "k", documentTypeCode: t.code },
    });
    expect(res.statusCode).toBe(400);
  });

  it("400 when contextKey is empty", async () => {
    const t = await createType();
    const res = await app.inject({
      method: "POST", url: "/v1/admin/document-requirements", headers: auth(),
      payload: { contextType: "ctx_c", contextKey: "", documentTypeCode: t.code },
    });
    expect(res.statusCode).toBe(400);
  });

  it("lists requirements filtered by context", async () => {
    const t = await createType();
    await app.inject({
      method: "POST", url: "/v1/admin/document-requirements", headers: auth(),
      payload: { contextType: "listing_ctx", contextKey: "only", documentTypeCode: t.code },
    });
    const res = await app.inject({
      method: "GET", url: "/v1/admin/document-requirements?limit=50&contextType=listing_ctx&contextKey=only",
      headers: auth(),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as ListBody<Requirement>;
    expect(body.meta.total).toBe(1);
    expect(body.data[0]?.documentTypeCode).toBe(t.code);
  });

  it("400 without limit", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/admin/document-requirements", headers: auth() });
    expect(res.statusCode).toBe(400);
  });
});

// ── documents ──────────────────────────────────────────────────────────────

describe("documents", () => {
  it("registers a document with no expiry as active", async () => {
    const t = await createType();
    const doc = await registerDoc({ documentTypeCode: t.code });
    expect(doc.status).toBe("active");
    expect(doc.expiresAt).toBeNull();
    expect(doc.issuedAt).toBeNull();
  });

  it("classifies a far-off expiry as active on registration", async () => {
    const t = await createType({ expiryWarnDays: 30 });
    const doc = await registerDoc({ documentTypeCode: t.code, expiresAt: AT(200 * DAY) });
    expect(doc.status).toBe("active");
  });

  it("classifies an expiry inside the warning window as expiring on registration", async () => {
    const t = await createType({ expiryWarnDays: 30 });
    const doc = await registerDoc({ documentTypeCode: t.code, expiresAt: AT(10 * DAY) });
    expect(doc.status).toBe("expiring");
  });

  it("classifies an expiry later TODAY as expiring", async () => {
    const t = await createType({ expiryWarnDays: 30 });
    const doc = await registerDoc({ documentTypeCode: t.code, expiresAt: AT(60 * 60_000) });
    expect(doc.status).toBe("expiring");
  });

  it("classifies an already-past expiry as expired on registration", async () => {
    const t = await createType({ expiryWarnDays: 30 });
    const doc = await registerDoc({ documentTypeCode: t.code, expiresAt: AT(-1 * DAY) });
    expect(doc.status).toBe("expired");
  });

  it("stores an IST-offset expiry as the same instant (timestamptz)", async () => {
    const t = await createType({ expiryWarnDays: 30 });
    const instant = new Date(Date.now() + 200 * DAY);
    const ist = new Date(instant.getTime() + 5.5 * 60 * 60_000).toISOString().replace("Z", "+05:30");
    const doc = await registerDoc({ documentTypeCode: t.code, expiresAt: ist });
    expect(doc.expiresAt).toBe(instant.toISOString());
  });

  it("stores issuedAt when supplied", async () => {
    const t = await createType();
    const issued = AT(-30 * DAY);
    const doc = await registerDoc({ documentTypeCode: t.code, issuedAt: issued, expiresAt: AT(300 * DAY) });
    expect(doc.issuedAt).toBe(issued);
  });

  it("404 when the document type does not exist", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/admin/documents", headers: auth(),
      payload: { documentTypeCode: "ghost-type", contextType: "ctx_x", contextKey: "k", storageKey: "a/b.pdf" },
    });
    expect(res.statusCode).toBe(404);
  });

  it("422 DOCUMENT_TYPE_RETIRED for a retired type", async () => {
    const t = await createType();
    await app.inject({
      method: "PATCH", url: `/v1/admin/document-types/${t.id}`, headers: auth(),
      payload: { expectedVersion: t.version, status: "retired" },
    });
    const res = await app.inject({
      method: "POST", url: "/v1/admin/documents", headers: auth(),
      payload: { documentTypeCode: t.code, contextType: "ctx_y", contextKey: "k", storageKey: "a/b.pdf" },
    });
    expect(res.statusCode).toBe(422);
    expect((res.json() as ErrBody).error.code).toBe("DOCUMENT_TYPE_RETIRED");
  });

  it("422 EXPIRY_REQUIRED when the type mandates an expiry and none is given", async () => {
    const t = await createType({ expiryRequired: true });
    const res = await app.inject({
      method: "POST", url: "/v1/admin/documents", headers: auth(),
      payload: { documentTypeCode: t.code, contextType: "ctx_z", contextKey: "k", storageKey: "a/b.pdf" },
    });
    expect(res.statusCode).toBe(422);
    expect((res.json() as ErrBody).error.code).toBe("EXPIRY_REQUIRED");
  });

  it("accepts a document for an expiry-required type when the expiry is present", async () => {
    const t = await createType({ expiryRequired: true });
    const doc = await registerDoc({ documentTypeCode: t.code, expiresAt: AT(365 * DAY) });
    expect(doc.expiresAt).not.toBeNull();
  });

  it("422 INVALID_EXPIRY when expiry is not after issue", async () => {
    const t = await createType();
    const stamp = AT(10 * DAY);
    const res = await app.inject({
      method: "POST", url: "/v1/admin/documents", headers: auth(),
      payload: {
        documentTypeCode: t.code, contextType: "ctx_i", contextKey: "k",
        storageKey: "a/b.pdf", issuedAt: stamp, expiresAt: stamp,
      },
    });
    expect(res.statusCode).toBe(422);
    expect((res.json() as ErrBody).error.code).toBe("INVALID_EXPIRY");
  });

  it("422 EXTENSION_NOT_ALLOWED when the storage key's extension is not permitted", async () => {
    const t = await createType({ allowedExtensions: ["pdf"] });
    const res = await app.inject({
      method: "POST", url: "/v1/admin/documents", headers: auth(),
      payload: { documentTypeCode: t.code, contextType: "ctx_e", contextKey: "k", storageKey: "a/b.exe" },
    });
    expect(res.statusCode).toBe(422);
    expect((res.json() as ErrBody).error.code).toBe("EXTENSION_NOT_ALLOWED");
  });

  it("accepts any extension when the type configures none", async () => {
    const t = await createType({ allowedExtensions: [] });
    const doc = await registerDoc({ documentTypeCode: t.code, storageKey: "a/b.anything" });
    expect(doc.storageKey).toBe("a/b.anything");
  });

  it("400 for a storage key shorter than the minimum", async () => {
    const t = await createType();
    const res = await app.inject({
      method: "POST", url: "/v1/admin/documents", headers: auth(),
      payload: { documentTypeCode: t.code, contextType: "ctx_s", contextKey: "k", storageKey: "a" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("400 for a malformed expiresAt", async () => {
    const t = await createType();
    const res = await app.inject({
      method: "POST", url: "/v1/admin/documents", headers: auth(),
      payload: { documentTypeCode: t.code, contextType: "ctx_m", contextKey: "k", storageKey: "a/b.pdf", expiresAt: "soon" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("400 when documentTypeCode is absent", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/admin/documents", headers: auth(),
      payload: { contextType: "ctx_n", contextKey: "k", storageKey: "a/b.pdf" },
    });
    expect(res.statusCode).toBe(400);
    expect((res.json() as ErrBody).error.details).toHaveProperty("documentTypeCode");
  });

  it("lists documents filtered by context, subject and status", async () => {
    const t = await createType({ expiryWarnDays: 30 });
    await registerDoc({ documentTypeCode: t.code, contextType: "list_ctx", contextKey: "one", subjectId: "s-1" });
    await registerDoc({
      documentTypeCode: t.code, contextType: "list_ctx", contextKey: "one",
      subjectId: "s-2", expiresAt: AT(-1 * DAY),
    });

    const all = await app.inject({
      method: "GET", url: "/v1/admin/documents?limit=50&contextType=list_ctx&contextKey=one", headers: auth(),
    });
    expect((all.json() as ListBody<Doc>).meta.total).toBe(2);

    const bySubject = await app.inject({
      method: "GET", url: "/v1/admin/documents?limit=50&contextType=list_ctx&subjectId=s-1", headers: auth(),
    });
    expect((bySubject.json() as ListBody<Doc>).meta.total).toBe(1);

    const byStatus = await app.inject({
      method: "GET", url: "/v1/admin/documents?limit=50&contextType=list_ctx&status=expired", headers: auth(),
    });
    expect((byStatus.json() as ListBody<Doc>).data.every((d) => d.status === "expired")).toBe(true);
  });

  it("400 for an unknown status filter and 400 without limit", async () => {
    expect((await app.inject({
      method: "GET", url: "/v1/admin/documents?limit=10&status=shredded", headers: auth(),
    })).statusCode).toBe(400);
    expect((await app.inject({ method: "GET", url: "/v1/admin/documents", headers: auth() })).statusCode).toBe(400);
  });

  it("does not list another tenant's documents", async () => {
    const t = await createType({}, T_ALT);
    await registerDoc({ documentTypeCode: t.code, contextType: "alt_ctx", contextKey: "k" }, T_ALT);
    const res = await app.inject({
      method: "GET", url: "/v1/admin/documents?limit=50&contextType=alt_ctx", headers: auth(["tenant_admin"], T_MAIN),
    });
    expect((res.json() as ListBody<Doc>).meta.total).toBe(0);
  });
});

// ── compliance ─────────────────────────────────────────────────────────────

describe("GET /v1/admin/documents/compliance", () => {
  it("404 NO_REQUIREMENTS for a context with nothing defined", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/admin/documents/compliance?limit=50&contextType=undefined_ctx&contextKey=k",
      headers: auth(),
    });
    expect(res.statusCode).toBe(404);
    expect((res.json() as ErrBody).error.code).toBe("NO_REQUIREMENTS");
  });

  it("reports a mandatory requirement with no document as missing and not compliant", async () => {
    const t = await createType();
    await app.inject({
      method: "POST", url: "/v1/admin/document-requirements", headers: auth(),
      payload: { contextType: "comp_missing", contextKey: "k", documentTypeCode: t.code },
    });
    const res = await app.inject({
      method: "GET", url: "/v1/admin/documents/compliance?limit=50&contextType=comp_missing&contextKey=k",
      headers: auth(),
    });
    expect(res.statusCode).toBe(200);
    const report = (res.json() as SingleBody<Compliance>).data;
    expect(report.compliant).toBe(false);
    expect(report.missingCount).toBe(1);
    expect(report.lines[0]).toMatchObject({ documentTypeCode: t.code, outcome: "missing", daysRemaining: null });
  });

  it("reports compliant once the mandatory document is held", async () => {
    const t = await createType();
    await app.inject({
      method: "POST", url: "/v1/admin/document-requirements", headers: auth(),
      payload: { contextType: "comp_ok", contextKey: "k", documentTypeCode: t.code },
    });
    await registerDoc({ documentTypeCode: t.code, contextType: "comp_ok", contextKey: "k" });
    const res = await app.inject({
      method: "GET", url: "/v1/admin/documents/compliance?limit=50&contextType=comp_ok&contextKey=k", headers: auth(),
    });
    const report = (res.json() as SingleBody<Compliance>).data;
    expect(report.compliant).toBe(true);
    expect(report.lines[0]?.outcome).toBe("satisfied");
  });

  it("an expiring mandatory document is compliant but flagged", async () => {
    const t = await createType({ expiryWarnDays: 30 });
    await app.inject({
      method: "POST", url: "/v1/admin/document-requirements", headers: auth(),
      payload: { contextType: "comp_expiring", contextKey: "k", documentTypeCode: t.code },
    });
    await registerDoc({
      documentTypeCode: t.code, contextType: "comp_expiring", contextKey: "k", expiresAt: AT(10 * DAY),
    });
    const res = await app.inject({
      method: "GET", url: "/v1/admin/documents/compliance?limit=50&contextType=comp_expiring&contextKey=k",
      headers: auth(),
    });
    const report = (res.json() as SingleBody<Compliance>).data;
    expect(report.compliant).toBe(true);
    expect(report.expiringCount).toBe(1);
    expect(report.lines[0]?.daysRemaining).toBe(9);
  });

  it("an expired mandatory document breaks compliance", async () => {
    const t = await createType({ expiryWarnDays: 30 });
    await app.inject({
      method: "POST", url: "/v1/admin/document-requirements", headers: auth(),
      payload: { contextType: "comp_expired", contextKey: "k", documentTypeCode: t.code },
    });
    await registerDoc({
      documentTypeCode: t.code, contextType: "comp_expired", contextKey: "k", expiresAt: AT(-5 * DAY),
    });
    const res = await app.inject({
      method: "GET", url: "/v1/admin/documents/compliance?limit=50&contextType=comp_expired&contextKey=k",
      headers: auth(),
    });
    const report = (res.json() as SingleBody<Compliance>).data;
    expect(report.compliant).toBe(false);
    expect(report.expiredCount).toBe(1);
  });

  it("scopes the report to one subject when subjectId is supplied", async () => {
    const t = await createType();
    await app.inject({
      method: "POST", url: "/v1/admin/document-requirements", headers: auth(),
      payload: { contextType: "comp_subject", contextKey: "k", documentTypeCode: t.code },
    });
    await registerDoc({ documentTypeCode: t.code, contextType: "comp_subject", contextKey: "k", subjectId: "has-it" });

    const held = await app.inject({
      method: "GET",
      url: "/v1/admin/documents/compliance?limit=50&contextType=comp_subject&contextKey=k&subjectId=has-it",
      headers: auth(),
    });
    expect((held.json() as SingleBody<Compliance>).data.compliant).toBe(true);

    const other = await app.inject({
      method: "GET",
      url: "/v1/admin/documents/compliance?limit=50&contextType=comp_subject&contextKey=k&subjectId=has-none",
      headers: auth(),
    });
    expect((other.json() as SingleBody<Compliance>).data.compliant).toBe(false);
  });

  it("an optional requirement left unmet does not break compliance", async () => {
    const t = await createType();
    await app.inject({
      method: "POST", url: "/v1/admin/document-requirements", headers: auth(),
      payload: { contextType: "comp_optional", contextKey: "k", documentTypeCode: t.code, mandatory: false },
    });
    const res = await app.inject({
      method: "GET", url: "/v1/admin/documents/compliance?limit=50&contextType=comp_optional&contextKey=k",
      headers: auth(),
    });
    const report = (res.json() as SingleBody<Compliance>).data;
    expect(report.compliant).toBe(true);
    expect(report.missingCount).toBe(1);
  });

  it("400 when contextType or limit is missing", async () => {
    const noCtx = await app.inject({
      method: "GET", url: "/v1/admin/documents/compliance?limit=10&contextKey=k", headers: auth(),
    });
    expect(noCtx.statusCode).toBe(400);
    const noLimit = await app.inject({
      method: "GET", url: "/v1/admin/documents/compliance?contextType=ctx_q&contextKey=k", headers: auth(),
    });
    expect(noLimit.statusCode).toBe(400);
  });
});

// ── expiry scan ────────────────────────────────────────────────────────────

describe("POST /v1/admin/documents/expiry-scan", () => {
  function scanAuth(): { authorization: string } {
    return auth(["tenant_admin"], T_SCAN);
  }

  async function scan(payload: Record<string, unknown> = {}): Promise<ScanResult> {
    const res = await app.inject({
      method: "POST", url: "/v1/admin/documents/expiry-scan", headers: scanAuth(), payload,
    });
    expect(res.statusCode).toBe(200);
    return (res.json() as SingleBody<ScanResult>).data;
  }

  function docRow(id: string): Promise<{ status: string; version: number; last_alert_at: Date | string | null } | undefined> {
    return asTenant(T_SCAN, async (sql) => {
      const rows = await sql<Array<{ status: string; version: number; last_alert_at: Date | string | null }>>`
        SELECT status, version, last_alert_at FROM uploads.documents WHERE id = ${id}`;
      return rows[0];
    });
  }

  function eventCount(topic: string, documentId: string): Promise<number> {
    return asTenant(T_SCAN, async (sql) => {
      const rows = await sql<Array<{ n: number }>>`
        SELECT count(*)::int AS n FROM _outbox.messages
        WHERE topic = ${topic} AND payload->>'documentId' = ${documentId}`;
      return rows[0]?.n ?? 0;
    });
  }

  it("returns a zero report when the tenant holds nothing to scan", async () => {
    const result = await scan();
    expect(result).toMatchObject({ scanned: 0, expiring: 0, expired: 0, unchanged: 0 });
    expect(typeof result.horizon).toBe("string");
  });

  it("moves an active document into `expiring` and publishes documentExpiring once", async () => {
    // Narrow window at registration keeps the document `active`...
    const type = await createType({ expiryWarnDays: 1 }, T_SCAN);
    const doc = await registerDoc({
      documentTypeCode: type.code, contextType: "scan_ctx", contextKey: "k", expiresAt: AT(10 * DAY),
    }, T_SCAN);
    expect(doc.status).toBe("active");

    // ...then widening it makes the same document due for an alert.
    const widened = await app.inject({
      method: "PATCH", url: `/v1/admin/document-types/${type.id}`, headers: scanAuth(),
      payload: { expectedVersion: type.version, expiryWarnDays: 30 },
    });
    expect(widened.statusCode).toBe(200);

    const first = await scan();
    expect(first.expiring).toBe(1);
    expect(first.scanned).toBeGreaterThanOrEqual(1);
    const after = await docRow(doc.id);
    expect(after?.status).toBe("expiring");
    expect(after?.version).toBe(doc.version + 1);
    expect(after?.last_alert_at).not.toBeNull();
    expect(await eventCount("admin.document.expiring", doc.id)).toBe(1);
  });

  it("a repeat scan leaves the document alone and does NOT re-alert", async () => {
    const type = await createType({ expiryWarnDays: 1 }, T_SCAN);
    const doc = await registerDoc({
      documentTypeCode: type.code, contextType: "scan_idem", contextKey: "k", expiresAt: AT(9 * DAY),
    }, T_SCAN);
    await app.inject({
      method: "PATCH", url: `/v1/admin/document-types/${type.id}`, headers: scanAuth(),
      payload: { expectedVersion: type.version, expiryWarnDays: 30 },
    });

    await scan();
    const afterFirst = await docRow(doc.id);
    expect(afterFirst?.status).toBe("expiring");
    expect(await eventCount("admin.document.expiring", doc.id)).toBe(1);

    const second = await scan();
    expect(second.unchanged).toBeGreaterThanOrEqual(1);
    const afterSecond = await docRow(doc.id);
    expect(afterSecond?.version).toBe(afterFirst?.version);
    expect(await eventCount("admin.document.expiring", doc.id)).toBe(1);
  });

  it("moves a lapsed document to `expired` and publishes documentExpired", async () => {
    const type = await createType({ expiryWarnDays: 30 }, T_SCAN);
    const doc = await registerDoc({
      documentTypeCode: type.code, contextType: "scan_expired", contextKey: "k", expiresAt: AT(5 * DAY),
    }, T_SCAN);
    expect(doc.status).toBe("expiring");

    // Time passes: the expiry date is now behind us.
    await asTenant(T_SCAN, (sql) => sql`
      UPDATE uploads.documents SET expires_at = now() - interval '2 days' WHERE id = ${doc.id}`);

    const result = await scan();
    expect(result.expired).toBeGreaterThanOrEqual(1);
    expect((await docRow(doc.id))?.status).toBe("expired");
    expect(await eventCount("admin.document.expired", doc.id)).toBe(1);
    expect(await eventCount("admin.document.expiring", doc.id)).toBe(0);
  });

  it("never scans a document with no expiry date", async () => {
    const type = await createType({ expiryWarnDays: 30 }, T_SCAN);
    const doc = await registerDoc({
      documentTypeCode: type.code, contextType: "scan_noexpiry", contextKey: "k",
    }, T_SCAN);
    await scan();
    const after = await docRow(doc.id);
    expect(after?.status).toBe("active");
    expect(after?.version).toBe(doc.version);
    expect(after?.last_alert_at).toBeNull();
  });

  it("leaves a superseded document alone even when its expiry has passed", async () => {
    const type = await createType({ expiryWarnDays: 30 }, T_SCAN);
    const doc = await registerDoc({
      documentTypeCode: type.code, contextType: "scan_superseded", contextKey: "k", expiresAt: AT(5 * DAY),
    }, T_SCAN);
    await asTenant(T_SCAN, (sql) => sql`
      UPDATE uploads.documents
      SET status = 'superseded', expires_at = now() - interval '10 days' WHERE id = ${doc.id}`);
    await scan();
    expect((await docRow(doc.id))?.status).toBe("superseded");
    expect(await eventCount("admin.document.expired", doc.id)).toBe(0);
  });

  it("does not touch a document expiring beyond the scan horizon", async () => {
    const type = await createType({ expiryWarnDays: 5 }, T_SCAN);
    const doc = await registerDoc({
      documentTypeCode: type.code, contextType: "scan_horizon", contextKey: "k", expiresAt: AT(900 * DAY),
    }, T_SCAN);
    await scan();
    const after = await docRow(doc.id);
    expect(after?.status).toBe("active");
    expect(after?.version).toBe(doc.version);
  });

  it("honours the scan limit", async () => {
    const result = await scan({ limit: 1 });
    expect(result.scanned).toBeLessThanOrEqual(1);
  });

  it("400 for a limit above the ceiling", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/admin/documents/expiry-scan", headers: scanAuth(), payload: { limit: 500 },
    });
    expect(res.statusCode).toBe(400);
  });

  it("400 for a non-numeric limit", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/admin/documents/expiry-scan", headers: scanAuth(), payload: { limit: "lots" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("does not scan another tenant's documents", async () => {
    const type = await createType({ expiryWarnDays: 30 }, T_ALT);
    const doc = await registerDoc({
      documentTypeCode: type.code, contextType: "other_scan", contextKey: "k", expiresAt: AT(3 * DAY),
    }, T_ALT);
    await asTenant(T_ALT, (sql) => sql`
      UPDATE uploads.documents SET expires_at = now() - interval '1 day', status = 'active' WHERE id = ${doc.id}`);

    await scan(); // as T_SCAN

    const rows = await asTenant(T_ALT, (sql) => sql<Array<{ status: string }>>`
      SELECT status FROM uploads.documents WHERE id = ${doc.id}`);
    expect(rows[0]?.status).toBe("active");
  });
});
