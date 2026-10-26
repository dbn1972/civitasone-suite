/**
 * GAP-POLICY-EVALUATE-05: POST /v1/policy/evaluate must write a decision-log
 * event that the audit-service actually ingests (topic `audit.event.record`),
 * carrying subject, permission and decision. It previously went to the
 * `policy.decision` topic, which nothing consumes, so probing was untraceable.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";

const SECRET = process.env.JWT_SECRET ?? globalThis.crypto.randomUUID();
const TENANT = randomUUID();
const ACTOR = randomUUID();

const hdr = (roles: string[]) => ({
  authorization: `Bearer ${signToken({ sub: ACTOR, tid: TENANT, roles, sid: "s1" }, SECRET, 3600)}`,
  "content-type": "application/json",
});

let app: FastifyInstance;
beforeAll(async () => { app = await buildApp(); });
afterAll(async () => { await app.close(); await sqlClient.end(); });

async function decisionEvents(): Promise<Array<{ topic: string; payload: Record<string, unknown> }>> {
  const rows = await sqlClient.begin(async (q) => {
    await q`SELECT set_config('app.tenant_id', ${TENANT}, true)`;
    return q<Array<{ topic: string; payload: unknown }>>`
      SELECT topic, payload FROM _outbox.messages WHERE tenant_id = ${TENANT} ORDER BY created_at`;
  });
  return rows
    .map((r) => ({ topic: r.topic, payload: (typeof r.payload === "string" ? JSON.parse(r.payload) : r.payload) as Record<string, unknown> }))
    .filter((r) => r.payload.permissionKey !== undefined);
}

describe("GAP-POLICY-EVALUATE-05 evaluate decision log", () => {
  it("writes a decision-log event on the audit topic with subject, permission and decision", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/policy/evaluate",
      headers: hdr(["super_admin"]),
      payload: { permissionKey: "finance.budget.approve" },
    });
    expect(res.statusCode).toBe(200);
    const events = await decisionEvents();
    expect(events.length).toBe(1);
    expect(events[0]!.topic).toBe("audit.event.record");
    expect(events[0]!.payload).toMatchObject({
      eventType: "policy.decision",
      action: "evaluate",
      resourceType: "permission",
      resourceId: "finance.budget.approve",
      permissionKey: "finance.budget.approve",
      decision: "allow",
      subjectUserId: ACTOR,
    });
  });

  it("logs a DENY for an admin evaluating another user", async () => {
    const subject = randomUUID();
    const before = (await decisionEvents()).length;
    const res = await app.inject({
      method: "POST", url: "/v1/policy/evaluate",
      headers: hdr(["tenant_admin"]),
      payload: { permissionKey: "hrms.leave.approve", subjectUserId: subject },
    });
    expect(res.statusCode).toBe(200);
    const events = await decisionEvents();
    expect(events.length).toBe(before + 1);
    expect(events.at(-1)!.topic).toBe("audit.event.record");
    expect(events.at(-1)!.payload).toMatchObject({ decision: "deny", subjectUserId: subject, onBehalfOf: subject });
  });

  it("does not log a decision for a forbidden (403) subject override", async () => {
    const before = (await decisionEvents()).length;
    const res = await app.inject({
      method: "POST", url: "/v1/policy/evaluate",
      headers: hdr(["staff"]),
      payload: { permissionKey: "hrms.leave.approve", subjectUserId: randomUUID() },
    });
    expect(res.statusCode).toBe(403);
    expect((await decisionEvents()).length).toBe(before);
  });
});
