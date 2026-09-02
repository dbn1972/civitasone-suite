/**
 * hrms-service — id-cards issue/list/me/verify RLS regression tests.
 *
 * Follow-up to PR #893, which fixed the identical missing-`app.tenant_id`-GUC
 * defect in this same file's suspend/revoke/reactivate handlers.
 * `hrms.id_cards` and `hrms.id_card_verifications` (migration
 * 0123_rls_completeness.sql) and `employee.hrms_employees` (migration
 * 0026/0034_rls_*.sql) are all RLS ENABLEd AND FORCEd. The service connects
 * as `hrms_svc` (rolbypassrls=false). This module has no Drizzle schema
 * attached, so there is no `db.transaction()` anywhere in its call path —
 * the only place `wrapWithTenantGuc` sets `app.tenant_id` — so every raw
 * `sqlPool`/`sqlClient` query here ran with the GUC unset.
 *
 * Root causes fixed here, per handler (all confirmed empirically against a
 * real bootstrapped Postgres, hrms_svc role, before writing the fix):
 *  - list:   SELECT with FORCEd RLS + no GUC -> USING clause matches zero
 *            rows -> always returned an empty list, even with cards present.
 *  - me:     Same empty-SELECT shape on hrms.id_cards, AND (independent of
 *            RLS) the employee lookup queried `WHERE user_id = $1` — a
 *            column that does not exist on employee.hrms_employees (the
 *            real column is `user_ref`, confirmed against
 *            src/modules/employee/schema.ts and the live schema). That is a
 *            hard "column does not exist" error that fires before the RLS
 *            gap can even manifest, so /me 500'd unconditionally, for every
 *            caller, regardless of whether they had a card.
 *  - verify: SELECT with FORCEd RLS + no GUC -> always 0 rows -> every scan
 *            of a real, valid card returned {result: "unknown"} — never a
 *            hard error, since the handler intentionally treats "not found"
 *            as a normal (if unwelcome) verification outcome. The
 *            id_card_verifications INSERT and id_cards stat UPDATE further
 *            down were consequently never reached in production.
 *  - issue:  The card-number sequence SELECT (COUNT(*) FROM hrms.id_cards
 *            WHERE tenant_id=$1) silently returned 0 rows with no GUC set,
 *            so every issued card so far got sequence 1 (masked until two
 *            concurrent issues collided on the (tenant_id, card_number)
 *            unique constraint). Separately, the issuer-name lookup selected
 *            `first_name, last_name ... WHERE user_id = $1` against
 *            employee.hrms_employees — none of those three identifiers are
 *            real columns (real: `full_name`, `user_ref`) — a hard DB error
 *            that fired on every issue attempt, masking the RLS gap behind
 *            an unconditional 500 (this is the "issue's own separate,
 *            unrelated bug" flagged in PR #893's own description).
 *
 * Each suite below seeds fixtures through a tenant-scoped path that DOES set
 * the GUC (Drizzle `db.transaction()` for employee.hrms_employees via
 * runWithTenant, or `withRawTenantGuc` directly for hrms.id_cards /
 * id_card_verifications, mirroring tests/routes-coverage-g.test.ts's
 * `seedIdCard` helper), then calls the real HTTP route and asserts it can
 * see/write what the fixture proves is really there. See this PR's
 * description for the git-stash-and-rerun transcript demonstrating each
 * assertion actually fails against the pre-fix code.
 */
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import { runWithTenant, withRawTenantGuc } from "@civitasone/db";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { hrmsDepartments, hrmsDesignations, hrmsEmployees } from "../src/modules/employee/schema.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "0b2b6f00-4000-4000-8000-000000000901";
const OTHER_TENANT = "0b2b6f00-4000-4000-8000-000000000902";
const ACTOR = "0b2b6f00-5000-4000-8000-000000000901";
const DEPT = "0b2b6f00-6000-4000-8000-000000000901";
const DESIGNATION = "0b2b6f00-7000-4000-8000-000000000901";
const EMPLOYEE = "0b2b6f00-8000-4000-8000-000000000901";

function authHeader(roles = ["hr_admin", "security_admin", "super_admin"], tenantId = TENANT, actor = ACTOR) {
  const token = signToken({ sub: actor, tid: tenantId, roles, sid: "sess-idcards-901" }, SECRET, 3600);
  return { authorization: `Bearer ${token}` };
}

