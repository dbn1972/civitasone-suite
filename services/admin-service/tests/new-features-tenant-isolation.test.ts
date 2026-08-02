/**
 * Cross-tenant isolation for the five BRD rows added in this sprint:
 *   WC-009 sandbox environments + masked refresh
 *   WC-010 configuration-as-artefact
 *   CR-MOB-01 mobile app performance monitoring
 *   ORG-07 department template clone
 *   DM-002 document types, mandatory documents, expiry alerting
 *
 * The per-module test files already cover happy paths, 400/401/403/404/409/422
 * and the domain branches. What they do NOT do behaviourally is prove that a
 * token minted for tenant A can neither READ nor MUTATE tenant B's rows. Every
 * table here is RLS-forced, but RLS is only the second line of defence: the
 * route's own `WHERE tenant_id = ctx.tenantId` is the first, and a route that
 * forgot it would still pass a single-tenant test suite.
 *
 * So each block below seeds a row as tenant A and then drives the SAME route
 * with a tenant B token, asserting 404 (never 200 with A's data, never a
 * successful write) and empty list totals. Cross-tenant reads and writes are
 * exercised separately, because a leak on the write path is the more dangerous
 * of the two.
 *
 * Real Postgres, real Fastify via app.inject(), no network.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";

const { buildApp } = await import("../src/app.js");
const { sqlClient } = await import("../src/shared/db.js");

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";

/** Distinct from every other test file's tenants — files run in parallel. */
const T_A = "15015000-0000-4000-8000-0000000000a1";
const T_B = "15015000-0000-4000-8000-0000000000b1";
const TENANTS = [T_A, T_B];

const A_MAKER = "15011111-0000-4000-8000-00000000000a";
const A_CHECKER = "15012222-0000-4000-8000-00000000000b";
const B_ACTOR = "15013333-0000-4000-8000-00000000000c";

function auth(
  actorId: string,
  tenantId: string,
  roles: string[] = ["tenant_admin"],
): { authorization: string } {
  return {
    authorization: `Bearer ${signToken({ sub: actorId, tid: tenantId, roles, sid: "sess-iso" }, SECRET, 3600)}`,
  };
}

const A = (): { authorization: string } => auth(A_MAKER, T_A);
const A2 = (): { authorization: string } => auth(A_CHECKER, T_A);
const B = (): { authorization: string } => auth(B_ACTOR, T_B);

