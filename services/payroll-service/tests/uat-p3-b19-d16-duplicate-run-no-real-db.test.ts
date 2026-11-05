/**
 * UAT P3 b19 D-16: a payroll run number already used by the tenant must be a
 * clean 409 DUPLICATE_RUN_NO ("run number X is already used"), never a 500
 * from the payroll_runs_tenant_id_run_no_key unique key -- synchronously on the
 * route (sequential and racing), and terminally (acked + audited, no retry, no
 * DLQ) in the run-create consumer. Real Postgres.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, and, sql } from "drizzle-orm";
import type { MemoryQueue } from "@civitasone/queue";
import { runWithTenant } from "@civitasone/db";
import { signToken } from "@civitasone/auth";
import type { RequestContext } from "@civitasone/types";
import type { FastifyInstance } from "fastify";
import { db, sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { payrollRuns, payrollStructures } from "../src/modules/payroll/schema.js";
import { buildApp } from "../src/app.js";
import * as commands from "../src/modules/payroll/commands.js";
import { registerPayrollConsumers } from "../src/modules/payroll/consumer.js";
import { HttpError } from "../src/shared/context.js";
import { COMMANDS } from "../src/topics.js";

const memQueue = queue as unknown as MemoryQueue;
const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = randomUUID();
const OFFICER = randomUUID();
const STRUCT = randomUUID();
const auth = { authorization: `Bearer ${signToken({ sub: OFFICER, tid: TENANT, roles: ["payroll_admin"], sid: "d16" }, SECRET)}` };
const ctx = (): RequestContext => ({ tenantId: TENANT, actorId: OFFICER, actorType: "user", roles: ["payroll_admin"], correlationId: randomUUID() });
const runsWithNo = (runNo: string) => runWithTenant(TENANT, () => db.transaction((tx) => tx.select().from(payrollRuns)
  .where(and(eq(payrollRuns.tenantId, TENANT), eq(payrollRuns.runNo, runNo)))));

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => { resolve = r; });
  return { promise, resolve };
}

let app: FastifyInstance;
beforeAll(async () => {
  registerPayrollConsumers(queue); await queue.start(); app = await buildApp();
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.insert(payrollStructures).values({
      id: STRUCT, tenantId: TENANT, name: "D-16 Structure", isDefault: true, status: "active", createdBy: OFFICER, updatedBy: OFFICER,
    });
    // Bundle 17-19 merge: createRun now refuses an FY with no new-regime slabs (b18 D2, 422 TAX_CONFIG_MISSING)
    // before it looks at the run number, so the FYs of the months below get slabs for this tenant.
    // Both regimes, so the pre-check never has to ask HRMS (unreachable here) who opted for the old one.
    for (const fy of [2031, 2032]) for (const regime of ["new", "old"]) {
      await tx.execute(sql`INSERT INTO payroll.tax_slab_config (tenant_id, fy_start_year, regime, slabs, std_deduction, rebate_income_cap, rebate_max, surcharge_bands, created_by)
        VALUES (${TENANT}::uuid, ${fy}, ${regime}, ${JSON.stringify([{ from: 0, to: null, rate: 0 }])}::jsonb, 75000, 1200000, 60000, ${"[]"}::jsonb, ${OFFICER}::uuid)`);
    }
  }));
});
afterAll(async () => {
  await queue.stop();
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.delete(payrollRuns).where(eq(payrollRuns.tenantId, TENANT));
    await tx.execute(sql`DELETE FROM payroll.tax_slab_config WHERE tenant_id = ${TENANT}::uuid`);
    await tx.delete(payrollStructures).where(eq(payrollStructures.id, STRUCT));
  }));
  await app.close(); await sqlClient.end();
});

async function seedRun(runNo: string, month: string): Promise<string> {
  const id = randomUUID();
  await runWithTenant(TENANT, () => db.transaction((tx) => tx.insert(payrollRuns).values({
    id, tenantId: TENANT, runNo, month, structureId: STRUCT, runType: "regular", status: "processing", createdBy: OFFICER, updatedBy: OFFICER,
  })));
  return id;
}

describe("D-16: POST /v1/payroll/runs with a run number already used by the tenant", () => {
  it("regular run (a different month, so no period clash): 409 DUPLICATE_RUN_NO, not 500", async () => {
    await seedRun("D16-REG-1", "2032-01");
    const res = await app.inject({ method: "POST", url: "/v1/payroll/runs", headers: auth,
      payload: { runNo: "D16-REG-1", month: "2032-02", structureId: STRUCT, runType: "regular" } });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ code: "DUPLICATE_RUN_NO", message: "run number D16-REG-1 is already used" });
    expect(await runsWithNo("D16-REG-1")).toHaveLength(1);
  });

  it("off-cycle (supplementary) run: the same synchronous 409 before anything is published", async () => {
    await seedRun("D16-SUP-1", "2032-03");
    const res = await app.inject({ method: "POST", url: "/v1/payroll/runs", headers: auth,
      payload: { runNo: "D16-SUP-1", month: "2032-03", structureId: STRUCT, runType: "supplementary" } });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ code: "DUPLICATE_RUN_NO", message: "run number D16-SUP-1 is already used" });
    await memQueue.drain();
    expect(await runsWithNo("D16-SUP-1")).toHaveLength(1);
  });

  it("racing duplicate that passes the pre-check (the other row is not committed yet): the unique violation is a 409, not a 500", async () => {
    const parked = deferred(); const release = deferred();
    // Holds an UNCOMMITTED row with the run number for another month (another
    // advisory-lock key), so createRun pre-check cannot see it and its INSERT
    // blocks on the unique index until this commits, then fails with 23505.
    const winner = runWithTenant(TENANT, () => db.transaction(async (tx) => {
      await tx.insert(payrollRuns).values({
        id: randomUUID(), tenantId: TENANT, runNo: "D16-RACE-1", month: "2032-04", structureId: STRUCT,
        runType: "regular", status: "processing", createdBy: OFFICER, updatedBy: OFFICER,
      });
      parked.resolve();
      await release.promise;
    }));
    await parked.promise;
    const loser = runWithTenant(TENANT, () => commands.createRun(ctx(), { runNo: "D16-RACE-1", month: "2032-05", structureId: STRUCT, runType: "regular" }))
      .then(() => null, (e: unknown) => e);
    await new Promise((r) => setTimeout(r, 300));
    release.resolve();
    await winner;
    const caught = await loser;
    expect(caught).toBeInstanceOf(HttpError);
    expect((caught as HttpError).status).toBe(409);
    expect((caught as HttpError).code).toBe("DUPLICATE_RUN_NO");
    expect((caught as HttpError).message).toBe("run number D16-RACE-1 is already used");
    expect(await runsWithNo("D16-RACE-1")).toHaveLength(1);
  });
});

describe("D-16: the run-create consumer treats a run-number unique violation as terminal", () => {
  it("acks the message (no retry, no DLQ), writes no run row and records a failure audit", async () => {
    await seedRun("D16-CONS-1", "2032-06");
    const id = randomUUID();
    const correlationId = randomUUID();
    const dlqBefore = memQueue.dlq.length;
    await queue.publish(COMMANDS.runCreate, {
      messageId: id, type: COMMANDS.runCreate, tenantId: TENANT, actorId: OFFICER, correlationId, schemaVersion: "1.0",
      payload: { id, tenantId: TENANT, runNo: "D16-CONS-1", month: "2032-06", structureId: STRUCT, runType: "supplementary", status: "draft" },
    });
    await memQueue.drain();
    expect(memQueue.dlq.slice(dlqBefore).filter((d) => d.msg.messageId === id)).toEqual([]);
    const rows = await runWithTenant(TENANT, () => db.transaction((tx) => tx.select().from(payrollRuns).where(eq(payrollRuns.id, id))));
    expect(rows).toEqual([]);
    expect(await runsWithNo("D16-CONS-1")).toHaveLength(1);
    const ev = await runWithTenant(TENANT, () => db.transaction(async (tx) => (await tx.execute(sql`
      SELECT payload FROM _outbox.messages WHERE topic = ${"audit.event.record"}
         AND payload->>${"resourceId"} = ${id} AND payload->>${"outcome"} = ${"failure"}`)) as unknown as Array<{ payload: Record<string, unknown> }>));
    expect(ev).toHaveLength(1);
    expect(ev[0]!.payload).toMatchObject({
      service: "payroll", action: "create", resourceType: "payroll_run", outcome: "failure",
      code: "DUPLICATE_RUN_NO", runNo: "D16-CONS-1", message: "run number D16-CONS-1 is already used",
    });
    // Redelivery of the same message is a no-op (still processed once, one audit row).
    await queue.publish(COMMANDS.runCreate, {
      messageId: id, type: COMMANDS.runCreate, tenantId: TENANT, actorId: OFFICER, correlationId, schemaVersion: "1.0",
      payload: { id, tenantId: TENANT, runNo: "D16-CONS-1", month: "2032-06", structureId: STRUCT, runType: "supplementary", status: "draft" },
    });
    await memQueue.drain();
    expect(memQueue.dlq.slice(dlqBefore).filter((d) => d.msg.messageId === id)).toEqual([]);
  });
});
