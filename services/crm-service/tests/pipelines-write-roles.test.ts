/**
 * GAP-CRM-HOME-01 (step 4) -- "confirm crm-service also rejects non-admin writes".
 *
 * The web hides the Engagement Pipelines tile and gates the /crm/pipelines route
 * to CRM admins, but hiding is UX only. The pipeline write routes admitted any
 * crm_user, so a plain user could create, reshape or delete the tenant's pipelines
 * by calling the API directly. Writes are now admin-only; reads are unchanged
 * (the deals board lists pipelines for every CRM user).
 *
 * Fails on the old code: the crm_user POST returned 202.
 */
import { randomUUID } from "node:crypto";
import { describe, it, expect, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";

// Set by vitest.config.ts (env.JWT_SECRET); no literal secret in the source.
const SECRET = process.env.JWT_SECRET as string;
const TENANT = randomUUID();
const ACTOR = randomUUID();

function headers(roles: string[]): Record<string, string> {
  return {
    authorization: `Bearer ${signToken({ sub: ACTOR, tid: TENANT, roles, sid: "s-pipe-roles" }, SECRET)}`,
    "x-tenant-id": TENANT,
  };
}

const app = await buildApp();
afterAll(async () => {
  await app.close();
  await sqlClient.end();
});

const stages = Array.from({ length: 4 }, (_, i) => ({
  id: randomUUID(),
  name: `Stage ${i + 1}`,
  probability: Math.round((i / 3) * 100),
  ordinal: i,
}));

describe("pipeline writes are admin-only", () => {
  it("refuses create, update and delete to a plain crm_user (403)", async () => {
    const id = randomUUID();
    const post = await app.inject({ method: "POST", url: "/v1/crm/pipelines", headers: headers(["crm_user"]), payload: { name: "Mine", stages } });
    expect(post.statusCode).toBe(403);
    const patch = await app.inject({ method: "PATCH", url: `/v1/crm/pipelines/${id}`, headers: headers(["crm_user"]), payload: { name: "Renamed" } });
    expect(patch.statusCode).toBe(403);
    const del = await app.inject({ method: "DELETE", url: `/v1/crm/pipelines/${id}`, headers: headers(["crm_user"]) });
    expect(del.statusCode).toBe(403);
  });

  it("still lets a crm_admin create a pipeline (202)", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/crm/pipelines", headers: headers(["crm_admin"]), payload: { name: "Engagement", stages } });
    expect(res.statusCode).toBe(202);
  });

  it("keeps reads open to a crm_user", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/crm/pipelines", headers: headers(["crm_user"]) });
    expect(res.statusCode).toBe(200);
  });
});
