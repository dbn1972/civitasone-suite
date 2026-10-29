/**
 * UAT W5-B (admin-service): FQ12 #29 / #38 / version bumps, W6 P1 / P9b.
 * Real Postgres as the non-superuser app role (FORCE RLS), real consumers.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import { runWithTenant } from "@civitasone/db";
import type { FastifyInstance } from "fastify";
import { vi } from "vitest";
import { db, sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { outboxMessages } from "../src/shared/outbox.js";
import { adminApiKeys } from "../src/modules/api-keys/schema.js";
import * as apiKeysRepo from "../src/modules/api-keys/repo.js";
import { adminModuleConfigs } from "../src/modules/config/schema.js";
import * as configRepo from "../src/modules/config/repo.js";
import { featureFlags } from "../src/modules/feature-flags/schema.js";
import { scheduledJobs, jobExecutionHistory } from "../src/modules/scheduled-jobs/schema.js";
import { mapBounded, rolePermissionConcurrency } from "../src/modules/gap/routes.js";
import { registerAllF3Consumers } from "./helpers/register-all-f3-consumers.js";

const { buildApp } = await import("../src/app.js");

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const T = "5eb50000-0000-4000-8000-0000000000a1";
const ACTOR = "5eb5acc0-0000-4000-8000-0000000000a1";
const RANDOM_ID = "5eb5dead-0000-4000-8000-00000000beef";
const auth = (roles = ["super_admin", "platform_admin", "tenant_admin"]) =>
  ({ authorization: `Bearer ${signToken({ sub: ACTOR, tid: T, roles, sid: "sess-w5b" }, SECRET, 3600)}` });

let app: FastifyInstance;
const until = async <V>(fn: () => Promise<V | undefined | false>, tries = 80): Promise<V> => {
  for (let i = 0; i < tries; i++) { const v = await fn(); if (v) return v; await new Promise((r) => setTimeout(r, 100)); }
  throw new Error("condition not reached");
};
const asT = <V>(fn: (tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) => Promise<V>) =>
  runWithTenant(T, () => db.transaction(fn));

async function wipe() {
  await asT(async (tx) => {
    await tx.delete(jobExecutionHistory).where(eq(jobExecutionHistory.tenantId, T));
    await tx.delete(scheduledJobs).where(eq(scheduledJobs.tenantId, T));
    await tx.delete(featureFlags).where(eq(featureFlags.tenantId, T));
    await tx.delete(adminApiKeys).where(eq(adminApiKeys.tenantId, T));
    await tx.delete(adminModuleConfigs).where(eq(adminModuleConfigs.tenantId, T));
    await tx.delete(outboxMessages).where(eq(outboxMessages.tenantId, T));
  });
}

beforeAll(async () => { registerAllF3Consumers(queue); await queue.start(); app = await buildApp(); await wipe(); });
afterAll(async () => { await wipe(); await app.close(); await queue.stop(); await sqlClient.end(); });
afterEach(() => { vi.unstubAllGlobals(); delete process.env.ADMIN_SCHEDULED_JOB_TARGETS; });

// ── FQ12 #29: PATCH roles/:id/permissions — bounded concurrency ──────────────
function jsonResponse(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body) };
}
describe("PATCH /v1/admin/roles/:id/permissions (FQ12 #29: was serial -> 504)", () => {
  const ROLE = "5eb50000-0000-4000-8000-00000000a0e1";
  const KEYS = Array.from({ length: 24 }, (_, i) => `w5b.mod${i}.read`);
  const perms = KEYS.map((key, i) => ({ id: `5eb50000-0000-4000-8000-${String(i).padStart(12, "0")}`, key }));

  it("applies grants with bounded parallelism (not one-by-one) and reports every one", async () => {
    let inFlight = 0; let maxInFlight = 0; let writes = 0;
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: { method?: string }) => {
      if (url.endsWith(`/identity/rbac/roles/${ROLE}`)) return jsonResponse(200, { id: ROLE, permissions: [] });
      if (url.includes("/identity/rbac/permissions?")) return jsonResponse(200, perms);
      if (init?.method === "POST") {
        inFlight++; writes++; maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((r) => setTimeout(r, 40));
        inFlight--;
        return jsonResponse(202, { status: "accepted" });
      }
      throw new Error(`unexpected ${url}`);
    }));
    const started = Date.now();
    const res = await app.inject({ method: "PATCH", url: `/v1/admin/roles/${ROLE}/permissions`, headers: auth(), payload: { permissionKeys: KEYS } });
    const elapsed = Date.now() - started;
    expect(res.statusCode).toBe(202);
    expect(res.json().granted).toEqual(KEYS); // request order preserved
    expect(res.json().failed).toEqual([]);
    expect(writes).toBe(24);
    expect(maxInFlight).toBeGreaterThan(1);
    expect(maxInFlight).toBeLessThanOrEqual(rolePermissionConcurrency());
    expect(elapsed).toBeLessThan(24 * 40); // the serial loop needed >= 960ms of upstream time
  });

  it("a transport failure on one change is reported as that change failing (207), not a 502 that hides the rest", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: { method?: string; body?: string }) => {
      if (url.endsWith(`/identity/rbac/roles/${ROLE}`)) return jsonResponse(200, { id: ROLE, permissions: [] });
      if (url.includes("/identity/rbac/permissions?")) return jsonResponse(200, perms);
      if (init?.method === "POST" && init.body?.includes(perms[1]!.id)) throw new TypeError("fetch failed");
      return jsonResponse(202, { status: "accepted" });
    }));
    const res = await app.inject({ method: "PATCH", url: `/v1/admin/roles/${ROLE}/permissions`, headers: auth(), payload: { permissionKeys: KEYS.slice(0, 3) } });
    expect(res.statusCode).toBe(207);
    expect(res.json().granted).toEqual([KEYS[0], KEYS[2]]);
    expect(res.json().failed).toEqual([expect.objectContaining({ key: KEYS[1], action: "grant", status: 502, code: "UPSTREAM_UNAVAILABLE" })]);
  });

  it("a system-role refusal still answers 403 for the whole request and stops scheduling further changes", async () => {
    let writes = 0;
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: { method?: string }) => {
      if (url.endsWith(`/identity/rbac/roles/${ROLE}`)) return jsonResponse(200, { id: ROLE, permissions: [] });
      if (url.includes("/identity/rbac/permissions?")) return jsonResponse(200, perms);
      if (init?.method === "POST") { writes++; return jsonResponse(403, { code: "SYSTEM_ROLE_READONLY", message: "system role" }); }
      throw new Error(`unexpected ${url}`);
    }));
    const res = await app.inject({ method: "PATCH", url: `/v1/admin/roles/${ROLE}/permissions`, headers: auth(), payload: { permissionKeys: KEYS } });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe("SYSTEM_ROLE_READONLY");
    expect(writes).toBeLessThanOrEqual(rolePermissionConcurrency()); // only the first wave, never all 24
  });

  it("mapBounded / rolePermissionConcurrency: bounded, ordered, configurable", async () => {
    expect(rolePermissionConcurrency(undefined)).toBe(8);
    expect(rolePermissionConcurrency("3")).toBe(3);
    expect(rolePermissionConcurrency("500")).toBe(32);
    expect(rolePermissionConcurrency("nope")).toBe(8);
    expect(await mapBounded([3, 1, 2], 2, async (n) => n * 10)).toEqual([30, 10, 20]);
    expect(await mapBounded([], 4, async (n: number) => n)).toEqual([]);
  });
});

// ── W6 P1: a mutating command on an unknown id is a 404, not a queued 202 ───
describe("W6 P1: unknown :id -> 404 before anything is published", () => {
  for (const [method, url, payload] of [
    ["POST", `/v1/admin/scheduled-jobs/${RANDOM_ID}/pause`, { reason: "pause it now" }],
    ["POST", `/v1/admin/scheduled-jobs/${RANDOM_ID}/resume`, { reason: "resume it now" }],
    ["PATCH", `/v1/admin/support/break-glass/${RANDOM_ID}/close`, undefined],
    ["PATCH", `/v1/admin/tenants/${RANDOM_ID}/reactivate`, undefined],
    ["POST", `/v1/admin/tenants/${RANDOM_ID}/backup/run`, undefined],
  ] as const) {
    it(`${method} ${url.replace(RANDOM_ID, ":id")}`, async () => {
      const publish = vi.spyOn(queue, "publish");
      const res = await app.inject({ method, url, headers: auth(), ...(payload ? { payload } : {}) });
      expect(res.statusCode).toBe(404);
      expect(res.json().code ?? res.json().error?.code).toBe("NOT_FOUND");
      expect(publish).not.toHaveBeenCalled();
      publish.mockRestore();
    });
  }
});

// ── W6 P9b: list GETs answer 200 without ?limit ─────────────────────────────
describe("W6 P9b: list GETs default their limit", () => {
  for (const url of [
    "/v1/admin/config-artefacts", "/v1/admin/config-artefacts/promotions", "/v1/admin/config-artefacts/environments",
    "/v1/admin/mobile-telemetry", "/v1/admin/mobile-telemetry/aggregate",
    "/v1/admin/document-types", "/v1/admin/document-requirements", "/v1/admin/documents",
    "/v1/admin/department-templates", "/v1/admin/sandboxes", "/v1/admin/sandbox-refreshes",
  ]) {
    it(`GET ${url} -> 200`, async () => {
      const res = await app.inject({ method: "GET", url, headers: auth() });
      expect(res.statusCode, res.body).toBe(200);
    });
  }
  it("still caps limit at 200", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/admin/sandboxes?limit=201", headers: auth() });
    expect(res.statusCode).toBe(400);
  });
});

// ── FQ12 version bumps ───────────────────────────────────────────────────────
describe("FQ12: version column is bumped on update", () => {
  it("api-keys rotateKey / revokeKeyTx (#1 #2)", async () => {
    const id = "5eb50000-0000-4000-8000-0000000a01e1";
    await asT((tx) => apiKeysRepo.insertKey(tx, { id, tenantId: T, keyName: "k", keyPrefix: "p1", keyHash: "h1", createdBy: ACTOR, updatedBy: ACTOR }));
    await asT((tx) => apiKeysRepo.rotateKey(tx, id, T, "p2", "h2", ACTOR));
    expect((await asT((tx) => tx.select().from(adminApiKeys).where(eq(adminApiKeys.id, id))))[0]!.version).toBe(2);
    await asT((tx) => apiKeysRepo.revokeKeyTx(tx, id, T, ACTOR));
    expect((await asT((tx) => tx.select().from(adminApiKeys).where(eq(adminApiKeys.id, id))))[0]!.version).toBe(3);
  });

  it("config upsertModule (#30)", async () => {
    const read = async () => (await asT((tx) => tx.select().from(adminModuleConfigs)
      .where(and(eq(adminModuleConfigs.tenantId, T), eq(adminModuleConfigs.moduleKey, "w5b_mod")))))[0]!;
    await asT((tx) => configRepo.upsertModule(tx, T, "w5b_mod", true, ACTOR));
    expect((await read()).version).toBe(1);
    await asT((tx) => configRepo.upsertModule(tx, T, "w5b_mod", false, ACTOR));
    expect((await read()).version).toBe(2);
  });

  it("feature-flags consumer update / kill (#17 #18)", async () => {
    const flagId = "5eb50000-0000-4000-8000-0000000f1a91";
    await asT((tx) => tx.insert(featureFlags).values({ id: flagId, tenantId: T, key: "w5b_flag", name: "W5B", createdBy: ACTOR, updatedBy: ACTOR }));
    const env = (type: string, messageId: string, payload: Record<string, unknown>) => ({
      messageId, type, tenantId: T, actorId: ACTOR, correlationId: "w5b-ff", schemaVersion: "1.0", payload,
    });
    const version = async () => (await asT((tx) => tx.select().from(featureFlags).where(eq(featureFlags.id, flagId))))[0]!.version;
    await queue.publish("admin.feature_flag.update", env("admin.feature_flag.update", randomUUID(), { flagId, tenantId: T, name: "W5B renamed" }));
    await until(async () => (await version()) === 2);
    await queue.publish("admin.feature_flag.kill", env("admin.feature_flag.kill", randomUUID(), { flagId, tenantId: T }));
    await until(async () => (await version()) === 3);
  });

  it("scheduled-jobs consumer update / pause (#37)", async () => {
    const created = await app.inject({ method: "POST", url: "/v1/admin/scheduled-jobs", headers: auth(),
      payload: { name: "w5b-ver", cronExpression: "0 8 * * *", targetService: "report-service", targetCommand: "report.generate" } });
    expect(created.statusCode).toBe(202);
    const job = await until(async () => (await asT((tx) => tx.select().from(scheduledJobs).where(eq(scheduledJobs.name, "w5b-ver"))))[0]);
    expect(job.version).toBe(1);
    const ver = async () => (await asT((tx) => tx.select().from(scheduledJobs).where(eq(scheduledJobs.id, job.id))))[0]!.version;
    expect((await app.inject({ method: "PUT", url: `/v1/admin/scheduled-jobs/${job.id}`, headers: auth(), payload: { description: "edited" } })).statusCode).toBe(202);
    await until(async () => (await ver()) === 2);
    expect((await app.inject({ method: "POST", url: `/v1/admin/scheduled-jobs/${job.id}/pause`, headers: auth(), payload: { reason: "freeze it" } })).statusCode).toBe(202);
    await until(async () => (await ver()) === 3);
  });
});

// ── FQ12 #38: run-now actually dispatches the job ────────────────────────────
describe("FQ12 #38: scheduled job run-now dispatches the target command", () => {
  async function createJob(name: string, targetService: string, targetCommand: string, payload?: Record<string, unknown>) {
    const res = await app.inject({ method: "POST", url: "/v1/admin/scheduled-jobs", headers: auth(),
      payload: { name, cronExpression: "0 8 * * *", targetService, targetCommand, ...(payload ? { payload } : {}) } });
    expect(res.statusCode).toBe(202);
    return until(async () => (await asT((tx) => tx.select().from(scheduledJobs).where(eq(scheduledJobs.name, name))))[0]);
  }
  const dispatched = (topic: string) => asT((tx) => tx.select().from(outboxMessages)
    .where(and(eq(outboxMessages.tenantId, T), eq(outboxMessages.topic, topic))));
  const history = (jobId: string) => asT((tx) => tx.select().from(jobExecutionHistory).where(eq(jobExecutionHistory.jobId, jobId)));

  it("publishes targetCommand with the job payload via the outbox, in the same tx as the history row", async () => {
    const job = await createJob("w5b-dispatch", "report-service", "report.w5b.generate", { month: "2026-10" });
    expect((await app.inject({ method: "POST", url: `/v1/admin/scheduled-jobs/${job.id}/run-now`, headers: auth() })).statusCode).toBe(202);
    const [run] = await until(async () => { const h = await history(job.id); return h.length === 1 ? h : undefined; });
    expect(run!.status).toBe("running");
    const rows = await until(async () => { const r = await dispatched("report.w5b.generate"); return r.length === 1 ? r : undefined; });
    expect(rows[0]!.payload).toMatchObject({ month: "2026-10", scheduledJobId: job.id, executionId: run!.id, trigger: "run_now" });
  });

  it("re-checks the target policy at fire time: a target no longer allowed is a failed run and nothing is dispatched", async () => {
    process.env.ADMIN_SCHEDULED_JOB_TARGETS = JSON.stringify({ "finance-service": ["finance\\.report\\..+"] });
    const job = await createJob("w5b-refused", "finance-service", "finance.report.w5b");
    delete process.env.ADMIN_SCHEDULED_JOB_TARGETS; // allow-list withdrawn after the job was saved
    expect((await app.inject({ method: "POST", url: `/v1/admin/scheduled-jobs/${job.id}/run-now`, headers: auth(), payload: { reason: "month-end re-run" } })).statusCode).toBe(202);
    const [run] = await until(async () => { const h = await history(job.id); return h.length === 1 ? h : undefined; });
    expect(run!.status).toBe("failed");
    expect(run!.errorMessage).toMatch(/target refused by policy/);
    await new Promise((r) => setTimeout(r, 300));
    expect(await dispatched("finance.report.w5b")).toHaveLength(0);
    const after = (await asT((tx) => tx.select().from(scheduledJobs).where(eq(scheduledJobs.id, job.id))))[0]!;
    expect(after.lastRunStatus).toBe("failed");
  });
});
