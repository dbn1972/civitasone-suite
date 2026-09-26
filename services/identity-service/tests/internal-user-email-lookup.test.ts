/**
 * Identity Service — internal single-user email lookup.
 *
 * SEC fix support test: GET /identity/internal/users/:id/email was added so
 * hrms-service (and payroll-service, transitively) can stop trusting a
 * client-supplied x-user-email header for the actor-link email-fallback
 * bootstrap (see hrms-service's employee/actor-link.ts resolveEmployeeForActor
 * doc comment for the full vulnerability writeup). Since this endpoint
 * returns a real, targeted PII field (one user's email) rather than a bulk
 * display name, it is gated more strictly than its sibling /user-summaries
 * route (resolveContext + requireRole, not a bare header read) -- this test
 * pins that gate so it cannot silently regress into a new IDOR.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { withRawTenantGuc } from "@civitasone/db";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";

const SECRET = process.env.JWT_SECRET as string;
const INTERNAL_SECRET = process.env.INTERNAL_SERVICE_SECRET ?? "test-internal-service-secret-32chr";

const TENANT     = "cc330002-2222-4000-8000-0000000e0001";
const SEED_BY    = "cc330002-2222-4000-8000-0000000e0099";
const USER_ID    = "cc330002-2222-4000-8000-0000000e00e1";
const USER_EMAIL = "e2001@example.gov.in";
const UNKNOWN_ID = "cc330002-2222-4000-8000-0000000e9999";

function asTenant<T>(fn: (tx: typeof sqlClient) => Promise<T>): Promise<T> {
  return withRawTenantGuc(sqlClient, TENANT, fn);
}

let app: Awaited<ReturnType<typeof buildApp>>;

beforeAll(async () => {
  await asTenant((tx) => tx`DELETE FROM users.users WHERE tenant_id = ${TENANT}`);
  await asTenant((tx) => tx`
    INSERT INTO users.users (id, tenant_id, email, name, status, created_by, updated_by)
    VALUES (${USER_ID}, ${TENANT}, ${USER_EMAIL}, 'Lookup Test User', 'active', ${SEED_BY}, ${SEED_BY})
  `);
  app = await buildApp();
});

afterAll(async () => {
  await asTenant((tx) => tx`DELETE FROM users.users WHERE tenant_id = ${TENANT}`);
  await app.close();
});

describe("GET /identity/internal/users/:id/email", () => {
  it("401 without any credential", async () => {
    const res = await app.inject({ method: "GET", url: `/identity/internal/users/${USER_ID}/email` });
    expect(res.statusCode).toBe(401);
  });

  it("403 for an ordinary authenticated employee (real JWT, not super_admin, no x-internal)", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/identity/internal/users/${USER_ID}/email`,
      headers: {
        authorization: `Bearer ${signToken({ sub: "some-employee", tid: TENANT, roles: ["employee"], sid: "s1" }, SECRET, 3600)}`,
      },
    });
    expect(res.statusCode).toBe(403);
  });

  it("200 with EXACTLY this user's email for a genuine internal-elevated caller", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/identity/internal/users/${USER_ID}/email`,
      headers: { "x-internal": "1", "x-tenant-id": TENANT, "x-service-secret": INTERNAL_SECRET },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ id: USER_ID, email: USER_EMAIL });
  });

  it("404 for an id that does not exist in this tenant", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/identity/internal/users/${UNKNOWN_ID}/email`,
      headers: { "x-internal": "1", "x-tenant-id": TENANT, "x-service-secret": INTERNAL_SECRET },
    });
    expect(res.statusCode).toBe(404);
  });

  it("rejects a forged x-service-secret (401), never falls through to a lookup", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/identity/internal/users/${USER_ID}/email`,
      headers: { "x-internal": "1", "x-tenant-id": TENANT, "x-service-secret": "totally-wrong-secret" },
    });
    expect(res.statusCode).toBe(401);
  });
});
