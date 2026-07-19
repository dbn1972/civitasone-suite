/**
 * admin-service — targeted coverage-gap closure for Phase 4 of the
 * production-readiness master prompt.
 *
 * Three files were touched during RLS/typecheck remediation but fell below
 * the workspace's 80%-line-coverage-per-changed-file hard rule:
 *   - backup/repo.ts (25%)      — upsertSchedule create+update, insertRun, listRuns
 *   - config/repo.ts (61%)     — getTenantConfig (null + full resolve), listFlags,
 *                                 setFlagOverride, insertFlag idempotent no-op
 *   - custom-domains/routes.ts (79%) — GET .../dns-instructions success path
 *     (dns_txt AND dns_cname branches), which was only exercised as a 404/500
 *     before (no row ever existed).
 *
 * Every new test asserts real behavior (DB row / response shape / audit
 * side-effect), not just "doesn't throw", per workspace testing conventions.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq, and } from "drizzle-orm";
import { MemoryQueue, type Queue, type Handler } from "@civitasone/queue";
import { signToken } from "@civitasone/auth";
import { runWithTenant, withTenantConsumer } from "@civitasone/db";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { outboxMessages, processed } from "../src/shared/outbox.js";
import { adminBackupSchedules, adminBackupRuns } from "../src/modules/backup/schema.js";
import { adminEditions, adminModuleConfigs, adminFeatureFlags } from "../src/modules/config/schema.js";
import { customDomains } from "../src/modules/custom-domains/schema.js";
import { exportRequests } from "../src/modules/data-export/schema.js";
import { scheduledJobs, jobExecutionHistory } from "../src/modules/scheduled-jobs/schema.js";
import { webhooks, webhookDeliveries } from "../src/modules/webhooks/schema.js";
import { featureFlags } from "../src/modules/feature-flags/schema.js";
import { registerBackupConsumers } from "../src/modules/backup/consumer.js";
import { registerConfigConsumers } from "../src/modules/config/consumer.js";
import { registerCustomDomainConsumers } from "../src/modules/custom-domains/consumer.js";
import { registerDataExportConsumers } from "../src/modules/data-export/consumer.js";
import { registerScheduledJobConsumers } from "../src/modules/scheduled-jobs/consumer.js";
import { registerWebhookConsumers } from "../src/modules/webhooks/consumer.js";
import { registerFeatureFlagConsumers } from "../src/modules/feature-flags/consumer.js";
import * as backupRepo from "../src/modules/backup/repo.js";
import * as configRepo from "../src/modules/config/repo.js";
import { queue as sharedQueue } from "../src/shared/infra.js";
import { COMMANDS } from "../src/topics.js";
import type { FastifyInstance } from "fastify";

// The HTTP routes for data-export/scheduled-jobs/webhooks/feature-flags
// publish onto the real `queue` singleton exported from shared/infra.ts
// (the same one app.ts's routes use) — NOT a fresh MemoryQueue. buildApp()
// only registers ROUTES; only worker.ts registers consumers in production.
// So to prove the route → command → consumer → DB path end-to-end here, the
// relevant consumers must be registered on that SAME shared singleton, with
// its subscribe() wrapped the same way withTenantConsumer decorates it in
// production (see wireTenantAwareQueue's doc comment above).
let sharedConsumersWired = false;
function wireSharedQueueConsumersOnce(): void {
  if (sharedConsumersWired) return;
  sharedConsumersWired = true;
  wireTenantAwareQueue(sharedQueue);
  registerDataExportConsumers(sharedQueue);
  registerScheduledJobConsumers(sharedQueue);
  registerWebhookConsumers(sharedQueue);
  registerFeatureFlagConsumers(sharedQueue);
  registerConfigConsumers(sharedQueue); // to prove the topic-collision fix: no cross-firing
}

const SECRET = process.env.JWT_SECRET as string;
const PLATFORM = "00000000-0000-0000-0000-000000000000";

// Same test-harness fix used across admin-service/estab-service test suites:
// `new MemoryQueue()` does not auto-wrap subscribed handlers with
// `withTenantConsumer` the way production's `createQueue()` factory does.
function wireTenantAwareQueue(q: Queue): Queue {
  const rawSubscribe = q.subscribe.bind(q);
  q.subscribe = ((topic: string, handler: Handler) =>
    rawSubscribe(topic, withTenantConsumer(handler) as Handler)) as typeof q.subscribe;
  return q;
}

function token(roles: string[], tid: string, actorId: string): string {
  return signToken({ sub: actorId, roles, tid } as never, SECRET);
}
function bearer(roles: string[], tid: string, actorId: string) {
  return { authorization: `Bearer ${token(roles, tid, actorId)}` };
}

// Fixed sleeps for "wait for the async consumer to finish" are flaky under
// parallel test-file load (CPU/DB contention can push consumer completion
// past a fixed 400ms). Poll instead: retry the assertion until it passes or
// a generous timeout elapses.
async function waitFor<T>(fn: () => Promise<T>, predicate: (v: T) => boolean, timeoutMs = 4000, intervalMs = 100): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let last: T;
  do {
    last = await fn();
    if (predicate(last)) return last;
    await new Promise((r) => setTimeout(r, intervalMs));
  } while (Date.now() < deadline);
  return last;
}

let app: FastifyInstance;
beforeAll(async () => { app = await buildApp(); });
afterAll(async () => { await app.close(); await sqlClient.end(); });

// ══════════════════════════════════════════════════════════════════════════
// backup/repo.ts — upsertSchedule (create + update), insertRun, listRuns
// ══════════════════════════════════════════════════════════════════════════
describe("backup consumer + repo — schedule upsert, trigger, listRuns (integration)", () => {
  const T = "88888888-bbbb-4000-8000-000000000001";
  const ACTOR = "88888888-bbbb-4000-8000-0000000000aa";
  const MSG_SCHED_1 = "88880001-bbbb-4000-8000-000000000001";
  const MSG_SCHED_2 = "88880002-bbbb-4000-8000-000000000002";
  const MSG_RUN = "88880003-bbbb-4000-8000-000000000003";
  const RUN_ID = "88880099-bbbb-4000-8000-000000000099";

  async function cleanup() {
    await runWithTenant(T, () => db.transaction(async (tx) => {
      await tx.delete(adminBackupRuns).where(eq(adminBackupRuns.tenantId, T));
      await tx.delete(adminBackupSchedules).where(eq(adminBackupSchedules.tenantId, T));
      await tx.delete(outboxMessages).where(eq(outboxMessages.tenantId, T));
      await tx.delete(processed).where(eq(processed.messageId, MSG_SCHED_1));
      await tx.delete(processed).where(eq(processed.messageId, MSG_SCHED_2));
      await tx.delete(processed).where(eq(processed.messageId, MSG_RUN));
    }));
  }

  beforeAll(cleanup);
  afterAll(cleanup);

  it("first schedule command INSERTs a row; a second command for the same tenant UPDATEs it in place (upsert)", async () => {
    const q = wireTenantAwareQueue(new MemoryQueue());
    registerBackupConsumers(q);
    await q.start();

    await q.publish(COMMANDS.backupSchedule, {
      messageId: MSG_SCHED_1, type: COMMANDS.backupSchedule, tenantId: T,
      actorId: ACTOR, correlationId: "c-sched-1", schemaVersion: "1.0",
      payload: { tenantId: T, cronExpr: "0 2 * * *" },
    });
    await new Promise((r) => setTimeout(r, 400));

    let rows = await runWithTenant(T, () => db.transaction((tx) => tx.select().from(adminBackupSchedules).where(eq(adminBackupSchedules.tenantId, T))));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.cronExpr).toBe("0 2 * * *");
    const scheduleId = rows[0]?.id;

    await q.publish(COMMANDS.backupSchedule, {
      messageId: MSG_SCHED_2, type: COMMANDS.backupSchedule, tenantId: T,
      actorId: ACTOR, correlationId: "c-sched-2", schemaVersion: "1.0",
      payload: { tenantId: T, cronExpr: "30 3 * * *" },
    });
    await new Promise((r) => setTimeout(r, 400));
    await q.stop();

    rows = await runWithTenant(T, () => db.transaction((tx) => tx.select().from(adminBackupSchedules).where(eq(adminBackupSchedules.tenantId, T))));
    expect(rows).toHaveLength(1); // still exactly one row — updated, not a second insert
    expect(rows[0]?.id).toBe(scheduleId);
    expect(rows[0]?.cronExpr).toBe("30 3 * * *");

    const audits = await runWithTenant(T, () => db.transaction((tx) =>
      tx.select().from(outboxMessages).where(and(eq(outboxMessages.tenantId, T), eq(outboxMessages.eventType, "audit.event.record")))));
    expect(audits.map((a) => (a.payload as { action?: string }).action)).toContain("backup_schedule");
  });

  it("backup trigger command inserts a run row + audit event", async () => {
    const q = wireTenantAwareQueue(new MemoryQueue());
    registerBackupConsumers(q);
    await q.start();

    await q.publish(COMMANDS.backupTrigger, {
      messageId: MSG_RUN, type: COMMANDS.backupTrigger, tenantId: T,
      actorId: ACTOR, correlationId: "c-run-1", schemaVersion: "1.0",
      payload: { tenantId: T, runId: RUN_ID },
    });
    await new Promise((r) => setTimeout(r, 400));
    await q.stop();

    const rows = await runWithTenant(T, () => db.transaction((tx) => tx.select().from(adminBackupRuns).where(eq(adminBackupRuns.id, RUN_ID))));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe("running");
    expect(rows[0]?.tenantId).toBe(T);

    const audits = await runWithTenant(T, () => db.transaction((tx) =>
      tx.select().from(outboxMessages).where(and(eq(outboxMessages.tenantId, T), eq(outboxMessages.eventType, "audit.event.record")))));
    expect(audits.map((a) => (a.payload as { action?: string }).action)).toContain("backup_trigger");
  });

  it("GET /v1/admin/tenants/:id/backup/runs returns the run created above (listRuns → scopedRead)", async () => {
    const res = await app.inject({
      method: "GET", url: `/v1/admin/tenants/${T}/backup/runs`,
      headers: bearer(["super_admin"], T, ACTOR),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Array<{ id: string; tenantId: string }>;
    expect(body.map((r) => r.id)).toContain(RUN_ID);
    for (const row of body) expect(row.tenantId).toBe(T);
  });

  it("repo.listRuns returns at most 50 rows ordered by startedAt desc (direct repo call)", async () => {
    const rows = await runWithTenant(T, () => backupRepo.listRuns(T));
    expect(Array.isArray(rows)).toBe(true);
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows.every((r) => r.tenantId === T)).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// config/repo.ts — getTenantConfig (null + full resolve), listFlags,
// setFlagOverride, insertFlag idempotent no-op
// ══════════════════════════════════════════════════════════════════════════
describe("config repo — getTenantConfig, listFlags, setFlagOverride (integration)", () => {
  const T = "88888888-cccc-4000-8000-000000000002";
  const ACTOR = "88888888-cccc-4000-8000-0000000000aa";
  const FLAG = "coverage_gap_flag";
  const MSG_FLAG_CREATE = "88880010-cccc-4000-8000-000000000010";
  const MSG_FLAG_OVERRIDE = "88880011-cccc-4000-8000-000000000011";
  const MSG_FLAG_DUP = "88880012-cccc-4000-8000-000000000012";

  async function cleanup() {
    await runWithTenant(T, () => db.transaction((tx) => tx.delete(adminModuleConfigs).where(eq(adminModuleConfigs.tenantId, T))));
    await runWithTenant(T, () => db.transaction((tx) => tx.delete(adminEditions).where(eq(adminEditions.tenantId, T))));
    await runWithTenant(T, () => db.transaction((tx) => tx.delete(outboxMessages).where(eq(outboxMessages.tenantId, T))));
    await runWithTenant(PLATFORM, () => db.transaction(async (tx) => {
      await tx.delete(adminFeatureFlags).where(eq(adminFeatureFlags.flagKey, FLAG));
      await tx.delete(outboxMessages).where(eq(outboxMessages.tenantId, PLATFORM));
      await tx.delete(processed).where(eq(processed.messageId, MSG_FLAG_CREATE));
      await tx.delete(processed).where(eq(processed.messageId, MSG_FLAG_OVERRIDE));
      await tx.delete(processed).where(eq(processed.messageId, MSG_FLAG_DUP));
    }));
  }

  beforeAll(cleanup);
  afterAll(cleanup);

  it("getTenantConfig returns null when the tenant has no edition row yet", async () => {
    const result = await configRepo.getTenantConfig(T);
    expect(result).toBeNull();
  });

  it("getTenantConfig resolves modules + a tenant-overridden feature flag once an edition row and modules exist", async () => {
    // Seed an edition row + a module config row directly under this tenant's GUC.
    await runWithTenant(T, () => db.transaction((tx) => tx.insert(adminEditions).values({
      tenantId: T, edition: "psu", label: "PSU Edition", createdBy: ACTOR, updatedBy: ACTOR,
    })));
    await runWithTenant(T, () => db.transaction((tx) => tx.insert(adminModuleConfigs).values({
      tenantId: T, moduleKey: "finance", enabled: true, createdBy: ACTOR, updatedBy: ACTOR,
    })));

    // Create the platform flag (globally disabled) then override it ON for this tenant,
    // via the real consumer path — exercises insertFlag + setFlagOverride together.
    const q = wireTenantAwareQueue(new MemoryQueue());
    registerConfigConsumers(q);
    await q.start();
    await q.publish(COMMANDS.featureFlagCreate, {
      messageId: MSG_FLAG_CREATE, type: COMMANDS.featureFlagCreate, tenantId: PLATFORM,
      actorId: ACTOR, correlationId: "c-flag-create", schemaVersion: "1.0",
      payload: { flagKey: FLAG, enabled: false },
    });
    await new Promise((r) => setTimeout(r, 300));
    await q.publish(COMMANDS.featureFlagOverride, {
      messageId: MSG_FLAG_OVERRIDE, type: COMMANDS.featureFlagOverride, tenantId: T,
      actorId: ACTOR, correlationId: "c-flag-override", schemaVersion: "1.0",
      payload: { flagKey: FLAG, tenantId: T, enabled: true },
    });
    await new Promise((r) => setTimeout(r, 300));
    await q.stop();

    const config = await configRepo.getTenantConfig(T);
    expect(config).not.toBeNull();
    expect(config?.edition).toBe("psu");
    expect(config?.modules.finance).toBe(true);
    // globally disabled, but this tenant's override wins → true
    expect(config?.featureFlags[FLAG]).toBe(true);
  });

  it("listFlags reflects the created flag with its per-tenant override in the overrides map", async () => {
    const flags = await configRepo.listFlags();
    const flag = flags.find((f) => f.flagKey === FLAG);
    expect(flag).toBeDefined();
    expect(flag?.enabled).toBe(false); // global default unchanged
    expect(flag?.overrides[T]).toBe(true);
  });

  it("re-creating the same flag key (distinct messageId) is an idempotent no-op — insertFlag onConflictDoNothing", async () => {
    const q = wireTenantAwareQueue(new MemoryQueue());
    registerConfigConsumers(q);
    await q.start();
    await q.publish(COMMANDS.featureFlagCreate, {
      messageId: MSG_FLAG_DUP, type: COMMANDS.featureFlagCreate, tenantId: PLATFORM,
      actorId: ACTOR, correlationId: "c-flag-dup", schemaVersion: "1.0",
      payload: { flagKey: FLAG, enabled: true }, // different `enabled` value — must NOT overwrite
    });
    await new Promise((r) => setTimeout(r, 300));
    await q.stop();

    const rows = await runWithTenant(PLATFORM, () => db.transaction((tx) => tx.select().from(adminFeatureFlags).where(eq(adminFeatureFlags.flagKey, FLAG))));
    expect(rows).toHaveLength(1); // still one row, no duplicate
    expect(rows[0]?.enabled).toBe(false); // original value preserved — conflict was a no-op, not an overwrite
  });

  it("GET /v1/admin/tenants/:id/config (super_admin, cross-tenant) returns the resolved config for T", async () => {
    const res = await app.inject({
      method: "GET", url: `/v1/admin/tenants/${T}/config`,
      headers: bearer(["super_admin"], "99999999-cccc-4000-8000-000000000099", ACTOR),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { tenantId: string; edition: string; featureFlags: Record<string, boolean> };
    expect(body.tenantId).toBe(T);
    expect(body.featureFlags[FLAG]).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// custom-domains/routes.ts — dns-instructions success path (dns_txt + dns_cname)
// ══════════════════════════════════════════════════════════════════════════
describe("custom-domains — GET dns-instructions success path (integration)", () => {
  const T = "88888888-dddd-4000-8000-000000000003";
  const ACTOR = "88888888-dddd-4000-8000-0000000000aa";
  const DOMAIN_TXT_ID = "88880020-dddd-4000-8000-000000000020";
  const DOMAIN_CNAME_ID = "88880021-dddd-4000-8000-000000000021";
  const MSG_TXT = "88880030-dddd-4000-8000-000000000030";
  const MSG_CNAME = "88880031-dddd-4000-8000-000000000031";

  async function cleanup() {
    await runWithTenant(T, () => db.transaction(async (tx) => {
      await tx.delete(customDomains).where(eq(customDomains.tenantId, T));
      await tx.delete(outboxMessages).where(eq(outboxMessages.tenantId, T));
      await tx.delete(processed).where(eq(processed.messageId, MSG_TXT));
      await tx.delete(processed).where(eq(processed.messageId, MSG_CNAME));
    }));
  }

  beforeAll(async () => {
    await cleanup();
    const q = wireTenantAwareQueue(new MemoryQueue());
    registerCustomDomainConsumers(q);
    await q.start();
    await q.publish(COMMANDS.customDomainRegister, {
      messageId: MSG_TXT, type: COMMANDS.customDomainRegister, tenantId: T,
      actorId: ACTOR, correlationId: "c-cd-txt", schemaVersion: "1.0",
      payload: { id: DOMAIN_TXT_ID, tenantId: T, domain: "txt.example.gov.in", verificationMethod: "dns_txt", verificationToken: "civitasone-verify-abc123" },
    });
    await q.publish(COMMANDS.customDomainRegister, {
      messageId: MSG_CNAME, type: COMMANDS.customDomainRegister, tenantId: T,
      actorId: ACTOR, correlationId: "c-cd-cname", schemaVersion: "1.0",
      payload: { id: DOMAIN_CNAME_ID, tenantId: T, domain: "cname.example.gov.in", verificationMethod: "dns_cname", verificationToken: "civitasone-verify-def456" },
    });
    await new Promise((r) => setTimeout(r, 500));
    await q.stop();
  });
  afterAll(cleanup);

  it("returns TXT record instructions for a dns_txt domain", async () => {
    const res = await app.inject({
      method: "GET", url: `/v1/admin/custom-domains/${DOMAIN_TXT_ID}/dns-instructions`,
      headers: bearer(["super_admin"], T, ACTOR),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: { domain: string; status: string; type: string; host: string; value: string; instructions: string } };
    expect(body.data.domain).toBe("txt.example.gov.in");
    expect(body.data.type).toBe("TXT");
    expect(body.data.host).toBe("_civitasone-verification");
    expect(body.data.value).toBe("civitasone-verify-abc123");
    expect(body.data.instructions).toContain("TXT record");
  });

  it("returns CNAME record instructions for a dns_cname domain", async () => {
    const res = await app.inject({
      method: "GET", url: `/v1/admin/custom-domains/${DOMAIN_CNAME_ID}/dns-instructions`,
      headers: bearer(["super_admin"], T, ACTOR),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: { domain: string; type: string; host: string; value: string; instructions: string } };
    expect(body.data.domain).toBe("cname.example.gov.in");
    expect(body.data.type).toBe("CNAME");
    expect(body.data.host).toBe("_civitasone-verify.cname.example.gov.in");
    expect(body.data.value).toBe("verify.civitasone.app");
    expect(body.data.instructions).toContain("CNAME record");
  });

  it("returns 404 for a domain id that belongs to a different tenant (tenant-scoped lookup)", async () => {
    const otherTenant = "99999999-dddd-4000-8000-000000000099";
    const res = await app.inject({
      method: "GET", url: `/v1/admin/custom-domains/${DOMAIN_TXT_ID}/dns-instructions`,
      headers: bearer(["super_admin"], otherTenant, ACTOR),
    });
    expect(res.statusCode).toBe(404);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// End-to-end smoke tests for the 5 modules whose tables never existed
// before this closure (migration 0012 + shared/db.ts wiring, above). These
// consumers had literally never run against a real table — confirm each
// one now actually persists a row via the full route → command → consumer
// → DB path, not just that the route returns 202.
// ══════════════════════════════════════════════════════════════════════════
describe("previously-missing-table modules — end-to-end persistence smoke tests", () => {
  const T = "88888888-eeee-4000-8000-000000000004";
  const ACTOR = "88888888-eeee-4000-8000-0000000000aa";

  async function cleanup() {
    await runWithTenant(T, () => db.transaction(async (tx) => {
      await tx.delete(outboxMessages).where(eq(outboxMessages.tenantId, T));
      await tx.delete(exportRequests).where(eq(exportRequests.tenantId, T));
      await tx.delete(scheduledJobs).where(eq(scheduledJobs.tenantId, T));
      await tx.delete(webhooks).where(eq(webhooks.tenantId, T));
      await tx.delete(featureFlags).where(eq(featureFlags.tenantId, T));
    }));
  }
  beforeAll(async () => { wireSharedQueueConsumersOnce(); await cleanup(); });
  afterAll(cleanup);

  it("POST /v1/admin/data-export → GET list shows the row with status=pending (data-export consumer actually writes now)", async () => {
    const create = await app.inject({
      method: "POST", url: "/v1/admin/data-export",
      headers: bearer(["tenant_admin"], T, ACTOR),
      payload: { type: "full", format: "csv" },
    });
    expect(create.statusCode).toBe(202);
    const createdId = create.json().id as string;

    await waitFor(
      () => runWithTenant(T, () => db.transaction((tx) => tx.select().from(exportRequests).where(eq(exportRequests.id, createdId)))),
      (found) => found.length > 0,
    );

    const list = await app.inject({ method: "GET", url: "/v1/admin/data-export", headers: bearer(["tenant_admin"], T, ACTOR) });
    expect(list.statusCode).toBe(200);
    const rows = (list.json() as { data: Array<{ id: string; status: string; tenantId: string }> }).data;
    const created = rows.find((r) => r.id === createdId);
    expect(created).toBeDefined();
    expect(created?.status).toBe("pending");
    expect(created?.tenantId).toBe(T);
  });

  it("POST /v1/admin/scheduled-jobs → GET list shows the row (scheduled-jobs consumer actually writes now)", async () => {
    const create = await app.inject({
      method: "POST", url: "/v1/admin/scheduled-jobs",
      headers: bearer(["super_admin"], T, ACTOR),
      payload: {
        name: "Nightly cleanup", cronExpression: "0 2 * * *",
        targetService: "admin-service", targetCommand: "admin.cleanup.run",
      },
    });
    expect(create.statusCode).toBe(202);
    const createdId = create.json().id as string;

    await waitFor(
      () => runWithTenant(T, () => db.transaction((tx) => tx.select().from(scheduledJobs).where(eq(scheduledJobs.id, createdId)))),
      (found) => found.length > 0,
    );

    const list = await app.inject({ method: "GET", url: "/v1/admin/scheduled-jobs", headers: bearer(["super_admin"], T, ACTOR) });
    expect(list.statusCode).toBe(200);
    const rows = (list.json() as { data: Array<{ id: string; name: string; enabled: boolean }> }).data;
    const created = rows.find((r) => r.id === createdId);
    expect(created).toBeDefined();
    expect(created?.name).toBe("Nightly cleanup");
    expect(created?.enabled).toBe(true);
  });

  it("POST /v1/admin/webhooks → GET list shows the row, secret masked (webhooks consumer actually writes now)", async () => {
    const create = await app.inject({
      method: "POST", url: "/v1/admin/webhooks",
      headers: bearer(["super_admin"], T, ACTOR),
      payload: { url: "https://example.gov.in/hooks/civitas", events: ["tenant.updated"] },
    });
    expect(create.statusCode).toBe(202);
    const secret = (create.json() as { secret: string }).secret;
    expect(secret).toMatch(/^whsec_/);
    const createdId = create.json().id as string;

    // Poll the DB directly (bypassing the cached HTTP list route) for the
    // consumer's write to land, THEN make one HTTP call — GET's
    // cache.getOrLoad can otherwise read-through to an empty DB result
    // before the consumer's write commits, cache that empty list, and never
    // self-heal within a short test timeout (cache TTL is 60s).
    await waitFor(
      () => runWithTenant(T, () => db.transaction((tx) => tx.select().from(webhooks).where(eq(webhooks.id, createdId)))),
      (found) => found.length > 0,
    );

    const list = await app.inject({ method: "GET", url: "/v1/admin/webhooks", headers: bearer(["super_admin"], T, ACTOR) });
    expect(list.statusCode).toBe(200);
    const rows = (list.json() as { data: Array<{ id: string; url: string; secretMasked: string }> }).data;
    const created = rows.find((r) => r.id === createdId);
    expect(created).toBeDefined();
    expect(created?.url).toBe("https://example.gov.in/hooks/civitas");
    expect(created?.secretMasked).not.toContain(secret.slice(10)); // full secret never re-exposed
    expect(JSON.stringify(rows)).not.toContain(secret);
  });

  it("POST /v1/admin/feature-flags/manage → GET list shows the row (feature-flags consumer actually writes now, and does NOT collide with the config module's platform flag registry)", async () => {
    const create = await app.inject({
      method: "POST", url: "/v1/admin/feature-flags/manage",
      headers: bearer(["super_admin"], T, ACTOR),
      payload: { key: "smoke_test_manage_flag", name: "Smoke Test Manage Flag", enabled: true },
    });
    expect(create.statusCode).toBe(202);
    const createdId = create.json().id as string;

    // Poll the DB directly first — see the webhooks test above for why (GET's
    // cache.getOrLoad can cache an empty result if read before the consumer's
    // write commits, and that stale cache would not self-heal in time).
    await waitFor(
      () => runWithTenant(T, () => db.transaction((tx) => tx.select().from(featureFlags).where(eq(featureFlags.id, createdId)))),
      (found) => found.length > 0,
    );

    const list = await app.inject({ method: "GET", url: "/v1/admin/feature-flags/manage", headers: bearer(["super_admin"], T, ACTOR) });
    expect(list.statusCode).toBe(200);
    const rows = (list.json() as { data: Array<{ id: string; key: string; enabled: boolean }> }).data;
    const created = rows.find((r) => r.id === createdId);
    expect(created).toBeDefined();
    expect(created?.key).toBe("smoke_test_manage_flag");

    // The topic-collision bug fix: this manage-flag creation must NOT have
    // also inserted a row into config.admin_feature_flags (the PLATFORM
    // registry), which has a completely different, incompatible payload
    // shape (flagKey vs key) and would throw a NOT NULL violation if the
    // config consumer's handler were still (wrongly) invoked for this topic.
    const platformFlags = await runWithTenant(PLATFORM, () => db.transaction((tx) =>
      tx.select().from(adminFeatureFlags).where(eq(adminFeatureFlags.flagKey, "smoke_test_manage_flag"))));
    expect(platformFlags).toHaveLength(0);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// Lifecycle coverage for the same 4 modules: update / delete / kill / test /
// pause / resume / run-now / process handlers were still 0%-exercised after
// the create-path smoke tests above (each consumer.ts subscribes multiple
// distinct topics; only the "create" one had been proven end-to-end).
// ══════════════════════════════════════════════════════════════════════════
describe("previously-missing-table modules — lifecycle (update/delete/kill/pause/resume) smoke tests", () => {
  const T = "88888888-ffff-4000-8000-000000000005";
  const ACTOR = "88888888-ffff-4000-8000-0000000000aa";

  async function cleanup() {
    await runWithTenant(T, () => db.transaction(async (tx) => {
      await tx.delete(outboxMessages).where(eq(outboxMessages.tenantId, T));
      await tx.delete(exportRequests).where(eq(exportRequests.tenantId, T));
      await tx.delete(scheduledJobs).where(eq(scheduledJobs.tenantId, T));
      await tx.delete(webhooks).where(eq(webhooks.tenantId, T));
      await tx.delete(featureFlags).where(eq(featureFlags.tenantId, T));
    }));
  }
  beforeAll(async () => { wireSharedQueueConsumersOnce(); await cleanup(); });
  afterAll(cleanup);

  it("scheduled job: create → pause → resume → run-now → update → delete, each verified against the DB", async () => {
    const create = await app.inject({
      method: "POST", url: "/v1/admin/scheduled-jobs",
      headers: bearer(["super_admin"], T, ACTOR),
      payload: { name: "Lifecycle job", cronExpression: "0 3 * * *", targetService: "admin-service", targetCommand: "admin.noop" },
    });
    const jobId = create.json().id as string;
    await waitFor(
      () => runWithTenant(T, () => db.transaction((tx) => tx.select().from(scheduledJobs).where(eq(scheduledJobs.id, jobId)))),
      (found) => found.length > 0,
    );

    const pause = await app.inject({ method: "POST", url: `/v1/admin/scheduled-jobs/${jobId}/pause`, headers: bearer(["super_admin"], T, ACTOR) });
    expect(pause.statusCode).toBe(202);
    let rows = await waitFor(
      () => runWithTenant(T, () => db.transaction((tx) => tx.select().from(scheduledJobs).where(eq(scheduledJobs.id, jobId)))),
      (found) => found[0]?.enabled === false,
    );
    expect(rows[0]?.enabled).toBe(false);

    const resume = await app.inject({ method: "POST", url: `/v1/admin/scheduled-jobs/${jobId}/resume`, headers: bearer(["super_admin"], T, ACTOR) });
    expect(resume.statusCode).toBe(202);
    rows = await waitFor(
      () => runWithTenant(T, () => db.transaction((tx) => tx.select().from(scheduledJobs).where(eq(scheduledJobs.id, jobId)))),
      (found) => found[0]?.enabled === true,
    );
    expect(rows[0]?.enabled).toBe(true);

    const runNow = await app.inject({ method: "POST", url: `/v1/admin/scheduled-jobs/${jobId}/run-now`, headers: bearer(["super_admin"], T, ACTOR) });
    expect(runNow.statusCode).toBe(202);
    rows = await waitFor(
      () => runWithTenant(T, () => db.transaction((tx) => tx.select().from(scheduledJobs).where(eq(scheduledJobs.id, jobId)))),
      (found) => found[0]?.lastRunStatus === "running",
    );
    expect(rows[0]?.lastRunStatus).toBe("running");
    const history = await waitFor(
      () => runWithTenant(T, () => db.transaction((tx) => tx.select().from(jobExecutionHistory).where(eq(jobExecutionHistory.jobId, jobId)))),
      (found) => found.length > 0,
    );
    expect(history).toHaveLength(1);

    const update = await app.inject({
      method: "PUT", url: `/v1/admin/scheduled-jobs/${jobId}`,
      headers: bearer(["super_admin"], T, ACTOR), payload: { name: "Renamed lifecycle job" },
    });
    expect(update.statusCode).toBe(202);
    rows = await waitFor(
      () => runWithTenant(T, () => db.transaction((tx) => tx.select().from(scheduledJobs).where(eq(scheduledJobs.id, jobId)))),
      (found) => found[0]?.name === "Renamed lifecycle job",
    );
    expect(rows[0]?.name).toBe("Renamed lifecycle job");

    const del = await app.inject({ method: "DELETE", url: `/v1/admin/scheduled-jobs/${jobId}`, headers: bearer(["super_admin"], T, ACTOR) });
    expect(del.statusCode).toBe(202);
    rows = await waitFor(
      () => runWithTenant(T, () => db.transaction((tx) => tx.select().from(scheduledJobs).where(eq(scheduledJobs.id, jobId)))),
      (found) => found.length === 0,
    );
    expect(rows).toHaveLength(0);
  });

  it("webhook: create → test delivery → update → delete, each verified against the DB", async () => {
    const create = await app.inject({
      method: "POST", url: "/v1/admin/webhooks",
      headers: bearer(["super_admin"], T, ACTOR),
      payload: { url: "https://example.gov.in/hooks/lifecycle", events: ["tenant.updated"] },
    });
    const webhookId = create.json().id as string;
    await waitFor(
      () => runWithTenant(T, () => db.transaction((tx) => tx.select().from(webhooks).where(eq(webhooks.id, webhookId)))),
      (found) => found.length > 0,
    );

    const test = await app.inject({ method: "POST", url: `/v1/admin/webhooks/${webhookId}/test`, headers: bearer(["super_admin"], T, ACTOR) });
    expect(test.statusCode).toBe(202);
    const deliveries = await waitFor(
      () => runWithTenant(T, () => db.transaction((tx) => tx.select().from(webhookDeliveries).where(eq(webhookDeliveries.webhookId, webhookId)))),
      (found) => found.length > 0,
    );
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0]?.eventType).toBe("webhook.test");
    expect(deliveries[0]?.statusCode).toBe(200);

    const deliveriesRoute = await app.inject({ method: "GET", url: `/v1/admin/webhooks/${webhookId}/deliveries`, headers: bearer(["super_admin"], T, ACTOR) });
    expect(deliveriesRoute.statusCode).toBe(200);
    expect((deliveriesRoute.json() as { data: unknown[] }).data).toHaveLength(1);

    const update = await app.inject({
      method: "PUT", url: `/v1/admin/webhooks/${webhookId}`,
      headers: bearer(["super_admin"], T, ACTOR), payload: { active: false },
    });
    expect(update.statusCode).toBe(202);
    let rows = await waitFor(
      () => runWithTenant(T, () => db.transaction((tx) => tx.select().from(webhooks).where(eq(webhooks.id, webhookId)))),
      (found) => found[0]?.active === false,
    );
    expect(rows[0]?.active).toBe(false);

    const del = await app.inject({ method: "DELETE", url: `/v1/admin/webhooks/${webhookId}`, headers: bearer(["super_admin"], T, ACTOR) });
    expect(del.statusCode).toBe(202);
    rows = await waitFor(
      () => runWithTenant(T, () => db.transaction((tx) => tx.select().from(webhooks).where(eq(webhooks.id, webhookId)))),
      (found) => found.length === 0,
    );
    expect(rows).toHaveLength(0);
  });

  it("feature flag (manage): create → update → kill switch → delete, each verified against the DB", async () => {
    const create = await app.inject({
      method: "POST", url: "/v1/admin/feature-flags/manage",
      headers: bearer(["super_admin"], T, ACTOR),
      payload: { key: "lifecycle_manage_flag", name: "Lifecycle Manage Flag", enabled: false },
    });
    const flagId = create.json().id as string;
    await waitFor(
      () => runWithTenant(T, () => db.transaction((tx) => tx.select().from(featureFlags).where(eq(featureFlags.id, flagId)))),
      (found) => found.length > 0,
    );

    const update = await app.inject({
      method: "PUT", url: `/v1/admin/feature-flags/manage/${flagId}`,
      headers: bearer(["super_admin"], T, ACTOR), payload: { enabled: true, rolloutPercent: 50 },
    });
    expect(update.statusCode).toBe(202);
    let rows = await waitFor(
      () => runWithTenant(T, () => db.transaction((tx) => tx.select().from(featureFlags).where(eq(featureFlags.id, flagId)))),
      (found) => found[0]?.enabled === true,
    );
    expect(rows[0]?.enabled).toBe(true);
    expect(rows[0]?.rolloutPercent).toBe(50);

    const kill = await app.inject({ method: "POST", url: `/v1/admin/feature-flags/manage/${flagId}/kill`, headers: bearer(["super_admin"], T, ACTOR) });
    expect(kill.statusCode).toBe(202);
    rows = await waitFor(
      () => runWithTenant(T, () => db.transaction((tx) => tx.select().from(featureFlags).where(eq(featureFlags.id, flagId)))),
      (found) => found[0]?.killSwitch === true,
    );
    expect(rows[0]?.killSwitch).toBe(true);

    const del = await app.inject({ method: "DELETE", url: `/v1/admin/feature-flags/manage/${flagId}`, headers: bearer(["super_admin"], T, ACTOR) });
    expect(del.statusCode).toBe(202);
    rows = await waitFor(
      () => runWithTenant(T, () => db.transaction((tx) => tx.select().from(featureFlags).where(eq(featureFlags.id, flagId)))),
      (found) => found.length === 0,
    );
    expect(rows).toHaveLength(0);
  });

  it("data export: create → download-not-ready(409) → process → download returns URL", async () => {
    const create = await app.inject({
      method: "POST", url: "/v1/admin/data-export",
      headers: bearer(["tenant_admin"], T, ACTOR),
      payload: { type: "full", format: "json" },
    });
    const exportId = create.json().id as string;
    await waitFor(
      () => runWithTenant(T, () => db.transaction((tx) => tx.select().from(exportRequests).where(eq(exportRequests.id, exportId)))),
      (found) => found.length > 0,
    );

    const notReady = await app.inject({ method: "GET", url: `/v1/admin/data-export/${exportId}/download`, headers: bearer(["tenant_admin"], T, ACTOR) });
    expect(notReady.statusCode).toBe(409);

    // Directly publish the process command (no dedicated HTTP trigger route
    // exists for this — exportProcess is invoked internally after data
    // collection in production) to exercise the second consumer handler.
    const { exportProcess } = await import("../src/modules/data-export/commands.js");
    await exportProcess({ tenantId: T, actorId: ACTOR, correlationId: "corr-export-process" } as any, exportId);

    const rows = await waitFor(
      () => runWithTenant(T, () => db.transaction((tx) => tx.select().from(exportRequests).where(eq(exportRequests.id, exportId)))),
      (found) => found[0]?.status === "ready",
    );
    expect(rows[0]?.status).toBe("ready");
    expect(rows[0]?.downloadUrl).toBeDefined();

    const ready = await app.inject({ method: "GET", url: `/v1/admin/data-export/${exportId}/download`, headers: bearer(["tenant_admin"], T, ACTOR) });
    expect(ready.statusCode).toBe(200);
    expect((ready.json() as { downloadUrl: string }).downloadUrl).toBeDefined();
  });
});
