import { sql } from "drizzle-orm";
import { pino } from "pino";
import { db, type ScopedTx } from "./db.js";
import { enqueue } from "./outbox.js";
import { HttpError } from "./context.js";

/**
 * Human-facing reference numbers (service requests, RTI requests) are allocated
 * from Postgres SEQUENCEs (migrations/0179_reference_number_sequences.sql),
 * INSIDE the transaction that inserts the row. They used to be built as
 * `PREFIX/YYYY/${Date.now().toString(36).slice(-6)}`: two creates in the same
 * millisecond got the same suffix, and the rti_requests UNIQUE(reference_no)
 * turned that into a 500 for the second citizen. A sequence cannot hand out the
 * same value twice, and a rolled-back attempt that is retried simply draws a
 * fresh value. The format (slash-separated, year in the middle) is unchanged.
 */

const log = pino({ name: "crm.reference-numbers" });

type SeqName = "service_request_ref_seq" | "rti_ref_seq";

/** Calendar year in India (IST), so the year rolls over at IST midnight, not UTC. */
export function istYear(now: Date = new Date()): number {
  return Number(new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric" }).format(now));
}

export function padSeq(seq: number): string {
  return String(seq).padStart(6, "0");
}

async function nextval(tx: ScopedTx, seqName: SeqName): Promise<number> {
  const rows = (await tx.execute(
    sql`SELECT nextval(${`crm.${seqName}`}::regclass)::bigint AS seq`,
  )) as unknown as Array<{ seq: string | number }>;
  return Number(rows[0]!.seq);
}

/** SRQ/YYYY/000123 */
export async function nextServiceRequestRef(tx: ScopedTx): Promise<string> {
  return `SRQ/${istYear()}/${padSeq(await nextval(tx, "service_request_ref_seq"))}`;
}

/** RTI/YYYY/DEPT/000123 (DEPT = first 6 chars of the department, as before). */
export async function nextRtiRef(tx: ScopedTx, departmentRef: string): Promise<string> {
  const dept = departmentRef
    .slice(0, 6)
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "X");
  return `RTI/${istYear()}/${dept}/${padSeq(await nextval(tx, "rti_ref_seq"))}`;
}

export interface FailureAuditCtx {
  tenantId: string;
  actorId: string;
  correlationId?: string | undefined;
}

/**
 * Records an audited FAILURE (audit.event.record, outcome "failure") for a
 * create that ended in an error, in its own transaction (the create tx has
 * rolled back). Never throws: the original error is what the caller sees.
 */
export async function recordCreateFailure(
  ctx: FailureAuditCtx,
  action: string,
  resourceType: string,
  err: unknown,
): Promise<void> {
  try {
    await db.transaction(async (tx) => {
      await enqueue(tx, {
        topic: "audit.event.record",
        eventType: "audit.event.record",
        tenantId: ctx.tenantId,
        actorId: ctx.actorId,
        correlationId: ctx.correlationId ?? "",
        payload: {
          service: "crm",
          action,
          resourceType,
          resourceId: ctx.correlationId ?? "",
          outcome: "failure",
          details: { reason: err instanceof Error ? err.name : "unknown" },
        },
      });
    });
  } catch (auditErr) {
    log.error({ err: auditErr, action }, "failed to write create-failure audit record");
  }
}

/**
 * Runs a create and, if it fails with anything other than a deliberate
 * client-facing HttpError (4xx validation), leaves an audited failure record
 * before rethrowing the original error.
 */
export async function withCreateFailureAudit<T>(
  ctx: FailureAuditCtx,
  action: string,
  resourceType: string,
  fn: () => Promise<T>,
): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (!(err instanceof HttpError)) await recordCreateFailure(ctx, action, resourceType, err);
    throw err;
  }
}