/** Raw SQL with the RLS GUC set — admin_svc is NOBYPASSRLS. */
function asTenant<T>(tenantId: string, run: (sql: typeof sqlClient) => Promise<T>): Promise<T> {
  return sqlClient.begin(async (sql) => {
    await sql`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
    return run(sql as typeof sqlClient);
  }) as Promise<T>;
}

async function wipe(): Promise<void> {
  for (const t of TENANTS) {
    await asTenant(t, async (sql) => {
      await sql`DELETE FROM config.config_env_state WHERE tenant_id = ${t}`;
      await sql`DELETE FROM config.config_promotions WHERE tenant_id = ${t}`;
      await sql`DELETE FROM config.config_artefacts WHERE tenant_id = ${t}`;
      await sql`DELETE FROM sandbox.refresh_masked_fields WHERE tenant_id = ${t}`;
      await sql`DELETE FROM sandbox.refresh_jobs WHERE tenant_id = ${t}`;
      await sql`DELETE FROM sandbox.masking_rules WHERE tenant_id = ${t}`;
      await sql`DELETE FROM sandbox.sandbox_environments WHERE tenant_id = ${t}`;
      await sql`DELETE FROM health.mobile_screen_renders WHERE tenant_id = ${t}`;
      await sql`DELETE FROM health.mobile_telemetry_events WHERE tenant_id = ${t}`;
      await sql`DELETE FROM dept_template.department_instantiations WHERE tenant_id = ${t}`;
      await sql`DELETE FROM dept_template.department_templates WHERE tenant_id = ${t}`;
      await sql`DELETE FROM uploads.documents WHERE tenant_id = ${t}`;
      await sql`DELETE FROM uploads.document_requirements WHERE tenant_id = ${t}`;
      await sql`DELETE FROM uploads.document_types WHERE tenant_id = ${t}`;
    });
  }
}

let app: FastifyInstance;
beforeAll(async () => {
  app = await buildApp();
  await wipe();
});
afterAll(async () => {
  await wipe();
  await app.close();
  await sqlClient.end();
});

interface SingleBody<T> { data: T }
interface ListBody<T> { data: T[]; meta: { page: number; pageSize: number; total: number } }

function single<T>(res: { json: () => unknown }): T {
  return (res.json() as SingleBody<T>).data;
}
function list<T>(res: { json: () => unknown }): ListBody<T> {
  return res.json() as ListBody<T>;
}

const FUTURE_DAYS = (n: number): string => new Date(Date.now() + n * 86_400_000).toISOString();

// ── WC-009 sandbox ──────────────────────────────────────────────────────────

describe("WC-009 sandbox — cross-tenant isolation", () => {
  interface Sandbox { id: string; code: string; version: number }
  interface Job { id: string; version: number }

  let sandboxA: Sandbox;
  let jobA: Job;

  beforeAll(async () => {
    const created = await app.inject({
      method: "POST", url: "/v1/admin/sandboxes", headers: A(),
      payload: { code: "iso-sbx", name: "Isolation sandbox", sourceEnvironment: "production" },
    });
    expect(created.statusCode).toBe(201);
    sandboxA = single<Sandbox>(created);

    const job = await app.inject({
      method: "POST", url: `/v1/admin/sandboxes/${sandboxA.id}/refreshes`, headers: A(),
      payload: { requestedFields: [{ tableName: "citizens", fieldName: "aadhaar" }] },
    });
    expect(job.statusCode).toBe(201);
    jobA = single<Job>(job);
  });

  it("tenant B cannot read tenant A's sandbox by id", async () => {
    const res = await app.inject({ method: "GET", url: `/v1/admin/sandboxes/${sandboxA.id}`, headers: B() });
    expect(res.statusCode).toBe(404);
  });

  it("tenant A's sandbox does not appear in tenant B's list", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/admin/sandboxes?limit=200", headers: B() });
    expect(res.statusCode).toBe(200);
    expect(list<Sandbox>(res).meta.total).toBe(0);
  });

  it("tenant B cannot add a masking rule to tenant A's sandbox", async () => {
    const res = await app.inject({
      method: "POST", url: `/v1/admin/sandboxes/${sandboxA.id}/masking-rules`, headers: B(),
      payload: { tableName: "citizens", fieldName: "aadhaar", strategy: "preserve", justification: "leak attempt via foreign sandbox id" },
    });
    expect(res.statusCode).toBe(404);
  });

  it("tenant B cannot list tenant A's masking rules", async () => {
    const res = await app.inject({
      method: "GET", url: `/v1/admin/sandboxes/${sandboxA.id}/masking-rules?limit=200`, headers: B(),
    });
    expect(res.statusCode).toBe(404);
  });

  it("tenant B cannot request a refresh against tenant A's sandbox", async () => {
    const res = await app.inject({
      method: "POST", url: `/v1/admin/sandboxes/${sandboxA.id}/refreshes`, headers: B(),
      payload: { requestedFields: [{ tableName: "citizens", fieldName: "pan" }] },
    });
    expect(res.statusCode).toBe(404);
  });

  it("tenant B cannot read tenant A's refresh job", async () => {
    const res = await app.inject({ method: "GET", url: `/v1/admin/sandbox-refreshes/${jobA.id}`, headers: B() });
    expect(res.statusCode).toBe(404);
  });

  it("tenant B cannot APPROVE tenant A's refresh job", async () => {
    const res = await app.inject({
      method: "POST", url: `/v1/admin/sandbox-refreshes/${jobA.id}/approve`, headers: B(),
      payload: { expectedVersion: jobA.version },
    });
    expect(res.statusCode).toBe(404);

    // and the job is untouched from tenant A's point of view
    const still = await app.inject({ method: "GET", url: `/v1/admin/sandbox-refreshes/${jobA.id}`, headers: A() });
    expect(single<{ status: string; approvedBy: string | null }>(still).status).toBe("pending_approval");
    expect(single<{ approvedBy: string | null }>(still).approvedBy).toBeNull();
  });

  it("tenant B cannot REJECT tenant A's refresh job", async () => {
    const res = await app.inject({
      method: "POST", url: `/v1/admin/sandbox-refreshes/${jobA.id}/reject`, headers: B(),
      payload: { expectedVersion: jobA.version, reason: "cross-tenant reject attempt" },
    });
    expect(res.statusCode).toBe(404);
  });

  it("tenant B cannot read the masked-field record of tenant A's job", async () => {
    const res = await app.inject({
      method: "GET", url: `/v1/admin/sandbox-refreshes/${jobA.id}/masked-fields?limit=200`, headers: B(),
    });
    expect(res.statusCode).toBe(404);
  });

  it("tenant A's refresh job does not appear in tenant B's job list", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/admin/sandbox-refreshes?limit=200", headers: B() });
    expect(list<Job>(res).meta.total).toBe(0);
  });

  it("the same sandbox code is free in the other tenant", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/admin/sandboxes", headers: B(),
      payload: { code: "iso-sbx", name: "B's own sandbox", sourceEnvironment: "staging" },
    });
    expect(res.statusCode).toBe(201);
    expect(single<Sandbox>(res).id).not.toBe(sandboxA.id);
  });
});

// ── WC-010 config artefacts ─────────────────────────────────────────────────

describe("WC-010 config artefacts — cross-tenant isolation", () => {
  interface Artefact { id: string; artefactVersion: number }
  interface Promotion { id: string; version: number }

  const SET = "iso.app";
  let artefactA: Artefact;
  let promotionA: Promotion;

  beforeAll(async () => {
    const snap = await app.inject({
      method: "POST", url: "/v1/admin/config-artefacts", headers: A(),
      payload: { setKey: SET, entries: { featureX: true } },
    });
    expect(snap.statusCode).toBe(201);
    artefactA = single<Artefact>(snap);

    const promo = await app.inject({
      method: "POST", url: "/v1/admin/config-artefacts/promotions", headers: A(),
      payload: { setKey: SET, artefactVersion: artefactA.artefactVersion, targetEnv: "production" },
    });
    expect(promo.statusCode).toBe(201);
    promotionA = single<Promotion>(promo);
  });

  it("tenant B cannot read tenant A's artefact by id", async () => {
    const res = await app.inject({ method: "GET", url: `/v1/admin/config-artefacts/${artefactA.id}`, headers: B() });
    expect(res.statusCode).toBe(404);
  });

  it("tenant B cannot diff tenant A's set", async () => {
    const res = await app.inject({
      method: "GET", url: `/v1/admin/config-artefacts/diff?setKey=${SET}&fromVersion=1&toVersion=1`, headers: B(),
    });
    expect(res.statusCode).toBe(404);
  });

  it("tenant B cannot APPROVE tenant A's promotion", async () => {
    const res = await app.inject({
      method: "POST", url: `/v1/admin/config-artefacts/promotions/${promotionA.id}/approve`, headers: B(),
      payload: { expectedVersion: promotionA.version },
    });
    expect(res.statusCode).toBe(404);
  });

  it("tenant B cannot REJECT tenant A's promotion", async () => {
    const res = await app.inject({
      method: "POST", url: `/v1/admin/config-artefacts/promotions/${promotionA.id}/reject`, headers: B(),
      payload: { expectedVersion: promotionA.version, reason: "cross-tenant reject attempt" },
    });
    expect(res.statusCode).toBe(404);

    const still = await app.inject({
      method: "GET", url: "/v1/admin/config-artefacts/promotions?limit=200&status=pending", headers: A(),
    });
    expect(list<Promotion>(still).meta.total).toBe(1);
  });

  it("tenant A's promotion is invisible in tenant B's queue", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/admin/config-artefacts/promotions?limit=200", headers: B() });
    expect(list<Promotion>(res).meta.total).toBe(0);
  });

  it("tenant B cannot roll back tenant A's environment", async () => {
    // Make production live for tenant A first, so a rollback target genuinely exists.
    const approved = await app.inject({
      method: "POST", url: `/v1/admin/config-artefacts/promotions/${promotionA.id}/approve`, headers: A2(),
      payload: { expectedVersion: promotionA.version },
    });
    expect(approved.statusCode).toBe(200);

    const res = await app.inject({
      method: "POST", url: "/v1/admin/config-artefacts/environments/production/rollback",
      headers: auth(B_ACTOR, T_B, ["platform_admin"]),
      payload: { setKey: SET, toVersion: 1, expectedVersion: 1 },
    });
    // No env state exists for tenant B — A's row must not be found or moved.
    expect(res.statusCode).toBe(404);

    const live = await app.inject({
      method: "GET", url: "/v1/admin/config-artefacts/environments?limit=200", headers: A(),
    });
    expect(list<{ environment: string }>(live).meta.total).toBe(1);
  });

  it("tenant B's environment view stays empty", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/admin/config-artefacts/environments?limit=200", headers: B() });
    expect(list<unknown>(res).meta.total).toBe(0);
  });
});

// ── CR-MOB-01 mobile telemetry ──────────────────────────────────────────────

describe("CR-MOB-01 mobile telemetry — cross-tenant isolation", () => {
  beforeAll(async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/admin/mobile-telemetry", headers: A(),
      payload: {
        appVersion: "1.2.3", platform: "android", coldStartMs: 900,
        crashCount: 1, anrCount: 0, sessionCount: 10,
        recordedAt: new Date().toISOString(),
        screens: [{ screen: "Dashboard", renderMs: 120, sampleCount: 3 }],
      },
    });
    expect(res.statusCode).toBe(201);
  });

  it("tenant B sees none of tenant A's raw events", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/admin/mobile-telemetry?limit=200", headers: B() });
    expect(res.statusCode).toBe(200);
    expect(list<unknown>(res).meta.total).toBe(0);
  });

  it("tenant B's aggregate contains no bucket from tenant A", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/admin/mobile-telemetry/aggregate?limit=200", headers: B() });
    expect(res.statusCode).toBe(200);
    expect(list<unknown>(res).data).toEqual([]);
  });

  it("tenant B's screen view contains no screen from tenant A", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/admin/mobile-telemetry/screens?limit=200", headers: B() });
    expect(res.statusCode).toBe(200);
    expect(list<{ screen: string }>(res).data).toEqual([]);
  });

  it("tenant A still sees its own event and screen bucket", async () => {
    const events = await app.inject({ method: "GET", url: "/v1/admin/mobile-telemetry?limit=200", headers: A() });
    expect(list<unknown>(events).meta.total).toBe(1);
    const screens = await app.inject({ method: "GET", url: "/v1/admin/mobile-telemetry/screens?limit=200", headers: A() });
    expect(list<{ screen: string }>(screens).data.map((s) => s.screen)).toEqual(["Dashboard"]);
  });
});

// ── ORG-07 department template clone ────────────────────────────────────────

describe("ORG-07 department template clone — cross-tenant isolation", () => {
  interface Template { id: string; code: string; version: number; config: Record<string, unknown> }
  interface Instantiation { id: string; departmentCode: string }

  let templateA: Template;

  beforeAll(async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/admin/department-templates", headers: A(),
      payload: {
        code: "iso-revenue",
        name: "Revenue (isolation)",
        config: { workflow: "standard", desks: [{ name: "Front" }] },
      },
    });
    expect(res.statusCode).toBe(201);
    templateA = single<Template>(res);
  });

  it("tenant B cannot read tenant A's template by id", async () => {
    const res = await app.inject({ method: "GET", url: `/v1/admin/department-templates/${templateA.id}`, headers: B() });
    expect(res.statusCode).toBe(404);
  });

  it("tenant A's template is absent from tenant B's list", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/admin/department-templates?limit=200", headers: B() });
    expect(list<Template>(res).meta.total).toBe(0);
  });

  it("tenant B cannot PATCH tenant A's template", async () => {
    const res = await app.inject({
      method: "PATCH", url: `/v1/admin/department-templates/${templateA.id}`, headers: B(),
      payload: { expectedVersion: templateA.version, status: "archived" },
    });
    expect(res.statusCode).toBe(404);

    const still = await app.inject({ method: "GET", url: `/v1/admin/department-templates/${templateA.id}`, headers: A() });
    expect(single<{ status: string }>(still).status).toBe("active");
  });

  it("tenant B cannot INSTANTIATE tenant A's template", async () => {
    const res = await app.inject({
      method: "POST", url: `/v1/admin/department-templates/${templateA.id}/instantiate`, headers: B(),
      payload: { departmentCode: "stolen-dept", departmentName: "Stolen", idempotencyKey: "iso-key-0001" },
    });
    expect(res.statusCode).toBe(404);
  });

  it("tenant B cannot list tenant A's instantiations", async () => {
    const made = await app.inject({
      method: "POST", url: `/v1/admin/department-templates/${templateA.id}/instantiate`, headers: A(),
      payload: { departmentCode: "iso-dept-a", departmentName: "Dept A", idempotencyKey: "iso-key-000a" },
    });
    expect(made.statusCode).toBe(201);

    const res = await app.inject({
      method: "GET", url: `/v1/admin/department-templates/${templateA.id}/instantiations?limit=200`, headers: B(),
    });
    expect(res.statusCode).toBe(404);
  });

  it("a clone in tenant B never carries a reference to tenant A", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/admin/department-templates", headers: B(),
      payload: {
        code: "iso-revenue", // same code — free in another tenant
        name: "Revenue (B)",
        config: {
          workflow: "standard",
          tenantId: T_A,                       // a foreign tenant reference
          desks: [{ name: "Front", tenant_id: T_A }],
        },
      },
    });
    expect(res.statusCode).toBe(201);
    const created = single<Template & { droppedRefs: string[]; foreignTenantRefs: string[] }>(res);

    expect(created.foreignTenantRefs).toEqual(expect.arrayContaining(["tenantId", "desks.0.tenant_id"]));
    expect(created.droppedRefs).toEqual(expect.arrayContaining(["tenantId", "desks.0.tenant_id"]));
    expect(JSON.stringify(created.config)).not.toContain(T_A);
  });

  it("the same idempotency key in two tenants creates two independent departments", async () => {
    const tplB = await app.inject({
      method: "POST", url: "/v1/admin/department-templates", headers: B(),
      payload: { code: "iso-shared-key", name: "Shared key", config: { workflow: "std" } },
    });
    expect(tplB.statusCode).toBe(201);
    const tplBId = single<Template>(tplB).id;

    const inA = await app.inject({
      method: "POST", url: `/v1/admin/department-templates/${templateA.id}/instantiate`, headers: A(),
      payload: { departmentCode: "iso-shared-a", departmentName: "Shared A", idempotencyKey: "iso-shared-key-1" },
    });
    const inB = await app.inject({
      method: "POST", url: `/v1/admin/department-templates/${tplBId}/instantiate`, headers: B(),
      payload: { departmentCode: "iso-shared-b", departmentName: "Shared B", idempotencyKey: "iso-shared-key-1" },
    });
    expect(inA.statusCode).toBe(201);
    expect(inB.statusCode).toBe(201);
    expect(single<Instantiation>(inA).id).not.toBe(single<Instantiation>(inB).id);
  });
});

// ── DM-002 document governance ──────────────────────────────────────────────

describe("DM-002 document governance — cross-tenant isolation", () => {
  interface DocType { id: string; code: string; version: number }
  interface Doc { id: string; status: string }

  const CTX = { contextType: "employee_onboarding", contextKey: "emp-iso-1" };
  let typeA: DocType;
  let docA: Doc;

  beforeAll(async () => {
    const type = await app.inject({
      method: "POST", url: "/v1/admin/document-types", headers: A(),
      payload: {
        code: "iso-licence", name: "Licence (isolation)", category: "licence",
        expiryRequired: true, expiryWarnDays: 1, allowedExtensions: ["pdf"],
      },
    });
    expect(type.statusCode).toBe(201);
    typeA = single<DocType>(type);

    const req = await app.inject({
      method: "POST", url: "/v1/admin/document-requirements", headers: A(),
      payload: { ...CTX, documentTypeCode: "iso-licence", mandatory: true },
    });
    expect(req.statusCode).toBe(201);

    const doc = await app.inject({
      method: "POST", url: "/v1/admin/documents", headers: A(),
      payload: {
        documentTypeCode: "iso-licence", ...CTX, subjectId: "subj-iso-1",
        storageKey: "uploads/iso/licence.pdf", expiresAt: FUTURE_DAYS(10),
      },
    });
    expect(doc.statusCode).toBe(201);
    docA = single<Doc>(doc);
    // warnDays is 1 and expiry is 10 days out, so it registers as `active`.
    expect(docA.status).toBe("active");
  });

  it("tenant B sees none of tenant A's document types", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/admin/document-types?limit=200", headers: B() });
    expect(list<DocType>(res).meta.total).toBe(0);
  });

  it("tenant B sees none of tenant A's requirements", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/admin/document-requirements?limit=200", headers: B() });
    expect(list<unknown>(res).meta.total).toBe(0);
  });

  it("tenant B sees none of tenant A's documents", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/admin/documents?limit=200", headers: B() });
    expect(list<Doc>(res).meta.total).toBe(0);
  });

  it("tenant B cannot PATCH tenant A's document type", async () => {
    const res = await app.inject({
      method: "PATCH", url: `/v1/admin/document-types/${typeA.id}`, headers: B(),
      payload: { expectedVersion: typeA.version, status: "retired" },
    });
    expect(res.statusCode).toBe(404);

    const still = await app.inject({ method: "GET", url: "/v1/admin/document-types?limit=200", headers: A() });
    expect(list<{ status: string }>(still).data[0]?.status).toBe("active");
  });

  it("tenant B cannot read tenant A's compliance report for the same context", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/admin/documents/compliance?limit=200&contextType=${CTX.contextType}&contextKey=${CTX.contextKey}`,
      headers: B(),
    });
    // B has no requirements for that context, so there is nothing to report on.
    expect(res.statusCode).toBe(404);
    expect((res.json() as { error: { code: string } }).error.code).toBe("NO_REQUIREMENTS");
  });

  it("tenant B's expiry scan never touches tenant A's documents", async () => {
    // Widen tenant A's warning window so its document IS due a transition —
    // this makes the negative assertion meaningful rather than vacuous.
    const patched = await app.inject({
      method: "PATCH", url: `/v1/admin/document-types/${typeA.id}`, headers: A(),
      payload: { expectedVersion: typeA.version, expiryWarnDays: 30 },
    });
    expect(patched.statusCode).toBe(200);

    const bScan = await app.inject({
      method: "POST", url: "/v1/admin/documents/expiry-scan", headers: B(), payload: { limit: 200 },
    });
    expect(bScan.statusCode).toBe(200);
    const bResult = single<{ scanned: number; expiring: number; expired: number }>(bScan);
    expect(bResult.scanned).toBe(0);
    expect(bResult.expiring).toBe(0);
    expect(bResult.expired).toBe(0);

    const afterB = await app.inject({ method: "GET", url: "/v1/admin/documents?limit=200", headers: A() });
    expect(list<Doc>(afterB).data.find((d) => d.id === docA.id)?.status).toBe("active");

    // Tenant A's own scan does move it — proving the scan works and that the
    // preceding no-op was isolation, not a broken scan.
    const aScan = await app.inject({
      method: "POST", url: "/v1/admin/documents/expiry-scan", headers: A(), payload: { limit: 200 },
    });
    expect(aScan.statusCode).toBe(200);
    expect(single<{ expiring: number }>(aScan).expiring).toBe(1);

    const afterA = await app.inject({ method: "GET", url: "/v1/admin/documents?limit=200", headers: A() });
    expect(list<Doc>(afterA).data.find((d) => d.id === docA.id)?.status).toBe("expiring");
  });

  it("the same document type code is free in the other tenant", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/admin/document-types", headers: B(),
      payload: { code: "iso-licence", name: "Licence (B)", category: "licence" },
    });
    expect(res.statusCode).toBe(201);
    expect(single<DocType>(res).id).not.toBe(typeA.id);
  });
});
