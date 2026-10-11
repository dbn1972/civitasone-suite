/**
 * CAP-094 — integration: expiry + ownership persist through the command/consumer
 * write path, and the evaluate endpoint returns a deterministic decision.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { registerFeatureFlagConsumers } from "../src/modules/feature-flags/consumer.js";
import { drainOrFail } from "../../../vitest.drain";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "dddddddd-eeee-4000-8000-0000000000f1";
const ADMIN = "99999999-eeee-4000-8000-000000000009";

function auth(roles: string[] = ["platform_admin"], tenantId = TENANT) {
  return { authorization: `Bearer ${signToken({ sub: ADMIN, tid: tenantId, roles, sid: "s" }, SECRET, 3600)}` };
}

let app: FastifyInstance;
beforeAll(async () => {
  registerFeatureFlagConsumers(queue);
  await queue.start();
  app = await buildApp();
});
afterAll(async () => { await app.close(); await queue.stop(); await sqlClient.end(); });

// The create command is applied by an async consumer. Quiesce the queue
// (bounded, fails on timeout) so the write has committed AND the list cache has
// been invalidated, then read once. Polling instead raced the consumer: a poll
// that read the list before the commit could re-populate the cache with the
// stale (empty) list after the consumer invalidated it, and every later poll in
// the budget then hit that stale cache.
async function waitForFlag(key: string): Promise<{ id: string; owner: string; expiresAt: string }> {
  await drainOrFail(queue, 20_000, `feature-flag create (${key})`);
  const list = await app.inject({ method: "GET", url: "/v1/admin/feature-flags/manage", headers: auth() });
  const row = (list.json().data as Array<{ id: string; key: string; owner: string; expiresAt: string }>).find((r) => r.key === key);
  if (!row) throw new Error(`flag ${key} never appeared after the queue drained`);
  return row;
}

describe("feature-flags rollout — expiry + owner + evaluate", () => {
  it("persists owner + expiry on create and evaluates deterministically", async () => {
    const key = `rollout-${Date.now()}`;
    const future = new Date(Date.now() + 3_600_000).toISOString();
    const create = await app.inject({
      method: "POST", url: "/v1/admin/feature-flags/manage", headers: auth(),
      payload: { key, name: "Rollout", enabled: true, rolloutPercent: 100, owner: "team-payments", expiresAt: future },
    });
    expect(create.statusCode).toBe(202);
    const row = await waitForFlag(key);
    expect(row.owner).toBe("team-payments");
    expect(row.expiresAt).toBeTruthy();

    const evalRes = await app.inject({ method: "GET", url: `/v1/admin/feature-flags/manage/${row.id}/evaluate?subjectId=user-1`, headers: auth() });
    expect(evalRes.statusCode).toBe(200);
    expect(evalRes.json()).toMatchObject({ enabled: true, reason: "percentage_in" });
  });

  it("an expired flag evaluates OFF", async () => {
    const key = `expired-${Date.now()}`;
    const past = new Date(Date.now() - 1000).toISOString();
    const create = await app.inject({
      method: "POST", url: "/v1/admin/feature-flags/manage", headers: auth(),
      payload: { key, name: "Expired", enabled: true, rolloutPercent: 100, expiresAt: past },
    });
    expect(create.statusCode).toBe(202);
    const row = await waitForFlag(key);
    const evalRes = await app.inject({ method: "GET", url: `/v1/admin/feature-flags/manage/${row.id}/evaluate?subjectId=user-1`, headers: auth() });
    expect(evalRes.json()).toMatchObject({ enabled: false, reason: "expired" });
  });

  it("404 for an unknown flag id", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/admin/feature-flags/manage/00000000-0000-4000-8000-000000000000/evaluate?subjectId=x", headers: auth() });
    expect(res.statusCode).toBe(404);
  });
});
