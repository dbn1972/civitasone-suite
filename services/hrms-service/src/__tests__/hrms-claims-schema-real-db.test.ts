/**
 * Expense claims / travel requests / announcements / push devices —
 * real-DB round-trip regression test for migration 0115_social_feed.sql.
 *
 * WHY THIS EXISTS: `social/routes.ts` queried `hrms.expense_claims` and
 * `hrms.travel_requests` — tables in a schema named `hrms`, which does not
 * exist anywhere in civitas_hrms (29 real domain schemas: employee, claims,
 * medical, leave, disciplinary, ...; no `hrms` schema). Every
 * GET /v1/hrms/expenses and GET /v1/hrms/travel-requests request 500'd with
 * Postgres 42P01 (relation does not exist). Migration 0115_social_feed.sql's
 * other four tables (hrms.social_kudos, hrms.social_kudos_reactions,
 * hrms.social_announcements, hrms.push_devices) targeted the same
 * nonexistent schema and are all actively queried by the same route file, so
 * they never worked either, even though nobody had filed a bug on them yet.
 *
 * Fix: retargeted travel_requests/expense_claims to claims.hrms_travel_requests
 * / claims.hrms_expense_claims (matching sibling claims.hrms_cea_claims /
 * claims.hrms_ltc_claims — same shape: employee submits, manager/HR
 * approves/rejects, RLS-forced), and kudos/announcements/push-devices to
 * employee.hrms_social_kudos / employee.hrms_social_kudos_reactions /
 * employee.hrms_social_announcements / employee.hrms_push_devices (no
 * dedicated social schema exists; `employee` is this service's established
 * home for general employee-domain features). All six get RLS ENABLE+FORCE
 * with the fleet-wide tenant_isolation_policy.
 *
 * Also wraps every query in social/routes.ts in withRawTenantGuc
 * (@civitasone/db): these tables all have RLS ENABLEd and FORCEd, and this
 * module talks to a raw pooled client with no db.transaction() in the call
 * path, which fails CLOSED (empty reads / row-security violation on write)
 * rather than loudly. Same fix already used by this service's medical and
 * workforce-planning modules.
 *
 * OUT OF SCOPE, NOT FIXED HERE (separate, pre-existing bug, see PR
 * description): social/routes.ts's kudos, birthdays, org chart, and the
 * combined social feed's birthday/new-joinee sections all query
 * employee.hrms_employees using column names (first_name, last_name,
 * employee_code, user_id, reporting_to, photo_url, joining_date, department,
 * designation) that do not exist on the real table (full_name, employee_no,
 * user_ref, reporting_officer_id/manager_id, photo_key, date_of_joining,
 * department_id/designation_id). That is unrelated to migration 0115 and is
 * not covered by this test file; POST /v1/hrms/kudos, GET
 * /v1/hrms/birthdays/today, GET /v1/hrms/orgchart, and GET
 * /v1/hrms/social/feed will continue to error until it is. The
 * travel-request and announcement POST handlers each made a *best-effort*
 * employee.hrms_employees lookup (manager notification / author display
 * name) that has been decoupled from the actual write so that unrelated
 * failure cannot roll back a travel request or announcement that should
 * otherwise succeed — that decoupling is covered below.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { withRawTenantGuc } from "@civitasone/db";
import { buildApp } from "../app.js";
import { sqlClient } from "../shared/db.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "cccccccc-0115-4000-8000-000000000115";
const SELF_ID = "cccccccc-0115-4000-8000-0000000000e1";
const APPROVER_ID = "cccccccc-0115-4000-8000-0000000000e2";

function tok(roles: string[], sub: string) {
  return signToken({ sub, tid: TENANT, roles, sid: "sess-hrms-claims-schema-test" }, SECRET);
}

const selfToken = tok(["employee"], SELF_ID);
const approverToken = tok(["hr_admin"], APPROVER_ID);

let app: Awaited<ReturnType<typeof buildApp>>;

// All six tables are FORCE RLS: verification queries need the same
// app.tenant_id GUC the fixed routes now set via withRawTenantGuc.
function asTenant<T>(fn: (tx: typeof sqlClient) => Promise<T>): Promise<T> {
  return withRawTenantGuc(sqlClient, TENANT, fn);
}

async function cleanup(): Promise<void> {
  await asTenant((tx) => tx`DELETE FROM claims.hrms_expense_claims WHERE tenant_id = ${TENANT}`);
  await asTenant((tx) => tx`DELETE FROM claims.hrms_travel_requests WHERE tenant_id = ${TENANT}`);
  await asTenant((tx) => tx`DELETE FROM employee.hrms_social_announcements WHERE tenant_id = ${TENANT}`);
  await asTenant((tx) => tx`DELETE FROM employee.hrms_push_devices WHERE tenant_id = ${TENANT}`);
}

beforeAll(async () => {
  // Fail fast with an actionable message if this environment's migration was
  // never applied, instead of every test below drowning in a raw 42P01.
  const rows = await sqlClient<{ present: boolean; table_schema: string; table_name: string }[]>`
    SELECT (t.table_schema IS NOT NULL) AS present, want.table_schema, want.table_name
    FROM (VALUES
      ('claims', 'hrms_expense_claims'),
      ('claims', 'hrms_travel_requests'),
      ('employee', 'hrms_social_announcements'),
      ('employee', 'hrms_push_devices')
    ) AS want(table_schema, table_name)
    LEFT JOIN information_schema.tables t
      ON t.table_schema = want.table_schema AND t.table_name = want.table_name
  `;
  const missing = rows.filter((r) => !r.present);
  if (missing.length > 0) {
    throw new Error(
      "Missing table(s) in this database (DATABASE_URL=" +
        `${process.env.DATABASE_URL ?? "<default from vitest.config.ts>"}): ` +
        missing.map((m) => `${m.table_schema}.${m.table_name}`).join(", ") +
        ". Apply services/hrms-service/migrations/0115_social_feed.sql before running this suite.",
    );
  }

  await cleanup();
  app = await buildApp();
});

afterAll(async () => {
  await cleanup();
  await app.close();
  await sqlClient.end();
});

describe("expense claims — real round-trip against claims.hrms_expense_claims", () => {
  let claimId: string;

  it("POST /v1/hrms/expenses — 202, and the row actually exists in claims.hrms_expense_claims", async () => {
    const r = await app.inject({
      method: "POST",
      url: "/v1/hrms/expenses",
      headers: { authorization: `Bearer ${selfToken}`, "content-type": "application/json" },
      body: JSON.stringify({
        category: "travel",
        amount: 45000,
        description: "Auto fare — regression test",
        date: "2026-08-01",
      }),
    });

    expect(r.statusCode).toBe(202);
    const body = JSON.parse(r.body);
    expect(body.status).toBe("pending");
    claimId = body.id;
    expect(claimId).toBeTruthy();

    const [dbRow] = await asTenant((tx) => tx`
      SELECT id, tenant_id, employee_id, status, amount, category
      FROM claims.hrms_expense_claims WHERE id = ${claimId}
    `);
    if (!dbRow) throw new Error("expected expense claim row not found");
    expect(dbRow.tenant_id).toBe(TENANT);
    expect(dbRow.employee_id).toBe(SELF_ID);
    expect(dbRow.status).toBe("pending");
    expect(Number(dbRow.amount)).toBe(45000);
  });

  it("GET /v1/hrms/expenses — 200, and lists the row just inserted", async () => {
    const r = await app.inject({
      method: "GET",
      url: "/v1/hrms/expenses",
      headers: { authorization: `Bearer ${selfToken}` },
    });

    expect(r.statusCode).toBe(200);
    const body = JSON.parse(r.body);
    const found = (body.data as Array<{ id: string; status: string }>).find((c) => c.id === claimId);
    expect(found).toBeTruthy();
    expect(found?.status).toBe("pending");
  });

  it("PATCH /v1/hrms/expenses/:id/approve — 403 when the approver is the submitter (SoD)", async () => {
    const r = await app.inject({
      method: "PATCH",
      url: `/v1/hrms/expenses/${claimId}/approve`,
      headers: { authorization: `Bearer ${selfToken}` },
    });
    expect(r.statusCode).toBe(403);
  });

  it("PATCH /v1/hrms/expenses/:id/approve — 404 for a claim id that does not exist (regression guard for the missing rowCount check this fix also added)", async () => {
    const r = await app.inject({
      method: "PATCH",
      url: `/v1/hrms/expenses/00000000-dead-4000-8000-ffffffffffff/approve`,
      headers: { authorization: `Bearer ${approverToken}` },
    });
    expect(r.statusCode).toBe(404);
  });

  it("PATCH /v1/hrms/expenses/:id/approve — 200, and writes approved_by/approved_at", async () => {
    const r = await app.inject({
      method: "PATCH",
      url: `/v1/hrms/expenses/${claimId}/approve`,
      headers: { authorization: `Bearer ${approverToken}` },
    });

    expect(r.statusCode).toBe(200);
    const body = JSON.parse(r.body);
    expect(body.status).toBe("approved");

    const [dbRow] = await asTenant((tx) => tx`
      SELECT status, approved_by, approved_at FROM claims.hrms_expense_claims WHERE id = ${claimId}
    `);
    if (!dbRow) throw new Error("expected expense claim row not found");
    expect(dbRow.status).toBe("approved");
    expect(dbRow.approved_by).toBe(APPROVER_ID);
    expect(dbRow.approved_at).toBeTruthy();
  });

  it("PATCH /v1/hrms/expenses/:id/approve — 404 when approving an already-processed claim a second time", async () => {
    const r = await app.inject({
      method: "PATCH",
      url: `/v1/hrms/expenses/${claimId}/approve`,
      headers: { authorization: `Bearer ${approverToken}` },
    });
    expect(r.statusCode).toBe(404);
  });

  it("GET /v1/hrms/expenses — 401 without a token", async () => {
    const r = await app.inject({ method: "GET", url: "/v1/hrms/expenses" });
    expect([401, 403]).toContain(r.statusCode);
  });
});

describe("travel requests — real round-trip against claims.hrms_travel_requests", () => {
  let approveId: string;
  let rejectId: string;

  it("POST /v1/hrms/travel-requests — 202, and the row actually exists in claims.hrms_travel_requests (manager-notification lookup no longer blocks creation)", async () => {
    const r = await app.inject({
      method: "POST",
      url: "/v1/hrms/travel-requests",
      headers: { authorization: `Bearer ${selfToken}`, "content-type": "application/json" },
      body: JSON.stringify({
        purpose: "Regional review meeting",
        destination: "Lucknow",
        fromDate: "2026-09-01",
        toDate: "2026-09-03",
        mode: "rail",
      }),
    });

    expect(r.statusCode).toBe(202);
    const body = JSON.parse(r.body);
    expect(body.status).toBe("pending");
    approveId = body.id;

    const [dbRow] = await asTenant((tx) => tx`
      SELECT id, tenant_id, employee_id, status, destination
      FROM claims.hrms_travel_requests WHERE id = ${approveId}
    `);
    if (!dbRow) throw new Error("expected travel request row not found");
    expect(dbRow.tenant_id).toBe(TENANT);
    expect(dbRow.employee_id).toBe(SELF_ID);
    expect(dbRow.status).toBe("pending");
    expect(dbRow.destination).toBe("Lucknow");
  });

  it("GET /v1/hrms/travel-requests — 200, and lists the row just inserted", async () => {
    const r = await app.inject({
      method: "GET",
      url: "/v1/hrms/travel-requests",
      headers: { authorization: `Bearer ${selfToken}` },
    });
    expect(r.statusCode).toBe(200);
    const body = JSON.parse(r.body);
    expect((body.data as Array<{ id: string }>).some((t) => t.id === approveId)).toBe(true);
  });

  it("PATCH /v1/hrms/travel-requests/:id/approve — 403 when the approver is the submitter (SoD)", async () => {
    const r = await app.inject({
      method: "PATCH",
      url: `/v1/hrms/travel-requests/${approveId}/approve`,
      headers: { authorization: `Bearer ${selfToken}` },
    });
    expect(r.statusCode).toBe(403);
  });

  it("PATCH /v1/hrms/travel-requests/:id/approve — 200, and writes approved_by/approved_at", async () => {
    const r = await app.inject({
      method: "PATCH",
      url: `/v1/hrms/travel-requests/${approveId}/approve`,
      headers: { authorization: `Bearer ${approverToken}` },
    });
    expect(r.statusCode).toBe(200);
    expect(JSON.parse(r.body).status).toBe("approved");

    const [dbRow] = await asTenant((tx) => tx`
      SELECT status, approved_by, approved_at FROM claims.hrms_travel_requests WHERE id = ${approveId}
    `);
    if (!dbRow) throw new Error("expected travel request row not found");
    expect(dbRow.status).toBe("approved");
    expect(dbRow.approved_by).toBe(APPROVER_ID);
  });

  it("PATCH /v1/hrms/travel-requests/:id/approve — 404 when already processed", async () => {
    const r = await app.inject({
      method: "PATCH",
      url: `/v1/hrms/travel-requests/${approveId}/approve`,
      headers: { authorization: `Bearer ${approverToken}` },
    });
    expect(r.statusCode).toBe(404);
  });

  it("PATCH /v1/hrms/travel-requests/:id/reject — 200, and writes rejection_reason", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/v1/hrms/travel-requests",
      headers: { authorization: `Bearer ${selfToken}`, "content-type": "application/json" },
      body: JSON.stringify({
        purpose: "Site visit",
        destination: "Patna",
        fromDate: "2026-09-10",
        toDate: "2026-09-11",
      }),
    });
    rejectId = JSON.parse(created.body).id;

    const r = await app.inject({
      method: "PATCH",
      url: `/v1/hrms/travel-requests/${rejectId}/reject`,
      headers: { authorization: `Bearer ${approverToken}`, "content-type": "application/json" },
      body: JSON.stringify({ reason: "Budget freeze this quarter" }),
    });
    expect(r.statusCode).toBe(200);
    expect(JSON.parse(r.body).status).toBe("rejected");

    const [dbRow] = await asTenant((tx) => tx`
      SELECT status, rejection_reason FROM claims.hrms_travel_requests WHERE id = ${rejectId}
    `);
    if (!dbRow) throw new Error("expected travel request row not found");
    expect(dbRow.status).toBe("rejected");
    expect(dbRow.rejection_reason).toBe("Budget freeze this quarter");
  });
});

describe("announcements — real round-trip against employee.hrms_social_announcements", () => {
  it("POST then GET /v1/hrms/announcements — 201/200, author lookup failure degrades to 'Admin' instead of failing the write", async () => {
    const create = await app.inject({
      method: "POST",
      url: "/v1/hrms/announcements",
      headers: { authorization: `Bearer ${selfToken}`, "content-type": "application/json" },
      body: JSON.stringify({
        title: "Office closed Friday",
        body: "The office will be closed for a regional holiday.",
        category: "general",
      }),
    });
    expect(create.statusCode).toBe(201);
    const id = JSON.parse(create.body).id;

    const [dbRow] = await asTenant((tx) => tx`
      SELECT tenant_id, title, created_by_name FROM employee.hrms_social_announcements WHERE id = ${id}
    `);
    if (!dbRow) throw new Error("expected announcement row not found");
    expect(dbRow.tenant_id).toBe(TENANT);
    // employee.hrms_employees column drift (see file header) means the
    // author-name lookup can't resolve a real name in this environment;
    // proves it degrades gracefully rather than 500ing the whole request.
    expect(dbRow.created_by_name).toBe("Admin");

    const list = await app.inject({
      method: "GET",
      url: "/v1/hrms/announcements",
      headers: { authorization: `Bearer ${selfToken}` },
    });
    expect(list.statusCode).toBe(200);
    expect((JSON.parse(list.body).data as Array<{ id: string }>).some((a) => a.id === id)).toBe(true);
  });
});

describe("push devices — real round-trip against employee.hrms_push_devices", () => {
  it("POST /v1/hrms/devices/register — 200, persists, and upserts on conflict", async () => {
    const deviceId = "test-device-0115";

    const first = await app.inject({
      method: "POST",
      url: "/v1/hrms/devices/register",
      headers: { authorization: `Bearer ${selfToken}`, "content-type": "application/json" },
      body: JSON.stringify({ token: "fcm-token-v1", platform: "android", deviceId }),
    });
    expect(first.statusCode).toBe(200);

    const second = await app.inject({
      method: "POST",
      url: "/v1/hrms/devices/register",
      headers: { authorization: `Bearer ${selfToken}`, "content-type": "application/json" },
      body: JSON.stringify({ token: "fcm-token-v2", platform: "android", deviceId }),
    });
    expect(second.statusCode).toBe(200);

    const rows = await asTenant((tx) => tx`
      SELECT token, platform FROM employee.hrms_push_devices
      WHERE tenant_id = ${TENANT} AND user_id = ${SELF_ID} AND device_id = ${deviceId}
    `);
    expect(rows).toHaveLength(1);
    const [row] = rows;
    if (!row) throw new Error("expected push device row not found");
    expect(row.token).toBe("fcm-token-v2");
  });
});
