/**
 * CAP-060 — dead-letter service: ingestion + requeue(replay)/discard.
 *
 * Requeue republishes the original payload to its topic through the configured
 * queue driver, then marks the row requeued + writes an audit action. Publish
 * happens BEFORE the status flip so a queue outage leaves the row `pending`
 * (fail-closed) rather than silently "requeued" with nothing sent — an honest
 * 503 is surfaced instead of fabricated success.
 */
import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { db } from "../../shared/db.js";
import { queue } from "../../shared/infra.js";
import * as repo from "./repo.js";
import { applyDlqAction, DlqError, type DlqStatus } from "./domain.js";
import type { DeadLetterRow } from "./schema.js";

export class ReplayError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

export interface RecordDeadLetterInput {
  topic: string;
  messageId?: string | undefined;
  sourceService?: string | undefined;
  correlationId?: string | undefined;
  payload?: unknown;
  error?: string | undefined;
}

/** Persist a terminal delivery failure. Callable from a consumer/worker. */
export async function recordDeadLetter(
  ctx: Pick<RequestContext, "tenantId">,
  input: RecordDeadLetterInput,
): Promise<DeadLetterRow> {
  return db.transaction((tx) =>
    repo.upsertDeadLetter(tx, {
      tenantId: ctx.tenantId,
      topic: input.topic,
      ...(input.messageId ? { messageId: input.messageId } : {}),
      ...(input.sourceService ? { sourceService: input.sourceService } : {}),
      ...(input.correlationId ? { correlationId: input.correlationId } : {}),
      payload: (input.payload ?? {}) as Record<string, unknown>,
      ...(input.error ? { error: input.error } : {}),
    }),
  );
}

async function publishToTopic(row: DeadLetterRow, actorId: string): Promise<void> {
  try {
    await queue.publish(row.topic, {
      type: row.topic,
      tenantId: row.tenantId,
      actorId,
      correlationId: row.correlationId ?? randomUUID(),
      schemaVersion: "1",
      payload: row.payload,
      ...(row.messageId ? { messageId: row.messageId } : {}),
    });
  } catch (err) {
    throw new ReplayError(503, "REPLAY_UNAVAILABLE", `failed to republish to '${row.topic}': ${(err as Error).message}`);
  }
}

/** Requeue (replay) one dead letter. Publish first, then mark requeued + audit. */
export async function requeueOne(
  ctx: Pick<RequestContext, "tenantId" | "actorId">,
  id: string,
  note?: string,
): Promise<DeadLetterRow> {
  const row = await repo.getDeadLetter(ctx.tenantId, id);
  if (!row) throw new ReplayError(404, "NOT_FOUND", "dead letter not found");
  assertActionable(row.status as DlqStatus, "requeue");

  await publishToTopic(row, ctx.actorId);

  const updated = await db.transaction(async (tx) => {
    const u = await repo.updateStatus(tx, ctx.tenantId, id, {
      status: "requeued",
      requeuedAt: new Date(),
      actionedBy: ctx.actorId,
    });
    if (u) {
      await repo.insertAction(tx, {
        tenantId: ctx.tenantId,
        deadLetterId: id,
        action: "requeue",
        note: note ?? null,
        actorId: ctx.actorId,
      });
    }
    return u;
  });
  // If a concurrent requeue already claimed it, return the current row.
  return updated ?? (await repo.getDeadLetter(ctx.tenantId, id))!;
}

/** Discard one dead letter (no republish). */
export async function discardOne(
  ctx: Pick<RequestContext, "tenantId" | "actorId">,
  id: string,
  note?: string,
): Promise<DeadLetterRow> {
  const row = await repo.getDeadLetter(ctx.tenantId, id);
  if (!row) throw new ReplayError(404, "NOT_FOUND", "dead letter not found");
  assertActionable(row.status as DlqStatus, "discard");

  const updated = await db.transaction(async (tx) => {
    const u = await repo.updateStatus(tx, ctx.tenantId, id, {
      status: "discarded",
      discardedAt: new Date(),
      actionedBy: ctx.actorId,
    });
    if (u) {
      await repo.insertAction(tx, {
        tenantId: ctx.tenantId,
        deadLetterId: id,
        action: "discard",
        note: note ?? null,
        actorId: ctx.actorId,
      });
    }
    return u;
  });
  return updated ?? (await repo.getDeadLetter(ctx.tenantId, id))!;
}

export interface BulkResult {
  requeued: string[];
  failed: { id: string; reason: string }[];
}

/** Bulk requeue by explicit ids and/or a topic filter (pending only). */
export async function requeueBulk(
  ctx: Pick<RequestContext, "tenantId" | "actorId">,
  opts: { ids?: string[] | undefined; topic?: string | undefined; limit?: number | undefined },
): Promise<BulkResult> {
  const limit = Math.min(opts.limit ?? 200, 500);
  let candidates: DeadLetterRow[] = [];
  if (opts.ids && opts.ids.length > 0) {
    candidates = await db.transaction((tx) => repo.getPendingByIds(tx, ctx.tenantId, opts.ids!.slice(0, limit)));
  } else if (opts.topic) {
    candidates = await repo.listDeadLetters(ctx.tenantId, { status: "pending", topic: opts.topic }, limit);
  } else {
    throw new ReplayError(400, "BAD_REQUEST", "provide ids[] or topic to bulk requeue");
  }

  const result: BulkResult = { requeued: [], failed: [] };
  for (const row of candidates) {
    try {
      await requeueOne(ctx, row.id);
      result.requeued.push(row.id);
    } catch (err) {
      result.failed.push({ id: row.id, reason: (err as Error).message });
    }
  }
  return result;
}

function assertActionable(status: DlqStatus, action: "requeue" | "discard"): void {
  try {
    applyDlqAction(status, action);
  } catch (err) {
    if (err instanceof DlqError) throw new ReplayError(409, err.code, err.message);
    throw err;
  }
}
