import { pino } from "pino";
import { NonRetryableError, type Queue } from "@civitasone/queue";
import { getTableName, and, eq, sql } from "drizzle-orm";
import { parseMinor } from "@civitasone/schemas";
import { db } from "../../shared/db.js";
import { markProcessed, enqueue } from "../../shared/outbox.js";
import { cache } from "../../shared/infra.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import { masterTableByPrefix, masterMoneyFieldsByPrefix } from "./registry.js";

const AUDIT_TOPIC = "audit.event.record";

const log = pino({ name: "works-masters-consumer" });

interface PgErrorLike {
  code?: string;
  column_name?: string;
  constraint_name?: string;
  table_name?: string;
  message?: string;
}

/** The Postgres error behind `err` (postgres.js error, or one wrapped as `cause`). */
function pgErrorOf(err: unknown): PgErrorLike | null {
  for (const e of [err, (err as { cause?: unknown } | null)?.cause]) {
    if (e && typeof e === "object" && typeof (e as PgErrorLike).code === "string") return e as PgErrorLike;
  }
  return null;
}

/**
 * UAT F75/F76: a master write that breaks a table rule (SQLSTATE class 23,
 * e.g. 23502 NOT NULL, 23503 FK, 23505 unique) or carries bad data (class 22)
 * will fail the same way on every redelivery. It used to be rethrown as a
 * plain error, so the bus retried it to maxReceiveCount and then dead-lettered
 * it while the caller only ever saw the 202. Log it with the failing
 * column/constraint (no field values) and turn it into a NonRetryableError,
 * which the bus dead-letters at once with a "rejected" outcome. Any other
 * error (connection loss, timeout) is returned unchanged and stays retryable.
 */
function classifyWriteError(
  err: unknown,
  ctx: { op: "create" | "update"; masterType: unknown; id: unknown; messageId: string; tenantId: string; correlationId?: string },
): unknown {
  const pg = pgErrorOf(err);
  if (!pg?.code || !(pg.code.startsWith("23") || pg.code.startsWith("22"))) return err;
  const reason = `MASTER_${ctx.op.toUpperCase()}_REJECTED: ${String(ctx.masterType)} violates ${pg.code}${pg.column_name ? ` (column ${pg.column_name})` : ""}${pg.constraint_name ? ` (constraint ${pg.constraint_name})` : ""}`;
  log.error(
    {
      op: ctx.op,
      masterType: ctx.masterType,
      id: ctx.id,
      messageId: ctx.messageId,
      tenantId: ctx.tenantId,
      correlationId: ctx.correlationId,
      sqlState: pg.code,
      table: pg.table_name,
      column: pg.column_name,
      constraint: pg.constraint_name,
    },
    "master write rejected by the database (non-retryable)",
  );
  return new NonRetryableError(reason, err);
}

/**
 * Master-create consumer (fixes the CRITICAL CQRS bug where masters/routes.ts
 * used to publish to COMMANDS.proposalCreate).
 *
 * Resolves payload.masterType (the registry prefix, e.g. "sr-items") to its
 * table via masterTableByPrefix — the SAME registry masters/routes.ts uses to
 * publish — so a master type can never be routed to the wrong table.
 */
export function registerMasterConsumers(q: Queue): void {
  q.subscribe(COMMANDS.masterCreate, async (msg) => {
    const p = msg.payload as Record<string, unknown>;
    const { id, masterType, ...body } = p;
    const table = masterTableByPrefix[masterType as string];

    await db.transaction(async (tx) => {
      const ok = await markProcessed(tx, msg.messageId);
      if (!ok) return; // idempotent skip
      if (!table) return; // reject: unknown master type — never persist to the wrong table

      const values: Record<string, unknown> = { id, tenantId: msg.tenantId, ...body };
      for (const field of masterMoneyFieldsByPrefix[masterType as string] ?? []) {
        if (values[field] !== undefined && values[field] !== null) {
          values[field] = parseMinor(values[field] as string | number);
        }
      }

      // Insert target varies by masterType (union of 17 distinct table shapes);
      // the columns are validated upstream by the per-type zod schema in registry.ts.
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (tx.insert(table) as any).values(values);
      } catch (err) {
        throw classifyWriteError(err, { op: "create", masterType, id, messageId: msg.messageId, tenantId: msg.tenantId, correlationId: msg.correlationId });
      }

      await enqueue(tx, {
        topic: EVENTS.masterCreated,
        eventType: EVENTS.masterCreated,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { id, masterType },
      });
      await enqueue(tx, { topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload: { service: "works-service", action: "create", resourceType: "master", resourceId: msg.messageId, outcome: "success" } });
    });

    if (table) {
      // getTableName (not table._.name — that internal accessor is undefined
      // on this drizzle-orm version) mirrors the resource repo.ts caches under.
      await cache.invalidateResource(msg.tenantId, `master:${getTableName(table)}`);
    }
  });

  // Master-UPDATE consumer (GAP-WORKS-MASTERS-04). Resolves masterType -> table
  // via the SAME registry, applies the field patch for the matching row+tenant,
  // bumps `version`, and emits works.master.updated + an audit event in the
  // same transaction. Unknown master types are rejected (never touch the wrong
  // table), matching the create consumer's posture.
  q.subscribe(COMMANDS.masterUpdate, async (msg) => {
    const p = msg.payload as { id?: string; masterType?: string; patch?: Record<string, unknown> };
    const { id, masterType, patch } = p;
    const table = masterTableByPrefix[masterType as string];

    await db.transaction(async (tx) => {
      const ok = await markProcessed(tx, msg.messageId);
      if (!ok) return; // idempotent skip
      if (!table || !id || !patch) return; // reject: unknown type / malformed command

      const setValues: Record<string, unknown> = { ...patch, version: sql`${(table as { version: unknown }).version} + 1` };

      // Column set varies by masterType; patch fields are validated upstream by
      // the registry's per-type patch schema (patchMasterSchema by default:
      // name/code/active; work-description-types: keyword/active). Every master table shares id +
      // tenant_id columns (schema.ts), so this scoping is uniform.
      const cols = table as unknown as { id: Parameters<typeof eq>[0]; tenantId: Parameters<typeof eq>[0] };
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (tx.update(table) as any)
          .set(setValues)
          .where(and(eq(cols.id, id), eq(cols.tenantId, msg.tenantId)));
      } catch (err) {
        throw classifyWriteError(err, { op: "update", masterType, id, messageId: msg.messageId, tenantId: msg.tenantId, correlationId: msg.correlationId });
      }

      await enqueue(tx, {
        topic: EVENTS.masterUpdated,
        eventType: EVENTS.masterUpdated,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { id, masterType },
      });
      await enqueue(tx, { topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload: { service: "works-service", action: "update", resourceType: "master", resourceId: String(id), outcome: "success" } });
    });

    if (table) {
      await cache.invalidateResource(msg.tenantId, `master:${getTableName(table)}`);
    }
  });
}