async function cleanup(): Promise<void> {
  for (const tenantId of [TENANT, OTHER_TENANT]) {
    await withRawTenantGuc(sqlClient, tenantId, (tx) => tx`DELETE FROM hrms.id_card_verifications WHERE tenant_id = ${tenantId}`);
    await withRawTenantGuc(sqlClient, tenantId, (tx) => tx`DELETE FROM hrms.id_cards WHERE tenant_id = ${tenantId}`);
  }
  await runWithTenant(TENANT, () =>
    db.transaction(async (tx) => {
      await tx.delete(hrmsEmployees).where(eq(hrmsEmployees.tenantId, TENANT));
      await tx.delete(hrmsDesignations).where(eq(hrmsDesignations.tenantId, TENANT));
      await tx.delete(hrmsDepartments).where(eq(hrmsDepartments.tenantId, TENANT));
    }),
  );
}

/** Seeds a department, designation and employee linked to ACTOR via userRef — the
 * same actorId-linkage column self-service/routes.ts and employee/actor-link.ts
 * already key employee lookups on. */
async function seedEmployee(): Promise<void> {
  await runWithTenant(TENANT, () =>
    db.transaction(async (tx) => {
      await tx.insert(hrmsDepartments).values({
        id: DEPT, tenantId: TENANT, code: "IDC", name: "ID Cards Test Dept",
        isActive: true, createdBy: ACTOR, updatedBy: ACTOR, version: 1,
      });
      await tx.insert(hrmsDesignations).values({
        id: DESIGNATION, tenantId: TENANT, code: "IDC-01", name: "Test Officer",
        level: 5, payGrade: "Grade-A", createdBy: ACTOR, updatedBy: ACTOR, version: 1,
      });
      await tx.insert(hrmsEmployees).values({
        id: EMPLOYEE, tenantId: TENANT, employeeNo: "IDC-E001", fullName: "Test Issuer",
        departmentId: DEPT, designationId: DESIGNATION, dateOfJoining: "2020-01-01",
        employeeType: "permanent", status: "confirmed", userRef: ACTOR,
        createdBy: ACTOR, updatedBy: ACTOR, version: 1,
      });
    }),
  );
}

/** Seeds a card directly against hrms.id_cards with the GUC correctly set —
 * mirrors tests/routes-coverage-g.test.ts's seedIdCard helper. */
async function seedIdCard(
  status: "active" | "suspended" | "revoked",
  opts: { employeeId?: string; tenantId?: string } = {},
): Promise<{ id: string; cardNumber: string }> {
  const id = randomUUID();
  const tenantId = opts.tenantId ?? TENANT;
  const cardNumber = `TST/${Date.now()}/${Math.floor(Math.random() * 100000)}`;
  await withRawTenantGuc(sqlClient, tenantId, (tx) => tx`
    INSERT INTO hrms.id_cards
      (id, tenant_id, holder_name, card_type, card_number, employee_id, valid_until, status, qr_payload, issued_by)
    VALUES
      (${id}, ${tenantId}, 'RLS Fixture Holder', 'employee', ${cardNumber}, ${opts.employeeId ?? null}, '2030-01-01', ${status}, 'CVO1:fixture:fixture', ${ACTOR})
  `);
  return { id, cardNumber };
}

async function rawCardRow(id: string, tenantId: string = TENANT): Promise<any> {
  const rows = await withRawTenantGuc(sqlClient, tenantId, (tx) => tx`SELECT * FROM hrms.id_cards WHERE id = ${id}`);
  return (rows as unknown as any[])[0];
}

async function rawVerificationRows(cardId: string, tenantId: string = TENANT): Promise<any[]> {
  return (await withRawTenantGuc(sqlClient, tenantId, (tx) => tx`SELECT * FROM hrms.id_card_verifications WHERE card_id = ${cardId}`)) as unknown as any[];
}

beforeEach(cleanup);
afterAll(async () => { await cleanup(); await sqlClient.end(); });

