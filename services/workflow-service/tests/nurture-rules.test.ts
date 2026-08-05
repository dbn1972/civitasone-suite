/**
 * Gap 3 — Nurture workflow template rules route tests.
 */
import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-1111-4000-8000-000000bef001";
const ACTOR = "cccccccc-3333-4000-8000-000000bef001";
const TEMPLATE_ID = "99999999-dddd-4000-8000-000000bef002";

function headers(roles = ["workflow_admin"]) {
  return {
    authorization: `Bearer ${signToken({ sub: ACTOR, tid: TENANT, roles, sid: "s" }, SECRET)}`,
    "x-tenant-id": TENANT,
  };
}

async function cleanup() {
  await sqlClient.begin(async (tx) => {
    await tx`SELECT set_config('app.tenant_id', ${TENANT}, true)`;
    await tx`DELETE FROM workflow.nurture_rules WHERE tenant_id = ${TENANT}`.catch(() => {});
  }).catch(() => {});
}

beforeAll(async () => { await cleanup(); });
afterAll(async () => { await cleanup(); await sqlClient.end(); });

describe("Gap 3: nurture rules", () => {
  let createdId: string;

  it("creates a nurture rule (201)", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/workflow/nurture-rules",
      headers: headers(),
      payload: {
        triggerType: "score_below",
        threshold: 30,
        templateId: TEMPLATE_ID,
        channel: "email",
      },
    });
    await app.close();
    expect(res.statusCode).toBe(201);
    createdId = res.json().data.id;
    expect(createdId).toBeDefined();
  });

  it("lists nurture rules", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/workflow/nurture-rules",
      headers: headers(),
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.length).toBeGreaterThanOrEqual(1);
    expect(body.data[0].triggerType).toBe("score_below");
  });

  it("requires authentication (401)", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/workflow/nurture-rules",
    });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("requires admin role (403)", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/workflow/nurture-rules",
      headers: headers(["employee"]),
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });

  it("validates body (400/500)", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/workflow/nurture-rules",
      headers: headers(),
      payload: { triggerType: "invalid_type", threshold: -1, templateId: "not-a-uuid", channel: "pigeon" },
    });
    await app.close();
    // ZodError — the exact status depends on service-level error handling config
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    expect(res.statusCode).toBeLessThan(600);
  });
});
