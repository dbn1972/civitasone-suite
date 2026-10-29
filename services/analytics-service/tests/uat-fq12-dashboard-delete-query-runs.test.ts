/**
 * Real-DB regression for UAT FQ12 #54: DELETE /v1/analytics/dashboards/:id
 * returned 202 but the dashboard stayed active. analytics.query_runs.dashboard_id
 * referenced dashboards(id) with NO ACTION, so the delete consumer's DELETE
 * violated query_runs_dashboard_id_fkey for any dashboard that had run a query.
 *
 * Migration 0020 re-creates the FK as ON DELETE SET NULL (run history is kept,
 * detached). The migration is applied TWICE here to prove it is idempotent.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { runWithTenant } from "@civitasone/db";
import type { Queue, CommandEnvelope } from "@civitasone/queue";
import { db, sqlClient } from "../src/shared/db.js";
import { registerDashboardsConsumers } from "../src/modules/dashboards/consumer.js";
import { COMMANDS } from "../src/topics.js";

const TENANT = randomUUID();
const ACTOR = randomUUID();
const MIGRATION = readFileSync(join(__dirname, "../migrations/0020_query_runs_dashboard_fk_set_null.sql"), "utf8");

type Handler = (msg: CommandEnvelope) => Promise<void>;
const handlers = new Map<string, Handler[]>();
const broker = {
  subscribe: (topic: string, h: Handler) => { handlers.set(topic, [...(handlers.get(topic) ?? []), h]); },
  publish: async () => randomUUID(),
  start: async () => {}, stop: async () => {},
  healthCheck: async () => ({ healthy: true, driver: "memory" as const }),
} as unknown as Queue;

function q<T = Record<string, unknown>>(query: ReturnType<typeof sql>): Promise<T[]> {
  return runWithTenant(TENANT, () => db.transaction(async (tx) => (await tx.execute(query)) as unknown as T[]));
}

beforeAll(async () => {
  await sqlClient.unsafe(MIGRATION);
  await sqlClient.unsafe(MIGRATION); // idempotent: second run is a no-op
  registerDashboardsConsumers(broker);
});

afterAll(async () => {
  await q(sql`DELETE FROM analytics.query_runs WHERE tenant_id = ${TENANT}`).catch(() => undefined);
  await q(sql`DELETE FROM analytics.dashboards WHERE tenant_id = ${TENANT}`).catch(() => undefined);
  await q(sql`DELETE FROM _outbox.messages WHERE tenant_id = ${TENANT}`).catch(() => undefined);
  await sqlClient.end();
});

describe("UAT FQ12 #54 dashboard delete with query-run history", () => {
  it("the FK is ON DELETE SET NULL after the migration", async () => {
    const r = await sqlClient<{ confdeltype: string }[]>`
      SELECT confdeltype FROM pg_constraint
      WHERE conrelid = 'analytics.query_runs'::regclass AND conname = 'query_runs_dashboard_id_fkey'`;
    expect(r).toHaveLength(1);
    expect(r[0]!.confdeltype).toBe("n");
  });

  it("deletes the dashboard and keeps its query runs detached", async () => {
    const dashboardId = randomUUID();
    const runId = randomUUID();
    await q(sql`INSERT INTO analytics.dashboards (id, tenant_id, name, created_by, updated_by)
                VALUES (${dashboardId}, ${TENANT}, 'FQ12 dash', ${ACTOR}, ${ACTOR})`);
    await q(sql`INSERT INTO analytics.query_runs (id, tenant_id, dashboard_id, query_name, status, created_by, updated_by)
                VALUES (${runId}, ${TENANT}, ${dashboardId}, 'fq12', 'completed', ${ACTOR}, ${ACTOR})`);

    const hs = handlers.get(COMMANDS.deleteDashboard) ?? [];
    expect(hs.length).toBe(1);
    await hs[0]!({
      messageId: randomUUID(), type: COMMANDS.deleteDashboard, tenantId: TENANT, actorId: ACTOR,
      correlationId: randomUUID(), schemaVersion: "1.0", timestamp: new Date().toISOString(),
      payload: { dashboardId },
    } as CommandEnvelope);

    expect(await q(sql`SELECT id FROM analytics.dashboards WHERE id = ${dashboardId}`)).toHaveLength(0);
    const runs = await q<{ dashboard_id: string | null }>(sql`SELECT dashboard_id FROM analytics.query_runs WHERE id = ${runId}`);
    expect(runs).toHaveLength(1);
    expect(runs[0]!.dashboard_id).toBeNull();
  });
});
