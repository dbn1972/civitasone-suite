/**
 * External Task repo — fetch-and-lock, complete, fail, extend operations.
 * Uses the existing workflow.tasks table with node_type = 'external_task'.
 * Lock is tracked via assignee_id (worker ID stored as text in UUID field placeholder)
 * and fire_at (repurposed as lock_expires_at for external tasks).
 */
import { sql } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { HttpError } from "../../shared/context.js";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import { randomUUID, createHash } from "node:crypto";

/**
 * Convert a free-form workerId to a deterministic UUID suitable for the
 * assignee_id uuid column. If the workerId is already a valid uuid, return
 * it as-is; otherwise derive a v5-style UUID from its SHA-256 hash.
 */
function toWorkerUuid(workerId: string): string {
  const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (uuidRe.test(workerId)) return workerId;
  const hash = createHash("sha256").update(workerId).digest("hex");
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

export interface ExternalTaskView {
  id: string;
  instanceId: string;
  name: string;
  nodeKey: string | null;
  refType: string | null;
  refId: string | null;
  lockedUntil: string;
}

/**
 * Atomically fetch and lock external tasks matching the requested topics.
 * "Topics" map to node_key values on tasks with status='pending' and no current lock.
 */
export async function fetchAndLock(
  tenantId: string,
  workerId: string,
  topics: string[],
  maxTasks: number,
  lockDurationMs: number,
): Promise<ExternalTaskView[]> {
  const lockExpiresIso = new Date(Date.now() + lockDurationMs).toISOString();

  // Atomic: select + update in one statement (skip locked to avoid contention)
  // worker_id stored in assignee_id as text (cast to uuid only if it's a valid
  // uuid; otherwise we store the workerId hash as a deterministic uuid).
  const workerUuid = toWorkerUuid(workerId);
  // Format topics as a Postgres array literal for ANY() comparison
  const topicsLiteral = `{${topics.map((t) => `"${t.replace(/"/g, '\\"')}"`).join(",")}}`;
  const rows = (await db.execute(sql`
    WITH locked AS (
      SELECT id FROM workflow.tasks
      WHERE tenant_id = ${tenantId}
        AND status = 'pending'
        AND node_key = ANY(${topicsLiteral}::text[])
        AND (assignee_id IS NULL OR fire_at < NOW())
      ORDER BY created_at ASC
      LIMIT ${maxTasks}
      FOR UPDATE SKIP LOCKED
    )
    UPDATE workflow.tasks t
    SET assignee_id = ${workerUuid}::uuid,
        fire_at = ${lockExpiresIso}::timestamptz,
        updated_at = NOW()
    FROM locked
    WHERE t.id = locked.id
    RETURNING t.id, t.instance_id, t.name, t.node_key, t.ref_type, t.ref_id, t.fire_at
  `)) as unknown as Array<{
    id: string; instance_id: string; name: string;
    node_key: string | null; ref_type: string | null; ref_id: string | null;
    fire_at: Date;
  }>;

  return rows.map((r) => ({
    id: r.id,
    instanceId: r.instance_id,
    name: r.name,
    nodeKey: r.node_key,
    refType: r.ref_type,
    refId: r.ref_id,
    lockedUntil: r.fire_at.toISOString(),
  }));
}

/**
 * Complete an external task — publishes the standard completeTask command
 * so the workflow engine advances normally.
 */
