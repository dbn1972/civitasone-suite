/**
 * SEC regression test — self-service identity hijack via a forged
 * x-user-email header (real-DB + real HTTP route round-trip).
 *
 * THE VULNERABILITY (fixed by this same change; see employee/actor-link.ts's
 * resolveEmployeeForActor doc comment for the full writeup): resolveEmployeeForActor
 * used to take a caller-supplied `email` argument, sourced by every route
 * from extractActorEmail(req), which read the raw `x-user-email` HTTP
 * header — a header the gateway's STRIP_HEADERS list does NOT strip and
 * which carries no relationship to the authenticated caller. Since employee
 * emails follow a predictable <empNo>@example.gov.in pattern, ANY
 * authenticated employee JWT could set x-user-email to a colleague's real
 * address and get that colleague's hrms_employees.userRef permanently
 * reassigned to the attacker's own actorId — a complete, repeatable
 * self-service identity takeover, reproduced live twice (a second attacker
 * could even re-steal the link from the first).
 *
 * THE FIX: resolveEmployeeForActor no longer accepts an email parameter at
 * all. When the primary userRef lookup misses, it derives the fallback
 * email itself from identity-service (fetchVerifiedActorEmail,
 * shared/identity-client.ts), keyed ONLY by the caller's own JWT-verified
 * actorId — there is no request shape that can steer this lookup toward a
 * DIFFERENT employee's row.
 *
 * This test exercises the real Fastify app (buildApp), a real Postgres
 * database (RLS included), and mocks only the outbound cross-service call
 * to identity-service — the actual external network boundary — so the
 * assertions below reflect the real route + real resolver + real DB
 * behavior, not a stubbed shortcut.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { signToken } from "@civitasone/auth";
import { withRawTenantGuc } from "@civitasone/db";
import { buildApp } from "../app.js";
import { sqlClient } from "../shared/db.js";
import { resolveEmployeeForActor } from "../modules/employee/actor-link.js";

vi.mock("../shared/identity-client.js", () => ({
  fetchVerifiedActorEmail: vi.fn(),
}));
import { fetchVerifiedActorEmail } from "../shared/identity-client.js";
const fetchVerifiedActorEmailMock = vi.mocked(fetchVerifiedActorEmail);

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";

const TENANT       = "facade00-1900-4000-8000-000000001900";
const SEED_ACTOR   = "facade00-1900-4000-8000-000000001999";
const DEPT_ID      = "facade00-1900-4000-8000-0000000019d1";
const DESIG_ID     = "facade00-1900-4000-8000-0000000019d2";

const VICTIM_EMP_ID     = "facade00-1900-4000-8000-0000000019e1";
const BOOTSTRAP_EMP_ID  = "facade00-1900-4000-8000-0000000019e2";

// Predictable <empNo>@example.gov.in pattern, exactly as described in the
// live finding — the attacker needs no inside knowledge to guess this.
const VICTIM_EMAIL    = "e1900002@example.gov.in";
const BOOTSTRAP_EMAIL = "e1900003@example.gov.in";

const VICTIM_SUB     = "hijack-victim-1900";    // victim's real actorId — ALREADY linked
const ATTACKER_SUB   = "hijack-attacker-1900";  // attacker's real, unrelated actorId
const BOOTSTRAP_SUB  = "hijack-bootstrap-1900"; // a genuine not-yet-linked employee's real actorId

function tok(roles: string[], sub: string) {
  return signToken({ sub, tid: TENANT, roles, sid: "sess-hijack-test" }, SECRET);
}
const attackerToken  = tok(["employee"], ATTACKER_SUB);
const bootstrapToken = tok(["employee"], BOOTSTRAP_SUB);

let app: Awaited<ReturnType<typeof buildApp>>;

// hrms_employees is RLS ENABLE+FORCEd — seed/verification queries need the
// same app.tenant_id GUC scopedRead sets. Same convention as every other
// *-real-db.test.ts in this directory.
function asTenant<T>(fn: (tx: typeof sqlClient) => Promise<T>): Promise<T> {
  return withRawTenantGuc(sqlClient, TENANT, fn);
}

async function cleanup(): Promise<void> {
  await asTenant((tx) => tx`DELETE FROM employee.hrms_employees WHERE tenant_id = ${TENANT}`);
  await asTenant((tx) => tx`DELETE FROM employee.hrms_designations WHERE tenant_id = ${TENANT}`);
  await asTenant((tx) => tx`DELETE FROM employee.hrms_departments WHERE tenant_id = ${TENANT}`);
}

beforeAll(async () => {
  await cleanup();

  await asTenant((tx) => tx`
    INSERT INTO employee.hrms_departments (id, tenant_id, code, name, created_by, updated_by)
    VALUES (${DEPT_ID}, ${TENANT}, 'HIJACK', 'Hijack Test Dept', ${SEED_ACTOR}, ${SEED_ACTOR})
  `);
  await asTenant((tx) => tx`
    INSERT INTO employee.hrms_designations (id, tenant_id, code, name, created_by, updated_by)
    VALUES (${DESIG_ID}, ${TENANT}, 'HIJACK', 'Hijack Test Designation', ${SEED_ACTOR}, ${SEED_ACTOR})
  `);

  // VICTIM: already legitimately linked (user_ref = VICTIM_SUB) — the state
  // of a real employee who has already completed their own genuine first
  // login. This is the record the attacker is trying to steal.
  await asTenant((tx) => tx`
    INSERT INTO employee.hrms_employees
      (id, tenant_id, employee_no, full_name, department_id, designation_id, date_of_joining, email, user_ref, created_by, updated_by)
    VALUES
      (${VICTIM_EMP_ID}, ${TENANT}, 'E1900002', 'Hijack Victim', ${DEPT_ID}, ${DESIG_ID}, '2022-01-01', ${VICTIM_EMAIL}, ${VICTIM_SUB}, ${SEED_ACTOR}, ${SEED_ACTOR})
  `);

  // BOOTSTRAP: seeded/onboarded with a real email but NOT yet linked
  // (user_ref NULL) — the genuine, LEGITIMATE first-login bootstrap case
  // this fix must continue to support.
  await asTenant((tx) => tx`
    INSERT INTO employee.hrms_employees
      (id, tenant_id, employee_no, full_name, department_id, designation_id, date_of_joining, email, created_by, updated_by)
    VALUES
      (${BOOTSTRAP_EMP_ID}, ${TENANT}, 'E1900003', 'Hijack Bootstrap Employee', ${DEPT_ID}, ${DESIG_ID}, '2023-01-01', ${BOOTSTRAP_EMAIL}, ${SEED_ACTOR}, ${SEED_ACTOR})
  `);

  app = await buildApp();
});

afterAll(async () => {
  await cleanup();
  await app.close();
});

beforeEach(() => {
  fetchVerifiedActorEmailMock.mockReset();
});

describe("actor-link email-fallback: self-service identity hijack (SEC fix)", () => {
  it("BLOCKS the attack: a forged x-user-email header naming a colleague's real email does not steal that colleague's userRef", async () => {
    // The attacker has no employee record of their own, so identity-service
    // (the only trusted source now) correctly reports no email match for
    // the attacker's OWN actorId — it is never asked about the victim.
    fetchVerifiedActorEmailMock.mockResolvedValue(undefined);

    const res = await app.inject({
      method: "GET",
      url: "/v1/hrms/me/profile",
      headers: {
        authorization: `Bearer ${attackerToken}`,
        // The forged header: the attacker asserts the VICTIM's real,
        // predictable email, trying to get the victim's row reassigned to
        // their own actorId. This must have zero effect.
        "x-user-email": VICTIM_EMAIL,
      },
    });

    // No linked record for the attacker, and the forged header is never
    // consulted for identity resolution — correctly 404, not a stolen profile.
    expect(res.statusCode).toBe(404);

    // The victim's row is untouched: still linked to the VICTIM's own
    // actorId, never reassigned to the attacker's.
    const victimRows = await asTenant((tx) => tx`
      SELECT user_ref FROM employee.hrms_employees WHERE id = ${VICTIM_EMP_ID}
    `);
    expect(victimRows[0]?.user_ref).toBe(VICTIM_SUB);

    // And the only lookup ever performed was keyed by the attacker's OWN
    // verified actorId — never by the victim's id or anything derived from
    // the x-user-email header.
    expect(fetchVerifiedActorEmailMock).toHaveBeenCalledTimes(1);
    expect(fetchVerifiedActorEmailMock).toHaveBeenCalledWith(TENANT, ATTACKER_SUB);
  });

  it("resolveEmployeeForActor itself has no parameter left through which any caller (route or cross-service) could name a target email or employee", async () => {
    // All ~18 call sites across hrms-service, and payroll-service
    // transitively (via hrms-service's own internal actor/resolve route),
    // share this one function. Calling it directly — bypassing HTTP
    // entirely — with the attacker's real tenantId/actorId and a truthful
    // (but non-matching) identity-service response proves the function is
    // safe by construction, not merely because one route happens to guard it.
    fetchVerifiedActorEmailMock.mockResolvedValue("attackers-own-real-address@example.gov.in");

    const result = await resolveEmployeeForActor(TENANT, ATTACKER_SUB);

    expect(result).toBeUndefined();
    expect(fetchVerifiedActorEmailMock).toHaveBeenCalledWith(TENANT, ATTACKER_SUB);

    const victimRows = await asTenant((tx) => tx`
      SELECT user_ref FROM employee.hrms_employees WHERE id = ${VICTIM_EMP_ID}
    `);
    expect(victimRows[0]?.user_ref).toBe(VICTIM_SUB);
  });

  it("PRESERVES the legitimate bootstrap: a genuinely-authenticated, not-yet-linked employee still gets auto-linked via their own verified email, no header involved", async () => {
    // identity-service correctly reports the bootstrap user's OWN real,
    // verified email for their OWN actorId. No x-user-email header is sent
    // at all in this request.
    fetchVerifiedActorEmailMock.mockImplementation(async (_tenantId: string, actorId: string) =>
      actorId === BOOTSTRAP_SUB ? BOOTSTRAP_EMAIL : undefined,
    );

    const res = await app.inject({
      method: "GET",
      url: "/v1/hrms/me/profile",
      headers: {
        authorization: `Bearer ${bootstrapToken}`,
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { id: string };
    expect(body.id).toBe(BOOTSTRAP_EMP_ID);

    // Auto-link must have happened, exactly as it did before this fix —
    // only the trusted source of the email changed.
    const rows = await asTenant((tx) => tx`
      SELECT user_ref FROM employee.hrms_employees WHERE id = ${BOOTSTRAP_EMP_ID}
    `);
    expect(rows[0]?.user_ref).toBe(BOOTSTRAP_SUB);
  });
});
