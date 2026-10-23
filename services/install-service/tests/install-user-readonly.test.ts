import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";

const ACTOR = "00000000-aaaa-4000-8000-000000000098";
const TENANT = "11111111-aaaa-4000-8000-000000000098";
const ID = "22222222-bbbb-4000-8000-000000000098";
const SECRET = process.env.JWT_SECRET as string; // set by vitest.config.ts

const auth = (roles: string[]) => ({ authorization: `Bearer ${signToken({ sub: ACTOR, tid: TENANT, roles }, SECRET, 3600)}` });

let app: FastifyInstance;
beforeAll(async () => { app = await buildApp(); });
afterAll(async () => { await app.close(); });

describe("install_user is read-only on install mutations", () => {
  const mutations: Array<{ method: "POST" | "PATCH"; url: string; payload?: unknown }> = [
    { method: "PATCH", url: `/v1/install/steps/${ID}/run` },
    { method: "PATCH", url: `/v1/install/steps/${ID}/skip` },
    { method: "PATCH", url: `/v1/install/steps/${ID}/retry` },
    { method: "POST", url: "/v1/install/stages/3/domain-pack/activate", payload: {} },
    { method: "POST", url: "/v1/install/stages", payload: { name: "x", stepNumber: 1 } },
    { method: "POST", url: "/v1/install/wizards", payload: {} },
    { method: "POST", url: "/v1/install/wizards/onboarding", payload: {} },
    { method: "POST", url: `/v1/install/wizards/${ID}/steps/k/start` },
    { method: "POST", url: `/v1/install/wizards/${ID}/steps/k/complete`, payload: {} },
    { method: "POST", url: `/v1/install/wizards/${ID}/steps/k/skip`, payload: {} },
  ];

  for (const m of mutations) {
    it(`403 for install_user on ${m.method} ${m.url}`, async () => {
      const res = await app.inject({ method: m.method, url: m.url, headers: auth(["install_user"]), payload: m.payload as object });
      expect(res.statusCode).toBe(403);
    });
  }

  it("install_admin is allowed to PATCH a step (passes the role gate)", async () => {
    // #2161 step transition contract: an unknown step id is 404 NOT_FOUND from the
    // command (previously a blind 202). The intent here is the role gate: an
    // admin must get past 403, so assert the request reaches the command layer.
    const res = await app.inject({ method: "PATCH", url: `/v1/install/steps/${ID}/run`, headers: auth(["install_admin"]) });
    expect(res.statusCode).not.toBe(403);
    expect(res.statusCode).toBe(404);
  });

  it("install_user can still read stages", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/install/stages", headers: auth(["install_user"]) });
    expect(res.statusCode).toBe(200);
  });
});