export async function completeExternalTask(
  tenantId: string,
  taskId: string,
  workerId: string,
  result?: Record<string, unknown>,
): Promise<void> {
  // Verify lock ownership
  const rows = (await db.execute(sql`
    SELECT id, instance_id, name, node_key, ref_type, ref_id, assignee_id, fire_at, status
    FROM workflow.tasks
    WHERE id = ${taskId} AND tenant_id = ${tenantId}
    LIMIT 1
  `)) as unknown as Array<{
    id: string; instance_id: string; name: string; node_key: string | null;
    ref_type: string | null; ref_id: string | null;
    assignee_id: string | null; fire_at: Date | null; status: string;
  }>;

  const task = rows[0];
  if (!task) throw new HttpError(404, "NOT_FOUND", "task not found");
  if (task.status !== "pending") throw new HttpError(409, "ALREADY_COMPLETED", "task is no longer pending");
  const workerUuid = toWorkerUuid(workerId);
  if (task.assignee_id !== workerUuid) throw new HttpError(403, "NOT_LOCKED", "task is not locked by this worker");
  if (task.fire_at && task.fire_at < new Date()) throw new HttpError(409, "LOCK_EXPIRED", "lock has expired; re-fetch the task");

  // Publish completeTask command (standard engine path)
  await queue.publish(COMMANDS.completeTask, {
    messageId: randomUUID(),
    type: COMMANDS.completeTask,
    tenantId,
    actorId: workerId,
    correlationId: randomUUID(),
    schemaVersion: "1.0",
    payload: {
      id: task.id,
      tenantId,
      instanceId: task.instance_id,
      name: task.name,
      nodeKey: task.node_key,
      refType: task.ref_type,
      refId: task.ref_id,
      decision: "approve",
      sodOverride: true, // external workers bypass SoD
      ...(result ? { externalResult: result } : {}),
    },
  });
}

/**
 * Fail an external task — optionally schedule a retry.
 */
export async function failExternalTask(
  tenantId: string,
  taskId: string,
  workerId: string,
  errorMessage?: string,
  retries?: number,
  retryTimeout?: number,
): Promise<void> {
  const rows = (await db.execute(sql`
    SELECT id, assignee_id, fire_at, status
    FROM workflow.tasks
    WHERE id = ${taskId} AND tenant_id = ${tenantId}
    LIMIT 1
  `)) as unknown as Array<{ id: string; assignee_id: string | null; fire_at: Date | null; status: string }>;

  const task = rows[0];
  if (!task) throw new HttpError(404, "NOT_FOUND", "task not found");
  if (task.status !== "pending") throw new HttpError(409, "ALREADY_COMPLETED", "task is no longer pending");
  const workerUuidFail = toWorkerUuid(workerId);
  if (task.assignee_id !== workerUuidFail) throw new HttpError(403, "NOT_LOCKED", "task is not locked by this worker");

  if (retries && retries > 0) {
    // Release lock, allow re-fetch after retryTimeout
    const retryAtIso = retryTimeout ? new Date(Date.now() + retryTimeout).toISOString() : null;
    await db.execute(sql`
      UPDATE workflow.tasks
      SET assignee_id = NULL,
          fire_at = ${retryAtIso}::timestamptz,
          escalation_count = escalation_count + 1,
          updated_at = NOW()
      WHERE id = ${taskId} AND tenant_id = ${tenantId}
    `);
  } else {
    // No retries left — reject the task
    await queue.publish(COMMANDS.completeTask, {
      messageId: randomUUID(),
      type: COMMANDS.completeTask,
      tenantId,
      actorId: workerId,
      correlationId: randomUUID(),
      schemaVersion: "1.0",
      payload: {
        id: task.id,
        tenantId,
        instanceId: task.id, // will be resolved by consumer
        name: "External Task Failed",
        decision: "reject",
        sodOverride: true,
        detail: { errorMessage: errorMessage ?? "external task failed after all retries" },
      },
    });
  }
}

/**
 * Extend the lock duration for a task the worker is still processing.
 */
export async function extendLock(
  tenantId: string,
  taskId: string,
  workerId: string,
  additionalMs: number,
): Promise<void> {
  const workerUuid = toWorkerUuid(workerId);
  const result = (await db.execute(sql`
    UPDATE workflow.tasks
    SET fire_at = fire_at + (${additionalMs} || ' milliseconds')::interval,
        updated_at = NOW()
    WHERE id = ${taskId}
      AND tenant_id = ${tenantId}
      AND assignee_id = ${workerUuid}::uuid
      AND status = 'pending'
      AND fire_at > NOW()
    RETURNING id
  `)) as unknown as Array<{ id: string }>;

  if (result.length === 0) {
    throw new HttpError(409, "EXTEND_FAILED", "task not found, not locked by this worker, or lock already expired");
  }
}