describe("POST /v1/hrms/id-cards (issue)", () => {
  it("issues a card end-to-end and records the real issuer name (regression: RLS-GUC gap + user_id/first_name/last_name columns that don't exist on employee.hrms_employees)", async () => {
    await seedEmployee();

    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/hrms/id-cards",
      headers: authHeader(),
      payload: { holderName: "New Employee", cardType: "employee", validUntil: "2030-12-31" },
    });
    await app.close();

    expect(res.statusCode).toBe(201);
    const body = res.json() as { id: string; cardNumber: string; qrPayload: string; status: string };
    expect(body.status).toBe("active");
    expect(body.cardNumber).toMatch(/^DIC\/\d{4}\/00001$/);

    // Independently verify the row landed with the tenant it was requested
    // for, and that the issuer name was resolved from the real employee row
    // (not the "Admin" fallback) — proves the column-name fix, not just the
    // GUC fix.
    const row = await rawCardRow(body.id);
    expect(row).toBeTruthy();
    expect(row.tenant_id).toBe(TENANT);
    expect(row.issued_by_name).toBe("Test Issuer");
    expect(row.issued_by).toBe(ACTOR);
  });

  it("falls back to 'Admin' when the issuer has no linked employee row (pre-existing fallback, unchanged by this fix)", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/hrms/id-cards",
      headers: authHeader(),
      payload: { holderName: "Another Employee", cardType: "employee", validUntil: "2030-12-31" },
    });
    await app.close();

    expect(res.statusCode).toBe(201);
    const row = await rawCardRow(res.json().id);
    expect(row.issued_by_name).toBe("Admin");
  });

  it("assigns a real, incrementing sequence number across issues (regression: seq always read 1 with no GUC set, which would collide on the tenant_id+card_number unique constraint)", async () => {
    const app = await buildApp();
    const first = await app.inject({
      method: "POST", url: "/v1/hrms/id-cards", headers: authHeader(),
      payload: { holderName: "Card One", cardType: "employee", validUntil: "2030-12-31" },
    });
    const second = await app.inject({
      method: "POST", url: "/v1/hrms/id-cards", headers: authHeader(),
      payload: { holderName: "Card Two", cardType: "employee", validUntil: "2030-12-31" },
    });
    await app.close();

    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
    expect(first.json().cardNumber).toMatch(/00001$/);
    expect(second.json().cardNumber).toMatch(/00002$/);
  });

  it("tenant isolation: a fresh tenant's sequence is unaffected by another tenant's cards", async () => {
    await seedIdCard("active", { tenantId: OTHER_TENANT });

    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: "/v1/hrms/id-cards", headers: authHeader(),
      payload: { holderName: "Isolated Tenant Card", cardType: "employee", validUntil: "2030-12-31" },
    });
    await app.close();

    expect(res.statusCode).toBe(201);
    expect(res.json().cardNumber).toMatch(/00001$/);
  });

  it("returns 403 for a role without issue access (pre-existing check, unchanged)", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: "/v1/hrms/id-cards", headers: authHeader(["employee"]),
      payload: { holderName: "Should Not Issue", cardType: "employee", validUntil: "2030-12-31" },
    });
    await app.close();

    expect(res.statusCode).toBe(403);
  });
});

