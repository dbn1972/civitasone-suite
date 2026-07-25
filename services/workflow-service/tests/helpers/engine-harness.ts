/**
 * Integration-test harness for the workflow ENGINE (consumers run against the
 * real Postgres test DB). A TestQueue captures the handlers the consumers
 * register, and `deliver()` invokes the real (DLQ-wrapped) handler and AWAITS
 * it — so engine advancement is deterministic and errors surface in the test
 * instead of being retried asynchronously by MemoryQueue.
 *
 * Every test uses a freshly generated tenant id and calls cleanup(tenantId) in
 * afterEach so the shared test DB is never polluted.
 */
import { randomUUID } from "node:crypto";
import { sql, type SQL } from "drizzle-orm";
import type { Queue, CommandEnvelope, Handler, PublishInput } from "@civitasone/queue";
import { runWithTenant } from "@civitasone/db";
import { db } from "../../src/shared/db.js";
import * as defRepo from "../../src/modules/definitions/repo.js";
import type { NodeSpec, EdgeSpec } from "../../src/modules/definitions/repo.js";
import { definitions } from "../../src/modules/definitions/schema.js";

/** Captures subscribers; deliver() runs the real handler and awaits it. */
export class TestQueue implements Queue {
  private handlers = new Map<string, Handler[]>();
  /** Commands published BACK onto the queue by the engine (e.g. timer sweeper). */
  readonly published: Array<{ topic: string; msg: CommandEnvelope }> = [];

  async publish<T>(topic: string, input: PublishInput<T>): Promise<string> {
    const messageId = input.messageId ?? randomUUID();
    this.published.push({
      topic,
      msg: { ...input, messageId, timestamp: input.timestamp ?? new Date().toISOString() } as CommandEnvelope,
    });
    return messageId;
  }
  subscribe<T>(topic: string, handler: Handler<T>): void {
    const l = this.handlers.get(topic) ?? [];
    l.push(handler as Handler);
    this.handlers.set(topic, l);
  }
  async start(): Promise<void> {}
  async stop(): Promise<void> { this.handlers.clear(); }
  async healthCheck(): Promise<{ healthy: boolean; driver: "memory" }> { return { healthy: true, driver: "memory" }; }

  /** Run every handler subscribed to `topic` with `payload`, awaiting each. */
  async deliver<T>(topic: string, payload: T, opts: Partial<CommandEnvelope> = {}): Promise<void> {
    const msg: CommandEnvelope<T> = {
      messageId: opts.messageId ?? randomUUID(),
      type: topic,
      tenantId: opts.tenantId ?? "",
      actorId: opts.actorId ?? randomUUID(),
      correlationId: opts.correlationId ?? randomUUID(),
      timestamp: new Date().toISOString(),
      schemaVersion: "1.0",
      payload,
    };
    const handlers = this.handlers.get(topic) ?? [];
    for (const h of handlers) await h(msg as CommandEnvelope);
  }
}

export type SeededDef = { id: string; code: string };

/**
 * RLS (#146): workflow_svc is NOBYPASSRLS and every workflow table is
 * fail-closed (tenant_id = workflow.current_tenant_id()), so raw sqlClient/db
 * reads, seeds, and cleanup deletes MUST set the app.tenant_id GUC. asTenant()
 * runs `fn` with the tenant context active (any db.transaction() inside gets
 * the GUC); sqlAsTenant() is the one-statement convenience for raw SQL.
 * Mirrors telephony-service's domain-test helper from PR #152.
 */
export async function asTenant<T>(tenantId: string, fn: () => Promise<T>): Promise<T> {
  return runWithTenant(tenantId, fn);
}

/** Run one raw SQL statement inside `tenantId`'s RLS scope and return its rows. */
export async function sqlAsTenant<T = Record<string, unknown>>(tenantId: string, query: SQL): Promise<T[]> {
  return runWithTenant(tenantId, async () =>
    (await db.transaction(async (tx) => tx.execute(query))) as unknown as T[],
  );
}

/**
 * Insert an ACTIVE definition with the given nodes+edges for a tenant. Returns
 * the definition id + code. `code` is randomised unless supplied so parallel
 * tests never collide.
 */
