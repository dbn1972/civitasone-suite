/**
 * UAT W8-C (live API sweep, platform package) — plugin-service.
 *
 * 1. POST /v1/plugins/:id/enable published without reading the plugin: a random id got 202. It now does
 *    a tenant-scoped existence read first (repo.findByIdScoped; the bare repo.findById can never see a
 *    row under FORCE RLS): random id -> 404, nothing published; the real plugin -> 202.
 * 2. PUT /v1/plugins/:pluginId/store/:key with {} or a body without `value` answered 500: z.unknown()
 *    accepts a missing value and computeValueSize(undefined) threw a TypeError. Now a 400.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import { runWithTenant } from "@civitasone/db";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { plugins } from "../src/modules/registry/schema.js";

const SECRET = process.env.JWT_SECRET as string;
const TENANT = "8c000000-0000-4000-8000-0000000005a1";
const OTHER_TENANT = "8c000000-0000-4000-8000-0000000005b2";
const ACTOR = "8c000000-0000-4000-8000-0000000005c3";
const PLUGIN = randomUUID();
const INVALID_FIELDS = { id: "x".repeat(5000), amount: -1, email: "not-an-email", date: "31-31-2026" };

const headers = (tenant = TENANT) => ({
  authorization: `Bearer ${signToken({ sub: ACTOR, tid: tenant, roles: ["plugin_admin"], sid: "s-w8c" }, SECRET, 3600)}`,
});

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp();
  await runWithTenant(TENANT, () => db.transaction((tx) => tx.insert(plugins).values({
    id: PLUGIN, tenantId: TENANT, manifestJson: { name: "w8c-plugin", version: "1.0.0" }, state: "installed",
    createdBy: ACTOR, updatedBy: ACTOR,
  })));
});

afterAll(async () => {
  await runWithTenant(TENANT, () => db.transaction((tx) => tx.delete(plugins).where(eq(plugins.id, PLUGIN)))).catch(() => undefined);
  await app.close();
  await sqlClient.end();
});

afterEach(() => vi.restoreAllMocks());

describe("POST /v1/plugins/:id/enable", () => {
  it("random id -> 404 and nothing published (empty and invalid-field bodies)", async () => {
    const spy = vi.spyOn(queue, "publish");
    for (const payload of [{}, INVALID_FIELDS]) {
      const res = await app.inject({ method: "POST", url: `/v1/plugins/${randomUUID()}/enable`, headers: headers(), payload });
      expect(res.statusCode).toBe(404);
    }
    expect(spy).not.toHaveBeenCalled();
  });
  it("another tenant's plugin -> 404", async () => {
    const res = await app.inject({ method: "POST", url: `/v1/plugins/${PLUGIN}/enable`, headers: headers(OTHER_TENANT), payload: {} });
    expect(res.statusCode).toBe(404);
  });
  it("the real plugin -> 202 and the command is published", async () => {
    const spy = vi.spyOn(queue, "publish").mockResolvedValue("m");
    const res = await app.inject({ method: "POST", url: `/v1/plugins/${PLUGIN}/enable`, headers: headers(), payload: {} });
    expect(res.statusCode).toBe(202);
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

describe("PUT /v1/plugins/:pluginId/store/:key without a value -> 400, not a TypeError 500", () => {
  for (const [name, payload] of [["empty body", {}], ["invalid fields", INVALID_FIELDS]] as const) {
    it(name, async () => {
      const spy = vi.spyOn(queue, "publish");
      const res = await app.inject({ method: "PUT", url: `/v1/plugins/${PLUGIN}/store/k1`, headers: headers(), payload });
      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe("VALIDATION_FAILED");
      expect(spy).not.toHaveBeenCalled();
    });
  }
  it("an explicit JSON null value is still accepted (202)", async () => {
    vi.spyOn(queue, "publish").mockResolvedValue("m");
    const res = await app.inject({ method: "PUT", url: `/v1/plugins/${PLUGIN}/store/k1`, headers: headers(), payload: { value: null } });
    expect(res.statusCode).toBe(202);
  });
});
