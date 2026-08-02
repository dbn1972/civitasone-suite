/**
 * ORG-07 — department template clone route integration tests.
 *
 * Covers every endpoint (happy + 400 + 401 + 403 + 404 + 409 + 422), the
 * idempotent instantiate contract, name collisions, and what a clone carries
 * versus what it refuses to carry across a tenant boundary.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";

const { buildApp } = await import("../src/app.js");
const { sqlClient } = await import("../src/shared/db.js");

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";

const T_MAIN = "07000000-0000-4000-8000-0000000000f1";
const T_ALT = "07000000-0000-4000-8000-0000000000f2";
const TENANTS = [T_MAIN, T_ALT];
const ACTOR = "07111111-0000-4000-8000-000000000001";
const MISSING_ID = "07999999-0000-4000-8000-000000000099";

function auth(roles: string[] = ["tenant_admin"], tenantId = T_MAIN): { authorization: string } {
  return { authorization: `Bearer ${signToken({ sub: ACTOR, tid: tenantId, roles, sid: "sess-org7" }, SECRET, 3600)}` };
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
      await sql`DELETE FROM dept_template.department_instantiations WHERE tenant_id = ${t}`;
      await sql`DELETE FROM dept_template.department_templates WHERE tenant_id = ${t}`;
    });
  }
}

let app: FastifyInstance;
beforeAll(async () => { app = await buildApp(); await wipe(); });
afterAll(async () => { await wipe(); await app.close(); await sqlClient.end(); });

interface SingleBody<T> { data: T }
interface ListBody<T> { data: T[]; meta: { page: number; pageSize: number; total: number } }
interface ErrBody { error: { code: string; message: string; correlationId: string; details?: Record<string, string> } }

interface Template {
  id: string; code: string; name: string; status: string; version: number;
  config: Record<string, unknown>; droppedRefs: string[]; foreignTenantRefs?: string[];
  sourceDepartmentId: string | null;
}
interface Instantiation {
  id: string; templateId: string; templateVersion: number; departmentCode: string;
  departmentName: string; idempotencyKey: string; config: Record<string, unknown>; idempotent: boolean;
}

const FOREIGN_TENANT = "07aaaaaa-0000-4000-8000-0000000000ff";

let seq = 0;
function nextCode(prefix: string): string {
  seq += 1;
  return `${prefix}-${seq}`;
}

async function createTemplate(
  code: string, config: Record<string, unknown> = { roles: ["clerk"], sla: { hours: 4 } },
  tenantId = T_MAIN,
): Promise<Template> {
  const res = await app.inject({
    method: "POST", url: "/v1/admin/department-templates", headers: auth(["tenant_admin"], tenantId),
    payload: { code, name: `Template ${code}`, config },
  });
  expect(res.statusCode).toBe(201);
  return (res.json() as SingleBody<Template>).data;
}

// ── auth ────────────────────────────────────────────────────────────────────

describe("department templates — authentication and authorisation", () => {
  const cases: Array<[string, string, Record<string, unknown> | undefined]> = [
    ["GET", "/v1/admin/department-templates?limit=10", undefined],
    ["POST", "/v1/admin/department-templates", { code: "abc", name: "A", config: { a: 1 } }],
    ["GET", `/v1/admin/department-templates/${MISSING_ID}`, undefined],
    ["PATCH", `/v1/admin/department-templates/${MISSING_ID}`, { expectedVersion: 1, name: "B" }],
    ["POST", `/v1/admin/department-templates/${MISSING_ID}/instantiate`, { departmentCode: "dept-x", departmentName: "X", idempotencyKey: "key-000001" }],
    ["GET", `/v1/admin/department-templates/${MISSING_ID}/instantiations?limit=10`, undefined],
  ];

  for (const [method, url, payload] of cases) {
    const label = `${method} ${(url.split("?")[0] ?? url).replace(MISSING_ID, ":id")}`;
    it(`401 without a token — ${label}`, async () => {
      const res = await app.inject({ method: method as "GET", url, ...(payload ? { payload } : {}) });
      expect(res.statusCode).toBe(401);
    });
    it(`403 for a non-admin role — ${label}`, async () => {
      const res = await app.inject({
        method: method as "GET", url, headers: auth(["employee"]), ...(payload ? { payload } : {}),
      });
      expect(res.statusCode).toBe(403);
      expect((res.json() as ErrBody).error.code).toBe("FORBIDDEN");
    });
  }
});

// ── clone into a template ───────────────────────────────────────────────────

describe("POST /v1/admin/department-templates — clone", () => {
  it("copies the department configuration verbatim when it is already clean", async () => {
    const t = await createTemplate(nextCode("clean"), { roles: ["clerk", "officer"], sla: { hours: 4 } });
    expect(t.config).toEqual({ roles: ["clerk", "officer"], sla: { hours: 4 } });
    expect(t.droppedRefs).toEqual([]);
    expect(t.foreignTenantRefs).toEqual([]);
    expect(t.status).toBe("active");
    expect(t.version).toBe(1);
  });

  it("does NOT copy the source primary key, audit columns or version counter", async () => {
    const t = await createTemplate(nextCode("dirty"), {
      id: "dept-1", createdBy: ACTOR, updatedBy: ACTOR, version: 9, departmentId: "dept-1", keep: "yes",
    });
    expect(t.config).toEqual({ keep: "yes" });
    expect(t.droppedRefs.sort()).toEqual(["createdBy", "departmentId", "id", "updatedBy", "version"]);
  });

  it("refuses to carry a tenant-crossing reference and reports it explicitly", async () => {
    const t = await createTemplate(nextCode("cross"), {
      tenantId: FOREIGN_TENANT,
      workflow: { approvals: { tenant_id: FOREIGN_TENANT, levels: 2 } },
      keep: 1,
    });
    expect(JSON.stringify(t.config)).not.toContain(FOREIGN_TENANT);
    expect(t.config).toEqual({ workflow: { approvals: { levels: 2 } }, keep: 1 });
    expect(t.foreignTenantRefs?.sort()).toEqual(["tenantId", "workflow.approvals.tenant_id"]);
  });

  it("drops a reference to the OWN tenant without flagging it as cross-tenant", async () => {
    const t = await createTemplate(nextCode("own"), { tenantId: T_MAIN, keep: 1 });
    expect(t.config).toEqual({ keep: 1 });
    expect(t.droppedRefs).toEqual(["tenantId"]);
    expect(t.foreignTenantRefs).toEqual([]);
  });

  it("records an optional sourceDepartmentId", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/admin/department-templates", headers: auth(),
      payload: {
        code: nextCode("src"), name: "With source",
        sourceDepartmentId: "07bbbbbb-0000-4000-8000-0000000000bb", config: { keep: 1 },
      },
    });
    expect(res.statusCode).toBe(201);
    expect((res.json() as SingleBody<Template>).data.sourceDepartmentId).toBe("07bbbbbb-0000-4000-8000-0000000000bb");
  });

  it("409 TEMPLATE_EXISTS on a duplicate code in the same tenant", async () => {
    const code = nextCode("dup");
    await createTemplate(code);
    const res = await app.inject({
      method: "POST", url: "/v1/admin/department-templates", headers: auth(),
      payload: { code, name: "Second", config: { a: 1 } },
    });
    expect(res.statusCode).toBe(409);
    expect((res.json() as ErrBody).error.code).toBe("TEMPLATE_EXISTS");
  });

  it("allows the same template code in a different tenant", async () => {
    const code = nextCode("shared");
    await createTemplate(code, { a: 1 }, T_MAIN);
    const other = await createTemplate(code, { a: 1 }, T_ALT);
    expect(other.code).toBe(code);
  });

  it("422 EMPTY_TEMPLATE when nothing survives sanitisation", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/admin/department-templates", headers: auth(),
      payload: { code: nextCode("empty"), name: "Empty", config: { id: "d1", version: 3 } },
    });
    expect(res.statusCode).toBe(422);
    expect((res.json() as ErrBody).error.code).toBe("EMPTY_TEMPLATE");
  });

  it("422 EMPTY_TEMPLATE for a config that was empty to begin with", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/admin/department-templates", headers: auth(),
      payload: { code: nextCode("blank"), name: "Blank", config: {} },
    });
    expect(res.statusCode).toBe(422);
  });

  it("422 CONFIG_TOO_LARGE beyond the top-level key ceiling", async () => {
    const config: Record<string, number> = {};
    for (let i = 0; i < 201; i++) config[`k${i}`] = i;
    const res = await app.inject({
      method: "POST", url: "/v1/admin/department-templates", headers: auth(),
      payload: { code: nextCode("big"), name: "Big", config },
    });
    expect(res.statusCode).toBe(422);
    expect((res.json() as ErrBody).error.code).toBe("CONFIG_TOO_LARGE");
  });

  it("400 for a code outside the identifier charset", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/admin/department-templates", headers: auth(),
      payload: { code: "Bad Code", name: "X", config: { a: 1 } },
    });
    expect(res.statusCode).toBe(400);
    expect((res.json() as ErrBody).error.details).toHaveProperty("code");
  });

  it("400 for a one-character code", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/admin/department-templates", headers: auth(),
      payload: { code: "a", name: "X", config: { a: 1 } },
    });
    expect(res.statusCode).toBe(400);
  });

  it("400 when config is absent", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/admin/department-templates", headers: auth(),
      payload: { code: nextCode("noconf"), name: "X" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("400 for a non-uuid sourceDepartmentId", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/admin/department-templates", headers: auth(),
      payload: { code: nextCode("badsrc"), name: "X", sourceDepartmentId: "not-a-uuid", config: { a: 1 } },
    });
    expect(res.statusCode).toBe(400);
  });
});

// ── list + read + patch ────────────────────────────────────────────────────

describe("department templates — list, read, update", () => {
  it("lists with the list envelope and filters by status", async () => {
    const t = await createTemplate(nextCode("listed"));
    const all = await app.inject({ method: "GET", url: "/v1/admin/department-templates?limit=200", headers: auth() });
    expect(all.statusCode).toBe(200);
    expect((all.json() as ListBody<Template>).data.map((r) => r.id)).toContain(t.id);

    const active = await app.inject({
      method: "GET", url: "/v1/admin/department-templates?limit=200&status=active", headers: auth(),
    });
    expect((active.json() as ListBody<Template>).data.every((r) => r.status === "active")).toBe(true);
  });

  it("400 for an unknown status filter and 400 without limit", async () => {
    const bad = await app.inject({
      method: "GET", url: "/v1/admin/department-templates?limit=10&status=deleted", headers: auth(),
    });
    expect(bad.statusCode).toBe(400);
    const none = await app.inject({ method: "GET", url: "/v1/admin/department-templates", headers: auth() });
    expect(none.statusCode).toBe(400);
  });

  it("reads one template, 404 for an unknown id, 400 for a non-uuid", async () => {
    const t = await createTemplate(nextCode("readone"));
    const ok = await app.inject({ method: "GET", url: `/v1/admin/department-templates/${t.id}`, headers: auth() });
    expect(ok.statusCode).toBe(200);
    expect((ok.json() as SingleBody<Template>).data.code).toBe(t.code);

    const missing = await app.inject({
      method: "GET", url: `/v1/admin/department-templates/${MISSING_ID}`, headers: auth(),
    });
    expect(missing.statusCode).toBe(404);

    const bad = await app.inject({ method: "GET", url: "/v1/admin/department-templates/nope", headers: auth() });
    expect(bad.statusCode).toBe(400);
  });

  it("renames a template under an optimistic lock", async () => {
    const t = await createTemplate(nextCode("rename"));
    const res = await app.inject({
      method: "PATCH", url: `/v1/admin/department-templates/${t.id}`, headers: auth(),
      payload: { expectedVersion: t.version, name: "Renamed" },
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as SingleBody<{ version: number }>).data.version).toBe(t.version + 1);

    const after = await app.inject({ method: "GET", url: `/v1/admin/department-templates/${t.id}`, headers: auth() });
    expect((after.json() as SingleBody<Template>).data.name).toBe("Renamed");
  });

  it("409 VERSION_CONFLICT on a stale expectedVersion", async () => {
    const t = await createTemplate(nextCode("stale"));
    const res = await app.inject({
      method: "PATCH", url: `/v1/admin/department-templates/${t.id}`, headers: auth(),
      payload: { expectedVersion: t.version + 4, name: "Nope" },
    });
    expect(res.statusCode).toBe(409);
    expect((res.json() as ErrBody).error.code).toBe("VERSION_CONFLICT");
  });

  it("a second PATCH with the now-stale version is rejected", async () => {
    const t = await createTemplate(nextCode("twice"));
    const first = await app.inject({
      method: "PATCH", url: `/v1/admin/department-templates/${t.id}`, headers: auth(),
      payload: { expectedVersion: t.version, name: "One" },
    });
    expect(first.statusCode).toBe(200);
    const second = await app.inject({
      method: "PATCH", url: `/v1/admin/department-templates/${t.id}`, headers: auth(),
      payload: { expectedVersion: t.version, name: "Two" },
    });
    expect(second.statusCode).toBe(409);
  });

  it("400 EMPTY_PATCH when neither name nor status is supplied", async () => {
    const t = await createTemplate(nextCode("emptypatch"));
    const res = await app.inject({
      method: "PATCH", url: `/v1/admin/department-templates/${t.id}`, headers: auth(),
      payload: { expectedVersion: t.version },
    });
    expect(res.statusCode).toBe(400);
    expect((res.json() as ErrBody).error.code).toBe("EMPTY_PATCH");
  });

  it("400 when expectedVersion is missing from the patch", async () => {
    const t = await createTemplate(nextCode("noexp"));
    const res = await app.inject({
      method: "PATCH", url: `/v1/admin/department-templates/${t.id}`, headers: auth(),
      payload: { name: "X" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("400 for an unknown status in the patch", async () => {
    const t = await createTemplate(nextCode("badstatus"));
    const res = await app.inject({
      method: "PATCH", url: `/v1/admin/department-templates/${t.id}`, headers: auth(),
      payload: { expectedVersion: t.version, status: "deleted" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("404 when patching an unknown template", async () => {
    const res = await app.inject({
      method: "PATCH", url: `/v1/admin/department-templates/${MISSING_ID}`, headers: auth(),
      payload: { expectedVersion: 1, name: "X" },
    });
    expect(res.statusCode).toBe(404);
  });

  it("does not expose another tenant's template", async () => {
    const t = await createTemplate(nextCode("iso"), { a: 1 }, T_ALT);
    const res = await app.inject({
      method: "GET", url: `/v1/admin/department-templates/${t.id}`, headers: auth(["tenant_admin"], T_MAIN),
    });
    expect(res.statusCode).toBe(404);
  });
});

// ── instantiate ─────────────────────────────────────────────────────────────

describe("POST /v1/admin/department-templates/:id/instantiate", () => {
  it("creates a department instantiation carrying the sanitised config", async () => {
    const t = await createTemplate(nextCode("inst"), { roles: ["clerk"], sla: { hours: 4 } });
    const res = await app.inject({
      method: "POST", url: `/v1/admin/department-templates/${t.id}/instantiate`, headers: auth(),
      payload: { departmentCode: nextCode("dept"), departmentName: "Revenue Wing", idempotencyKey: "idem-instant-001" },
    });
    expect(res.statusCode).toBe(201);
    const row = (res.json() as SingleBody<Instantiation>).data;
    expect(row.idempotent).toBe(false);
    expect(row.templateVersion).toBe(t.version);
    expect(row.config).toEqual({ roles: ["clerk"], sla: { hours: 4 } });
  });

  it("re-sanitises at instantiate time so a legacy template cannot emit a foreign ref", async () => {
    const t = await createTemplate(nextCode("resan"), { keep: 1 });
    // Simulate a row stored before the sanitiser existed.
    await asTenant(T_MAIN, (sql) => sql`
      UPDATE dept_template.department_templates
      SET config = ${sql.json({ keep: 1, tenantId: FOREIGN_TENANT })}
      WHERE id = ${t.id}`);
    const res = await app.inject({
      method: "POST", url: `/v1/admin/department-templates/${t.id}/instantiate`, headers: auth(),
      payload: { departmentCode: nextCode("dept"), departmentName: "Legacy", idempotencyKey: "idem-legacy-001" },
    });
    expect(res.statusCode).toBe(201);
    const row = (res.json() as SingleBody<Instantiation>).data;
    expect(JSON.stringify(row.config)).not.toContain(FOREIGN_TENANT);
    expect(row.config).toEqual({ keep: 1 });
  });

  it("a repeat call with the same idempotencyKey returns 200 with the FIRST result and writes nothing", async () => {
    const t = await createTemplate(nextCode("idem"));
    const code = nextCode("dept");
    const key = "idem-repeat-000001";
    const first = await app.inject({
      method: "POST", url: `/v1/admin/department-templates/${t.id}/instantiate`, headers: auth(),
      payload: { departmentCode: code, departmentName: "First", idempotencyKey: key },
    });
    expect(first.statusCode).toBe(201);
    const firstRow = (first.json() as SingleBody<Instantiation>).data;

    const again = await app.inject({
      method: "POST", url: `/v1/admin/department-templates/${t.id}/instantiate`, headers: auth(),
      payload: { departmentCode: nextCode("other"), departmentName: "Second", idempotencyKey: key },
    });
    expect(again.statusCode).toBe(200);
    const againRow = (again.json() as SingleBody<Instantiation>).data;
    expect(againRow.id).toBe(firstRow.id);
    expect(againRow.idempotent).toBe(true);
    expect(againRow.departmentName).toBe("First");

    const rows = await asTenant(T_MAIN, (sql) => sql<Array<{ n: number }>>`
      SELECT count(*)::int AS n FROM dept_template.department_instantiations
      WHERE tenant_id = ${T_MAIN} AND template_id = ${t.id}`);
    expect(rows[0]?.n).toBe(1);
  });

  it("does not re-publish the instantiated event on an idempotent replay", async () => {
    const t = await createTemplate(nextCode("idemevent"));
    const key = "idem-event-000001";
    const first = await app.inject({
      method: "POST", url: `/v1/admin/department-templates/${t.id}/instantiate`, headers: auth(),
      payload: { departmentCode: nextCode("dept"), departmentName: "Once", idempotencyKey: key },
    });
    const id = (first.json() as SingleBody<Instantiation>).data.id;
    await app.inject({
      method: "POST", url: `/v1/admin/department-templates/${t.id}/instantiate`, headers: auth(),
      payload: { departmentCode: nextCode("dept"), departmentName: "Once", idempotencyKey: key },
    });
    const rows = await asTenant(T_MAIN, (sql) => sql<Array<{ n: number }>>`
      SELECT count(*)::int AS n FROM _outbox.messages
      WHERE topic = 'admin.department.instantiated' AND payload->>'instantiationId' = ${id}`);
    expect(rows[0]?.n).toBe(1);
  });

  it("409 DEPARTMENT_EXISTS when the department code collides with an earlier instantiation", async () => {
    const t = await createTemplate(nextCode("collide"));
    const code = nextCode("dept");
    await app.inject({
      method: "POST", url: `/v1/admin/department-templates/${t.id}/instantiate`, headers: auth(),
      payload: { departmentCode: code, departmentName: "First", idempotencyKey: "idem-collide-0001" },
    });
    const clash = await app.inject({
      method: "POST", url: `/v1/admin/department-templates/${t.id}/instantiate`, headers: auth(),
      payload: { departmentCode: code, departmentName: "Second", idempotencyKey: "idem-collide-0002" },
    });
    expect(clash.statusCode).toBe(409);
    expect((clash.json() as ErrBody).error.code).toBe("DEPARTMENT_EXISTS");
  });

  it("a department code collides across TEMPLATES too — codes are tenant-unique", async () => {
    const a = await createTemplate(nextCode("ca"));
    const b = await createTemplate(nextCode("cb"));
    const code = nextCode("dept");
    await app.inject({
      method: "POST", url: `/v1/admin/department-templates/${a.id}/instantiate`, headers: auth(),
      payload: { departmentCode: code, departmentName: "From A", idempotencyKey: "idem-xtmpl-0001" },
    });
    const res = await app.inject({
      method: "POST", url: `/v1/admin/department-templates/${b.id}/instantiate`, headers: auth(),
      payload: { departmentCode: code, departmentName: "From B", idempotencyKey: "idem-xtmpl-0002" },
    });
    expect(res.statusCode).toBe(409);
  });

  it("the same department code is allowed in a different tenant", async () => {
    const code = nextCode("dept");
    const a = await createTemplate(nextCode("t-main"), { a: 1 }, T_MAIN);
    const b = await createTemplate(nextCode("t-alt"), { a: 1 }, T_ALT);
    const first = await app.inject({
      method: "POST", url: `/v1/admin/department-templates/${a.id}/instantiate`, headers: auth(["tenant_admin"], T_MAIN),
      payload: { departmentCode: code, departmentName: "Main", idempotencyKey: "idem-tenant-0001" },
    });
    expect(first.statusCode).toBe(201);
    const second = await app.inject({
      method: "POST", url: `/v1/admin/department-templates/${b.id}/instantiate`, headers: auth(["tenant_admin"], T_ALT),
      payload: { departmentCode: code, departmentName: "Alt", idempotencyKey: "idem-tenant-0002" },
    });
    expect(second.statusCode).toBe(201);
  });

  it("422 TEMPLATE_NOT_ACTIVE for an archived template", async () => {
    const t = await createTemplate(nextCode("archived"));
    const patched = await app.inject({
      method: "PATCH", url: `/v1/admin/department-templates/${t.id}`, headers: auth(),
      payload: { expectedVersion: t.version, status: "archived" },
    });
    expect(patched.statusCode).toBe(200);
    const res = await app.inject({
      method: "POST", url: `/v1/admin/department-templates/${t.id}/instantiate`, headers: auth(),
      payload: { departmentCode: nextCode("dept"), departmentName: "X", idempotencyKey: "idem-archived-001" },
    });
    expect(res.statusCode).toBe(422);
    expect((res.json() as ErrBody).error.code).toBe("TEMPLATE_NOT_ACTIVE");
  });

  it("404 when instantiating an unknown template", async () => {
    const res = await app.inject({
      method: "POST", url: `/v1/admin/department-templates/${MISSING_ID}/instantiate`, headers: auth(),
      payload: { departmentCode: nextCode("dept"), departmentName: "X", idempotencyKey: "idem-missing-0001" },
    });
    expect(res.statusCode).toBe(404);
  });

  it("400 when the idempotency key is too short", async () => {
    const t = await createTemplate(nextCode("shortkey"));
    const res = await app.inject({
      method: "POST", url: `/v1/admin/department-templates/${t.id}/instantiate`, headers: auth(),
      payload: { departmentCode: nextCode("dept"), departmentName: "X", idempotencyKey: "short" },
    });
    expect(res.statusCode).toBe(400);
    expect((res.json() as ErrBody).error.details).toHaveProperty("idempotencyKey");
  });

  it("400 when the idempotency key is absent", async () => {
    const t = await createTemplate(nextCode("nokey"));
    const res = await app.inject({
      method: "POST", url: `/v1/admin/department-templates/${t.id}/instantiate`, headers: auth(),
      payload: { departmentCode: nextCode("dept"), departmentName: "X" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("400 for a department code outside the identifier charset", async () => {
    const t = await createTemplate(nextCode("badcode"));
    const res = await app.inject({
      method: "POST", url: `/v1/admin/department-templates/${t.id}/instantiate`, headers: auth(),
      payload: { departmentCode: "Bad Dept", departmentName: "X", idempotencyKey: "idem-badcode-001" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("lists instantiations for a template, 404 for an unknown template", async () => {
    const t = await createTemplate(nextCode("instlist"));
    await app.inject({
      method: "POST", url: `/v1/admin/department-templates/${t.id}/instantiate`, headers: auth(),
      payload: { departmentCode: nextCode("dept"), departmentName: "One", idempotencyKey: "idem-list-000001" },
    });
    const res = await app.inject({
      method: "GET", url: `/v1/admin/department-templates/${t.id}/instantiations?limit=50`, headers: auth(),
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as ListBody<Instantiation>).meta.total).toBe(1);

    const missing = await app.inject({
      method: "GET", url: `/v1/admin/department-templates/${MISSING_ID}/instantiations?limit=10`, headers: auth(),
    });
    expect(missing.statusCode).toBe(404);
  });

  it("400 when listing instantiations without limit", async () => {
    const t = await createTemplate(nextCode("nolimit"));
    const res = await app.inject({
      method: "GET", url: `/v1/admin/department-templates/${t.id}/instantiations`, headers: auth(),
    });
    expect(res.statusCode).toBe(400);
  });
});
