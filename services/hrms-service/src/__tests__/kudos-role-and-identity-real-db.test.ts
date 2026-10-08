/**
 * POST /v1/hrms/kudos role gate + kudos identity-space fixes.
 *
 * GAP2-HR-SOCIAL-FEED-07 (SEC): the kudos-create route had NO requireRole --
 * any authenticated tenant principal (even a role outside the feature's
 * audience) could insert a kudos row and queue a push. Assert a caller whose
 * only role is outside ALL_ROLES is rejected 403 before any write.
 *
 * GAP2-HR-SOCIAL-FEED-08 (CROSS): kudos rows mixed two identity spaces --
 * giver_id was stored as ctx.actorId (a user_ref) while receiver_id is an
 * hrms_employees.id, so the feed's "my received" stat (receiver_id =
 * ctx.actorId) was permanently 0. Assert that after A gives B kudos, B's
 * /kudos/feed myReceived == 1 and giver_id is stored as A's employee id.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import { withRawTenantGuc } from "@civitasone/db";
import { buildApp } from "../app.js";
import { sqlClient } from "../shared/db.js";
import type { FastifyInstance } from "fastify";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = randomUUID();
const GIVER_ACTOR = randomUUID();
const RECEIVER_ACTOR = randomUUID();

function auth(sub: string, roles: string[]): { authorization: string } {
  return { authorization: `Bearer ${signToken({ sub, tid: TENANT, roles, sid: "sess-kudos" }, SECRET, 3600)}` };
}

async function seedEmployee(opts: { actorId: string; fullName: string }): Promise<string> {
  const id = randomUUID();
  await withRawTenantGuc(sqlClient, TENANT, (tx) => tx`
    INSERT INTO employee.hrms_employees
      (id, tenant_id, employee_no, full_name, department_id, designation_id, date_of_joining, status, user_ref, created_by, updated_by)
    VALUES
      (${id}, ${TENANT}, ${`KDS-${id.slice(0, 8)}`}, ${opts.fullName}, ${randomUUID()}, ${randomUUID()}, '2020-01-01', 'confirmed', ${opts.actorId}, ${opts.actorId}, ${opts.actorId})
  `);
  return id;
}

let app: FastifyInstance;
let giverEmpId: string;
let receiverEmpId: string;

beforeAll(async () => {
  app = await buildApp();
  giverEmpId = await seedEmployee({ actorId: GIVER_ACTOR, fullName: "Giver Kudos-Test" });
  receiverEmpId = await seedEmployee({ actorId: RECEIVER_ACTOR, fullName: "Receiver Kudos-Test" });
});

afterAll(async () => {
  await withRawTenantGuc(sqlClient, TENANT, (tx) => tx`DELETE FROM employee.hrms_social_kudos WHERE tenant_id = ${TENANT}`);
  await withRawTenantGuc(sqlClient, TENANT, (tx) => tx`DELETE FROM employee.hrms_employees WHERE tenant_id = ${TENANT}`);
  await app.close();
  await sqlClient.end();
});

describe("POST /v1/hrms/kudos — role gate (GAP2-HR-SOCIAL-FEED-07)", () => {
  it("a caller whose only role is outside ALL_ROLES is rejected (403) before any write", async () => {
    const before = await withRawTenantGuc(sqlClient, TENANT, (tx) => tx`SELECT COUNT(*)::int AS n FROM employee.hrms_social_kudos WHERE tenant_id = ${TENANT}`) as unknown as Array<{ n: number }>;
    const r = await app.inject({
      method: "POST", url: "/v1/hrms/kudos", headers: auth(GIVER_ACTOR, ["guest"]),
      payload: { receiverId: receiverEmpId, badge: "star", message: "Great work on the release" },
    });
    expect(r.statusCode).toBe(403);
    const after = await withRawTenantGuc(sqlClient, TENANT, (tx) => tx`SELECT COUNT(*)::int AS n FROM employee.hrms_social_kudos WHERE tenant_id = ${TENANT}`) as unknown as Array<{ n: number }>;
    expect(after[0]!.n).toBe(before[0]!.n);
  });
});

describe("kudos identity space (GAP2-HR-SOCIAL-FEED-08)", () => {
  it("giver_id is stored as the giver's hrms_employees.id, not the actor user_ref", async () => {
    const r = await app.inject({
      method: "POST", url: "/v1/hrms/kudos", headers: auth(GIVER_ACTOR, ["employee"]),
      payload: { receiverId: receiverEmpId, badge: "rocket", message: "Thanks for the help" },
    });
    expect(r.statusCode).toBe(201);
    const rows = await withRawTenantGuc(sqlClient, TENANT, (tx) => tx`
      SELECT giver_id, receiver_id FROM employee.hrms_social_kudos WHERE tenant_id = ${TENANT} AND receiver_id = ${receiverEmpId} ORDER BY created_at DESC LIMIT 1
    `) as unknown as Array<{ giver_id: string; receiver_id: string }>;
    expect(rows[0]!.giver_id).toBe(giverEmpId);
    expect(rows[0]!.giver_id).not.toBe(GIVER_ACTOR);
    expect(rows[0]!.receiver_id).toBe(receiverEmpId);
  });

  it("the receiver's /kudos/feed myReceived counts the kudos they received", async () => {
    const r = await app.inject({ method: "GET", url: "/v1/hrms/kudos/feed", headers: auth(RECEIVER_ACTOR, ["employee"]) });
    expect(r.statusCode).toBe(200);
    expect(r.json().myReceived).toBeGreaterThanOrEqual(1);
  });
});