describe("GET /v1/hrms/id-cards (list)", () => {
  it("sees a seeded card (regression: RLS-GUC gap always returned an empty list)", async () => {
    const { id } = await seedIdCard("active");

    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/hrms/id-cards", headers: authHeader() });
    await app.close();

    expect(res.statusCode).toBe(200);
    const data = res.json().data as Array<{ id: string }>;
    expect(data.some((c) => c.id === id)).toBe(true);
  });

  it("filters by status", async () => {
    await seedIdCard("active");
    await seedIdCard("suspended");

    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/hrms/id-cards?status=suspended", headers: authHeader() });
    await app.close();

    const data = res.json().data as Array<{ status: string }>;
    expect(data.length).toBeGreaterThan(0);
    expect(data.every((c) => c.status === "suspended")).toBe(true);
  });

  it("tenant isolation: another tenant sees none of this tenant's cards", async () => {
    await seedIdCard("active");

    const app = await buildApp();
    const res = await app.inject({
      method: "GET", url: "/v1/hrms/id-cards",
      headers: authHeader(["hr_admin", "security_admin", "super_admin"], OTHER_TENANT),
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    expect(res.json().data).toEqual([]);
  });
});

describe("GET /v1/hrms/id-cards/me", () => {
  it("returns the caller's active card (regression: RLS-GUC gap on hrms.id_cards + user_id column that doesn't exist on employee.hrms_employees)", async () => {
    await seedEmployee();
    const { id } = await seedIdCard("active", { employeeId: EMPLOYEE });

    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/hrms/id-cards/me", headers: authHeader() });
    await app.close();

    expect(res.statusCode).toBe(200);
    expect(res.json().data.id).toBe(id);
  });

  it("returns 404 NO_CARD when the employee exists but has no active card", async () => {
    await seedEmployee();

    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/hrms/id-cards/me", headers: authHeader() });
    await app.close();

    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe("NO_CARD");
  });

  it("returns 404 NOT_FOUND when the caller has no linked employee record at all", async () => {
    const strangerActor = randomUUID();

    const app = await buildApp();
    const res = await app.inject({
      method: "GET", url: "/v1/hrms/id-cards/me",
      headers: authHeader(["employee"], TENANT, strangerActor),
    });
    await app.close();

    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe("NOT_FOUND");
  });

  it("tenant isolation: does not see an employee/card pair seeded under a different tenant", async () => {
    // Seed the employee+card under OTHER_TENANT (same ACTOR/userRef) but call
    // /me with a token for TENANT — the employee lookup must not cross tenants.
    const otherDept = randomUUID();
    const otherDesignation = randomUUID();
    await runWithTenant(OTHER_TENANT, () =>
      db.transaction(async (tx) => {
        await tx.insert(hrmsDepartments).values({
          id: otherDept, tenantId: OTHER_TENANT, code: "OTH", name: "Other Dept",
          isActive: true, createdBy: ACTOR, updatedBy: ACTOR, version: 1,
        });
        await tx.insert(hrmsDesignations).values({
          id: otherDesignation, tenantId: OTHER_TENANT, code: "OTH-01", name: "Other Officer",
          level: 5, payGrade: "Grade-A", createdBy: ACTOR, updatedBy: ACTOR, version: 1,
        });
        await tx.insert(hrmsEmployees).values({
          id: randomUUID(), tenantId: OTHER_TENANT, employeeNo: "OTH-E001", fullName: "Other Tenant Employee",
          departmentId: otherDept, designationId: otherDesignation, dateOfJoining: "2020-01-01",
          employeeType: "permanent", status: "confirmed", userRef: ACTOR,
          createdBy: ACTOR, updatedBy: ACTOR, version: 1,
        });
      }),
    );

    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/hrms/id-cards/me", headers: authHeader() }); // TENANT, same ACTOR
    await app.close();
    await runWithTenant(OTHER_TENANT, () =>
      db.transaction(async (tx) => {
        await tx.delete(hrmsEmployees).where(eq(hrmsEmployees.tenantId, OTHER_TENANT));
        await tx.delete(hrmsDesignations).where(eq(hrmsDesignations.tenantId, OTHER_TENANT));
        await tx.delete(hrmsDepartments).where(eq(hrmsDepartments.tenantId, OTHER_TENANT));
      }),
    );

    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe("NOT_FOUND");
  });
});

describe("POST /v1/hrms/id-cards/verify", () => {
  it("verifies a real, active card and records the scan (regression: RLS-GUC gap made every scan of a genuinely valid card return 'unknown')", async () => {
    const app = await buildApp();
    const issued = await app.inject({
      method: "POST", url: "/v1/hrms/id-cards", headers: authHeader(),
      payload: { holderName: "Guard Test Holder", cardType: "employee", validUntil: "2030-12-31" },
    });
    expect(issued.statusCode).toBe(201);
    const { id: cardId, qrPayload } = issued.json() as { id: string; qrPayload: string };

    const res = await app.inject({
      method: "POST", url: "/v1/hrms/id-cards/verify", headers: authHeader(),
      payload: { qrPayload, location: "Main Gate" },
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    const body = res.json() as { result: string; card: { holderName: string } };
    expect(body.result).toBe("valid");
    expect(body.card.holderName).toBe("Guard Test Holder");

    const row = await rawCardRow(cardId);
    expect(row.verification_count).toBe(1);
    expect(row.last_verified_by).toBe(ACTOR);

    const verifications = await rawVerificationRows(cardId);
    expect(verifications).toHaveLength(1);
    expect(verifications[0].result).toBe("valid");
    expect(verifications[0].location).toBe("Main Gate");
  });

  it("reports 'suspended'/'revoked' status correctly for a real card in that state", async () => {
    const { id, cardNumber } = await seedIdCard("suspended");
    // Recompute the same HMAC-signed QR payload the route would have generated
    // (CVO1:<id>:<hmac>) is internal to routes.ts; the route only needs a
    // well-formed CVO1:<id>:<anything> payload since the HMAC segment is not
    // re-validated against a signature in this handler (verifyQrPayload's own
    // documented contract: "Full HMAC check done via DB lookup", i.e. by id).
    const qrPayload = `CVO1:${id}:doesnotneedtomatch`;
    void cardNumber;

    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: "/v1/hrms/id-cards/verify", headers: authHeader(),
      payload: { qrPayload },
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    expect(res.json().result).toBe("suspended");
  });

  it("returns 'unknown' for a well-formed QR pointing at a card that genuinely doesn't exist (unchanged pre-existing behavior)", async () => {
    const qrPayload = `CVO1:${randomUUID()}:doesnotexist`;

    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: "/v1/hrms/id-cards/verify", headers: authHeader(),
      payload: { qrPayload },
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    expect(res.json().result).toBe("unknown");
  });

  it("tenant isolation: cannot verify another tenant's real card — same 'unknown' result and no cross-tenant data leak, not an error", async () => {
    const { id } = await seedIdCard("active", { tenantId: OTHER_TENANT });
    const qrPayload = `CVO1:${id}:x`;

    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: "/v1/hrms/id-cards/verify", headers: authHeader(), // token is for TENANT
      payload: { qrPayload },
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    expect(res.json().result).toBe("unknown");

    // And the other tenant's card was not touched by this cross-tenant attempt.
    const row = await rawCardRow(id, OTHER_TENANT);
    expect(row.verification_count).toBe(0);
  });
});