export async function seedDefinition(
  tenantId: string,
  nodes: NodeSpec[],
  edges: EdgeSpec[],
  opts: { code?: string; name?: string; actorId?: string; isTemplate?: boolean; status?: string } = {},
): Promise<SeededDef> {
  const code = opts.code ?? `test_${randomUUID().slice(0, 8)}`;
  const actorId = opts.actorId ?? randomUUID();
  const id = randomUUID();
  // Seed inside the tenant's RLS scope: a bare db.insert() carries no GUC and
  // is rejected by the fail-closed policy on workflow.definitions.
  await runWithTenant(tenantId, () =>
    db.transaction(async (tx) => {
      await tx.insert(definitions).values({
        id,
        tenantId,
        code,
        name: opts.name ?? code,
        version: 1,
        status: opts.status ?? "active",
        isTemplate: opts.isTemplate ?? false,
        createdBy: actorId,
        updatedBy: actorId,
      });
      await defRepo.insertGraphTx(tx as unknown as Parameters<typeof defRepo.insertGraphTx>[0], id, nodes, edges);
    }),
  );
  return { id, code };
}

/** Remove every row this test created for the given tenant id(s). */
export async function cleanup(...tenantIds: string[]): Promise<void> {
  for (const t of tenantIds) {
    // transition_history is append-only (DB trigger blocks DELETE/TRUNCATE) by
    // design; test rows are scoped to throwaway random tenant UUIDs so they
    // never pollute a real tenant and are left in place.
    // RLS (#146): each delete runs inside the tenant's GUC scope — a GUC-less
    // DELETE on a fail-closed table silently matches zero rows.
    await sqlAsTenant(t, sql`DELETE FROM _outbox.messages WHERE tenant_id = ${t}`).catch(() => undefined);
    await sqlAsTenant(t, sql`DELETE FROM workflow.tasks WHERE tenant_id = ${t}`);
    await sqlAsTenant(t, sql`DELETE FROM workflow.instances WHERE tenant_id = ${t}`);
    await sqlAsTenant(t, sql`DELETE FROM workflow.definition_edges WHERE definition_id IN (SELECT id FROM workflow.definitions WHERE tenant_id = ${t})`);
    await sqlAsTenant(t, sql`DELETE FROM workflow.definition_nodes WHERE definition_id IN (SELECT id FROM workflow.definitions WHERE tenant_id = ${t})`);
    await sqlAsTenant(t, sql`DELETE FROM workflow.definitions WHERE tenant_id = ${t}`);
    await sqlAsTenant(t, sql`DELETE FROM workflow.role_members WHERE tenant_id = ${t}`).catch(() => undefined);
    await sqlAsTenant(t, sql`DELETE FROM workflow.assignment_cursors WHERE tenant_id = ${t}`).catch(() => undefined);
    await sqlAsTenant(t, sql`DELETE FROM workflow.consumer_attempts WHERE tenant_id = ${t}`).catch(() => undefined);
    await sqlAsTenant(t, sql`DELETE FROM workflow.dead_letters WHERE tenant_id = ${t}`).catch(() => undefined);
  }
}

/** Fetch the current instance row (or null) inside the tenant's RLS scope. */
export async function getInstance(tenantId: string, id: string): Promise<Record<string, unknown> | null> {
  const r = await sqlAsTenant(tenantId, sql`SELECT * FROM workflow.instances WHERE id = ${id} LIMIT 1`);
  return r[0] ?? null;
}

/** All tasks for an instance, oldest first, inside the tenant's RLS scope. */
export async function tasksFor(tenantId: string, instanceId: string): Promise<Array<Record<string, unknown>>> {
  return sqlAsTenant(tenantId, sql`SELECT * FROM workflow.tasks WHERE instance_id = ${instanceId} ORDER BY created_at ASC`);
}

/** History actions for an instance, oldest first, inside the tenant's RLS scope. */
export async function historyActions(tenantId: string, instanceId: string): Promise<string[]> {
  const r = await sqlAsTenant<{ action: string }>(tenantId, sql`SELECT action FROM workflow.transition_history WHERE instance_id = ${instanceId} ORDER BY created_at ASC`);
  return r.map((x) => x.action);
}
