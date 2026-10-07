/**
 * GAP-PROJECTS-DPR-TRACKING-01 / GAP-PROJECTS-ESCALATIONS-02 — route-level
 * authz for the new workflow endpoints. DB-backed (buildApp + app.inject
 * against the test Postgres): proves the server enforces authentication (401)
 * and role authorization (403) and validation (400) — i.e. the controls are
 * NOT UI-only. A reviewer/action role is accepted (202 Accepted, CQRS).
 */
import { describe, it, expect, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { randomUUID } from "node:crypto";
import { sqlClient } from "../src/shared/db.js";
import { buildApp } from "../src/app.js";

const SECRET = process.env.JWT_SECRET as string;
const TENANT = "aa110001-1111-4000-8000-000000a10001";
const ACTOR = "aa11aaaa-1111-4000-8000-000000a1000a";

function token(roles: string[]): string {
  return signToken({ sub: ACTOR, tid: TENANT, roles, sid: "sess-proj" }, SECRET, 3600);
}
const PROJECT = randomUUID();
const DPR = randomUUID();

afterAll(async () => { await sqlClient.end(); });

describe("PATCH /v1/projects/:id/dpr/:dprId/transition — authz (GAP-PROJECTS-DPR-TRACKING-01)", () => {
  it("401 without a token", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "PATCH", url: `/v1/projects/${PROJECT}/dpr/${DPR}/transition`, payload: { action: "review" } });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("403 for a plain project_officer (submitter cannot review/approve)", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "PATCH", url: `/v1/projects/${PROJECT}/dpr/${DPR}/transition`,
      headers: { authorization: `Bearer ${token(["project_officer"])}` },
      payload: { action: "approve" },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });

  it("400 when a return carries no reason, for an authorised reviewer", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "PATCH", url: `/v1/projects/${PROJECT}/dpr/${DPR}/transition`,
      headers: { authorization: `Bearer ${token(["project_manager"])}` },
      payload: { action: "return" },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("REASON_REQUIRED");
  });

  it("202 for an authorised reviewer with a valid action (command accepted)", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "PATCH", url: `/v1/projects/${PROJECT}/dpr/${DPR}/transition`,
      headers: { authorization: `Bearer ${token(["project_manager"])}` },
      payload: { action: "review" },
    });
    await app.close();
    expect(res.statusCode).toBe(202);
  });
});

describe("POST /v1/projects/:id/escalation/* — authz (GAP-PROJECTS-ESCALATIONS-02)", () => {
  it("401 without a token", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: `/v1/projects/${PROJECT}/escalation/acknowledge`, payload: {} });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("403 for a plain project_officer", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: `/v1/projects/${PROJECT}/escalation/clear`,
      headers: { authorization: `Bearer ${token(["project_officer"])}` },
      payload: { reason: "done" },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });

  it("400 when clear carries no reason, for an authorised actor", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: `/v1/projects/${PROJECT}/escalation/clear`,
      headers: { authorization: `Bearer ${token(["project_manager"])}` },
      payload: {},
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("202 for an authorised actor acknowledging (command accepted)", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: `/v1/projects/${PROJECT}/escalation/acknowledge`,
      headers: { authorization: `Bearer ${token(["project_manager"])}` },
      payload: { severity: "blocked", issue: "Critical blocker" },
    });
    await app.close();
    expect(res.statusCode).toBe(202);
  });
});
