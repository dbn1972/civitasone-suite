/**
 * Regression test for a real, live validation gap in the social module: POST
 * /v1/hrms/birthdays/:id/wish took `id` straight from the URL and `message`
 * straight from the body with no Zod schema, no check that the target
 * employee exists, and no tenant scoping at all -- unlike every other write
 * in this same file (see social/routes.ts's own header comment on
 * withTenantGuc/FORCE RLS, and the kudos handler's RECEIVER_NOT_FOUND check
 * this fix mirrors). Any authenticated user of any tenant could "send a
 * wish" to an arbitrary UUID, including one belonging to a different
 * tenant -- recipient/recipientId on the published event were never
 * validated against anything.
 *
 * Fixed by adding: a Zod body schema bounding `message`; a
 * withTenantGuc-wrapped existence check (`WHERE id = $1 AND tenant_id =
 * $2`, same shape as kudos's receiverRow lookup) so a nonexistent OR
 * cross-tenant id 404s instead of silently "succeeding"; and a self-wish
 * guard mirroring this file's existing SELF_APPROVAL pattern for
 * travel-requests/expenses.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import postgres from "postgres";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { seedHrmsCoreFixtures } from "./fixtures/core-seed.js";

const SECRET = "test_secret_for_civitasone_32chr";
const TENANT_T = "00000000-0000-0000-0000-000000000001"; // core-seed's demo tenant
const OTHER_TENANT = "aaaaaaaa-1111-4000-8000-000000000099"; // a real, different tenant (announcements-authz.test.ts's) -- just needs to not be TENANT_T
const EMP001 = "eeeeeeee-0001-0000-0000-000000000005"; // core-seed's Ravi Kumar, tenant T only

// core-seed's own two employees never set user_ref, so neither can exercise
// the self-wish guard (giver lookup always comes back empty for them, which
// is itself exercised by the "same-tenant" test below). This one extra row
// -- seeded only by this file, not core-seed.ts -- has user_ref set to the
// GIVER token's `sub` specifically so the self-wish path has something to
// match against.
const GIVER_EMP_ID = "eeeeeeee-b1a7-0000-0000-000000000001";
const GIVER_SUB = "eeeeeeee-b1a7-0000-0000-0000000000ff";

const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgres://hrms_svc:hrms_dev_pw@localhost:5435/civitas_hrms";

function token(roles: string[], tenant: string = TENANT_T, sub = "aaaaaaaa-9999-4000-8000-000000000009") {
  return signToken({ sub, tid: tenant, roles, sid: "s1" }, SECRET);
}

beforeAll(async () => {
  await seedHrmsCoreFixtures();

  // Minimal, idempotent (ON CONFLICT DO UPDATE by fixed id), scoped to this
  // file only -- does not touch core-seed.ts or any row it owns. FK targets
  // (department/designation ids) are core-seed's own, already seeded above.
  const sql = postgres(DATABASE_URL, { max: 1 });
  try {
    await sql.begin(async (tx) => {
      await tx.unsafe(`select set_config('app.tenant_id', '${TENANT_T}', true)`);
      await tx.unsafe(`
INSERT INTO employee.hrms_employees (id, tenant_id, employee_no, full_name, department_id, designation_id, date_of_joining, employee_type, status, basic_minor, currency, user_ref, created_at, updated_at, created_by, updated_by, version)
VALUES ('${GIVER_EMP_ID}', '${TENANT_T}', 'EMP-BDWISH-01', 'Test Giver', 'eeeeeeee-0001-0000-0000-000000000001', 'eeeeeeee-0001-0000-0000-000000000003', '2020-01-01', 'permanent', 'confirmed', 6000000, 'INR', '${GIVER_SUB}', now(), now(), '00000000-0000-0000-0000-000000000099', '00000000-0000-0000-0000-000000000099', 1)
ON CONFLICT (id) DO UPDATE SET user_ref = EXCLUDED.user_ref, updated_at = now();
`);
    });
  } finally {
    await sql.end({ timeout: 5 });
  }
});

afterAll(async () => {
  await sqlClient.end();
});

describe("POST /v1/hrms/birthdays/:id/wish -- validation, existence, and tenant scoping", () => {
  it("rejects an over-length message with 400 (Zod validation)", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url: `/v1/hrms/birthdays/${EMP001}/wish`,
      headers: { authorization: `Bearer ${token(["employee"])}` },
      payload: { message: "x".repeat(500) },
    });
    await app.close();
    expect(r.statusCode).toBe(400);
  });

  it("sends a wish to a real same-tenant employee (200)", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url: `/v1/hrms/birthdays/${EMP001}/wish`,
      headers: { authorization: `Bearer ${token(["employee"])}` },
      payload: { message: "Happy birthday!" },
    });
    await app.close();
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ status: "wish_sent" });
  });

  it("rejects a well-formed but nonexistent employee id with 404", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url: "/v1/hrms/birthdays/eeeeeeee-dead-0000-0000-000000000000/wish",
      headers: { authorization: `Bearer ${token(["employee"])}` },
      payload: {},
    });
    await app.close();
    expect(r.statusCode).toBe(404);
  });

  it("rejects a cross-tenant attempt: EMP001 exists only in tenant T, caller is in a different tenant", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url: `/v1/hrms/birthdays/${EMP001}/wish`,
      headers: { authorization: `Bearer ${token(["employee"], OTHER_TENANT)}` },
      payload: {},
    });
    await app.close();
    // Must NOT be 200 -- a cross-tenant id must never resolve to a real
    // recipient. 404 (not found in the caller's own tenant), not a leaked
    // success and not an unhandled 500.
    expect(r.statusCode).toBe(404);
  });

  it("rejects wishing yourself with 400 (SELF_WISH)", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url: `/v1/hrms/birthdays/${GIVER_EMP_ID}/wish`,
      headers: { authorization: `Bearer ${token(["employee"], TENANT_T, GIVER_SUB)}` },
      payload: {},
    });
    await app.close();
    expect(r.statusCode).toBe(400);
    expect(r.json()).toMatchObject({ code: "SELF_WISH" });
  });
});
