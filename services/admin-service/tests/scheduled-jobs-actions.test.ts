/**
 * GAP-ADMIN-SCHEDULED-JOBS-01 / -02 (fp-admin-01): target allow-list, operator
 * reasons on delete / run-now / pause, and conditional (race-safe) transitions.
 * Real Postgres as the non-superuser app role (FORCE RLS), real consumers.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, beforeEach } from "vitest";
import { and, eq } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import { runWithTenant } from "@civitasone/db";
import type { FastifyInstance } from "fastify";
import { db, sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { outboxMessages } from "../src/shared/outbox.js";
import { scheduledJobs, jobExecutionHistory } from "../src/modules/scheduled-jobs/schema.js";
import { checkTarget } from "../src/modules/scheduled-jobs/targets.js";
import { registerAllF3Consumers } from "./helpers/register-all-f3-consumers.js";

const { buildApp } = await import("../src/app.js");

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TA = "5e780000-0000-4000-8000-0000000000a1";
const TB = "5e780000-0000-4000-8000-0000000000b1";
const ACTOR = "5e78acc0-0000-4000-8000-0000000000a1";
const auth = (tenant = TA, roles = ["platform_admin"]) => ({ authorization: `Bearer ${signToken({ sub: ACTOR, tid: tenant, roles, sid: "sess-sja" }, SECRET, 3600)}` });

let app: FastifyInstance;
const until = async <T>(fn: () => Promise<T | undefined | false>, tries = 60): Promise<T> => {
  for (let i = 0; i < tries; i++) { const v = await fn(); if (v) return v; await new Promise((r) => setTimeout(r, 100)); }
  throw new Error("condition not reached");
};
async function jobs(tenant = TA) {
  return runWithTenant(tenant, () => db.transaction((tx) => tx.select().from(scheduledJobs).where(eq(scheduledJobs.tenantId, tenant))));
}
async function history(jobId: string) {
  return runWithTenant(TA, () => db.transaction((tx) => tx.select().from(jobExecutionHistory).where(and(eq(jobExecutionHistory.jobId, jobId), eq(jobExecutionHistory.tenantId, TA)))));
}
async function audits(action: string) {
  const rows = await runWithTenant(TA, () => db.transaction((tx) => tx.select().from(outboxMessages).where(eq(outboxMessages.tenantId, TA))));
  return rows.filter((r) => (r.payload as { action?: string }).action === action);
}
async function wipe() {
  for (const t of [TA, TB]) {
    await runWithTenant(t, () => db.transaction(async (tx) => {
      await tx.delete(jobExecutionHistory).where(eq(jobExecutionHistory.tenantId, t));
      await tx.delete(scheduledJobs).where(eq(scheduledJobs.tenantId, t));
      await tx.delete(outboxMessages).where(eq(outboxMessages.tenantId, t));
    }));
  }
}
async function createJob(name: string, targetService: string, targetCommand: string, tenant = TA) {
  const res = await app.inject({
    method: "POST", url: "/v1/admin/scheduled-jobs", headers: auth(tenant),
    payload: { name, cronExpression: "0 8 * * *", targetService, targetCommand },
  });
  expect(res.statusCode).toBe(202);
  return until(async () => (await jobs(tenant)).find((j) => j.name === name));
}

beforeAll(async () => { registerAllF3Consumers(queue); await queue.start(); app = await buildApp(); await wipe(); });
afterAll(async () => { await wipe(); await app.close(); await queue.stop(); await sqlClient.end(); });
// Sensitive services need an explicit allow-list; the suite configures one for the jobs it creates.
const SENSITIVE_ALLOW = JSON.stringify({ "finance-service": ["finance\\.report\\..+"], "hrms-service": ["hrms\\.report\\..+"] });
beforeEach(() => { process.env.ADMIN_SCHEDULED_JOB_TARGETS = SENSITIVE_ALLOW; });
afterEach(() => { delete process.env.ADMIN_SCHEDULED_JOB_TARGETS; });

describe("target allow-list (SCHEDULED-JOBS-02)", () => {
  it("accepts a command in the target service's own namespace", () => {
    expect(checkTarget("finance-service", "finance.report.generate").ok).toBe(true);
    expect(checkTarget("admin-service", "admin.noop").ok).toBe(true);
    expect(checkTarget("report-service", "report.generate").ok).toBe(true);
  });
  it("refuses an unknown service, a foreign namespace, a malformed or destructive command, and a huge payload", () => {
    expect(checkTarget("payroll-service", "payroll.run.start")).toMatchObject({ ok: false, field: "targetService" });
    expect(checkTarget("report-service", "finance.report.generate")).toMatchObject({ ok: false, field: "targetCommand" });
    expect(checkTarget("report-service", "Report Generate")).toMatchObject({ ok: false, field: "targetCommand" });
    expect(checkTarget("finance-service", "finance.ledger.purge")).toMatchObject({ ok: false, field: "targetCommand" });
    expect(checkTarget("hrms-service", "hrms.employee.delete")).toMatchObject({ ok: false, field: "targetCommand" });
    // case-insensitive substring, not word-boundary
    for (const c of ["report.purgeall", "report.PurgeAll", "report.bulk_WIPE", "report.cache.DropTables"]) {
      expect(checkTarget("report-service", c), c).toMatchObject({ ok: false, field: "targetCommand" });
    }
    expect(checkTarget("report-service", "report.generate", { x: "y".repeat(10_001) })).toMatchObject({ ok: false, field: "payload" });
  });
  it("a sensitive service cannot be scheduled at all without an allow-list, whatever the command", () => {
    delete process.env.ADMIN_SCHEDULED_JOB_TARGETS;
    for (const [svc, cmd] of [["finance-service", "finance.report.generate"], ["hrms-service", "hrms.report.x"], ["audit-service", "audit.export.run"]] as const) {
      expect(checkTarget(svc, cmd), svc).toMatchObject({ ok: false, field: "targetService" });
    }
    expect(checkTarget("report-service", "report.generate").ok).toBe(true);
    process.env.ADMIN_SCHEDULED_JOB_TARGETS = "{not json"; // malformed never widens
    expect(checkTarget("finance-service", "finance.report.generate").ok).toBe(false);
    process.env.ADMIN_SCHEDULED_JOB_TARGETS = JSON.stringify({ "finance-service": [] }); // an empty list is not an allow-list
    expect(checkTarget("finance-service", "finance.report.generate").ok).toBe(false);
  });
  it("honours an operator allow-list override and ignores a malformed one", () => {
    process.env.ADMIN_SCHEDULED_JOB_TARGETS = JSON.stringify({ "finance-service": ["finance\\.report\\..+"] });
    expect(checkTarget("finance-service", "finance.report.monthly").ok).toBe(true);
    expect(checkTarget("finance-service", "finance.payment.release")).toMatchObject({ ok: false, field: "targetCommand" });
    process.env.ADMIN_SCHEDULED_JOB_TARGETS = "{not json";
    expect(checkTarget("report-service", "report.generate").ok).toBe(true);
  });
  it("create and update return 422 with the offending field and store nothing", async () => {
    const bad = await app.inject({ method: "POST", url: "/v1/admin/scheduled-jobs", headers: auth(), payload: { name: "evil", cronExpression: "0 8 * * *", targetService: "finance-service", targetCommand: "hrms.employee.update" } });
    expect(bad.statusCode).toBe(422);
    expect(bad.json().code ?? bad.json().error?.code).toBe("TARGET_NOT_ALLOWED");
    expect((await jobs()).some((j) => j.name === "evil")).toBe(false);
    const job = await createJob("ok-job", "report-service", "report.generate");
    const upd = await app.inject({ method: "PUT", url: `/v1/admin/scheduled-jobs/${job.id}`, headers: auth(), payload: { targetCommand: "finance.ledger.update" } });
    expect(upd.statusCode).toBe(422);
    const unchanged = (await jobs()).find((j) => j.id === job.id)!;
    expect(unchanged.targetCommand).toBe("report.generate");
  });
  it("lists the schedulable targets", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/admin/scheduled-jobs/targets", headers: auth() });
    expect(res.statusCode).toBe(200);
    const services = res.json().data.services as Array<{ service: string; schedulable: boolean }>;
    expect(services.map((s) => s.service)).toContain("finance-service");
    expect(services.find((s) => s.service === "finance-service")!.schedulable).toBe(true);
    expect(services.find((s) => s.service === "audit-service")!.schedulable).toBe(false);
    expect((await app.inject({ method: "GET", url: "/v1/admin/scheduled-jobs/targets", headers: auth(TA, ["tenant_admin"]) })).statusCode).toBe(403);
  });
});

describe("operator reasons + conditional transitions (SCHEDULED-JOBS-01)", () => {
  it("delete needs a reason, records it, and a second delete or a foreign tenant is a 404 no-op", async () => {
    const job = await createJob("to-delete", "report-service", "report.generate");
    const noReason = await app.inject({ method: "DELETE", url: `/v1/admin/scheduled-jobs/${job.id}`, headers: auth() });
    expect(noReason.statusCode).toBe(400);
    expect((await jobs()).some((j) => j.id === job.id)).toBe(true);
    const foreign = await app.inject({ method: "DELETE", url: `/v1/admin/scheduled-jobs/${job.id}`, headers: { ...auth(TB), "content-type": "application/json" }, payload: { reason: "not mine" } });
    expect(foreign.statusCode).toBe(404);
    expect((await jobs()).some((j) => j.id === job.id)).toBe(true);
    const ok = await app.inject({ method: "DELETE", url: `/v1/admin/scheduled-jobs/${job.id}`, headers: auth(), payload: { reason: "obsolete report" } });
    expect(ok.statusCode).toBe(202);
    await until(async () => !(await jobs()).some((j) => j.id === job.id));
    const rows = await audits("delete");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.payload).toMatchObject({ reason: "obsolete report", resourceId: job.id });
    expect((await app.inject({ method: "DELETE", url: `/v1/admin/scheduled-jobs/${job.id}`, headers: auth(), payload: { reason: "again again" } })).statusCode).toBe(404);
  });

  it("run-now on a finance job needs a reason; an admin-service job does not", async () => {
    const fin = await createJob("fin-run", "finance-service", "finance.report.generate");
    expect((await app.inject({ method: "POST", url: `/v1/admin/scheduled-jobs/${fin.id}/run-now`, headers: auth() })).statusCode).toBe(400);
    expect(await history(fin.id)).toHaveLength(0);
    const ok = await app.inject({ method: "POST", url: `/v1/admin/scheduled-jobs/${fin.id}/run-now`, headers: auth(), payload: { reason: "month-end re-run" } });
    expect(ok.statusCode).toBe(202);
    await until(async () => (await history(fin.id)).length === 1);
    expect((await audits("run_now")).some((r) => (r.payload as { reason?: string }).reason === "month-end re-run")).toBe(true);
    const adm = await createJob("adm-run", "admin-service", "admin.noop");
    expect((await app.inject({ method: "POST", url: `/v1/admin/scheduled-jobs/${adm.id}/run-now`, headers: auth() })).statusCode).toBe(202);
    await until(async () => (await history(adm.id)).length === 1);
  });

  it("a double-clicked run-now fires once (conditional start), and a run-now on a deleted job leaves no orphan history", async () => {
    const job = await createJob("dbl", "admin-service", "admin.noop");
    const send = () => app.inject({ method: "POST", url: `/v1/admin/scheduled-jobs/${job.id}/run-now`, headers: auth() });
    const [a, b] = await Promise.all([send(), send()]);
    expect([a.statusCode, b.statusCode]).toEqual([202, 202]);
    await until(async () => (await history(job.id)).length >= 1);
    await new Promise((r) => setTimeout(r, 400));
    expect(await history(job.id)).toHaveLength(1);

    const gone = await createJob("gone", "admin-service", "admin.noop");
    await runWithTenant(TA, () => db.transaction((tx) => tx.delete(scheduledJobs).where(eq(scheduledJobs.id, gone.id))));
    await queue.publish("admin.scheduled_job.run_now", {
      messageId: "5e780000-0000-4000-8000-00000000dead", type: "admin.scheduled_job.run_now", tenantId: TA, actorId: ACTOR,
      correlationId: "c", schemaVersion: "1.0", payload: { jobId: gone.id, tenantId: TA },
    });
    await new Promise((r) => setTimeout(r, 400));
    expect(await history(gone.id)).toHaveLength(0);
  });

  it("pause carries its reason into the audit trail", async () => {
    const job = await createJob("pausable", "report-service", "report.generate");
    const res = await app.inject({ method: "POST", url: `/v1/admin/scheduled-jobs/${job.id}/pause`, headers: auth(), payload: { reason: "freeze for audit" } });
    expect(res.statusCode).toBe(202);
    await until(async () => (await jobs()).find((j) => j.id === job.id)?.enabled === false);
    expect((await audits("pause"))[0]!.payload).toMatchObject({ reason: "freeze for audit" });
    expect((await app.inject({ method: "POST", url: `/v1/admin/scheduled-jobs/${job.id}/pause`, headers: auth(), payload: { reason: "x" } })).statusCode).toBe(400);
  });
});
