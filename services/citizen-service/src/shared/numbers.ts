import { sql, type SQL } from "drizzle-orm";
import type { CommandOutcome, SubscribeOptions } from "@civitasone/queue";
import { runWithTenant } from "@civitasone/db";
import { db } from "./db.js";
import { enqueue } from "./outbox.js";
import { SERVICE } from "../topics.js";

/**
 * Human-facing reference numbers come from Postgres SEQUENCEs
 * (migrations/0042_reference_number_sequences.sql). They used to be built from
 * Date.now() / random bytes / a uuid prefix OUTSIDE the insert transaction and
 * carried in the command payload, so a UNIQUE-violation retry replayed the same
 * value and an accepted (202) command could be lost for good.
 *
 * Where each is allocated:
 *  - application ref_no, RTI rti_no, notice notice_no: by the CONSUMER, inside the
 *    insert transaction, so a retry re-runs nextval() and cannot collide.
 *  - intake tracking_no, helpdesk ticket_no: by the ROUTE, immediately before
 *    publish, because the 202 response must carry the number back to the caller
 *    (web contract). The value is still unique by construction, and the command
 *    carries it unchanged, so a redelivery (same messageId) is deduplicated by
 *    markProcessed and persists exactly once.
 */

export type NumberKind = "application_ref" | "tracking_no" | "rti_no" | "ticket_no" | "notice_no";

const SEQUENCE: Record<NumberKind, string> = {
  application_ref: "application.application_ref_seq",
  tracking_no: "application.tracking_no_seq",
  rti_no: "rti.rti_no_seq",
  ticket_no: "helpdesk.ticket_no_seq",
  notice_no: "engagement.notice_no_seq",
};

/** Calendar year in India (IST), so the year rolls over at IST midnight, not UTC. */
export function istYear(now: Date = new Date()): number {
  return Number(new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric" }).format(now));
}

export function formatNumber(kind: NumberKind, year: number, seq: number): string {
  const n = String(seq).padStart(6, "0");
  switch (kind) {
    case "application_ref": return `APP-${year}-${n}`;
    case "tracking_no": return `CIT-${year}-${n}`;
    case "rti_no": return `RTI/${year}/${n}`;
    case "ticket_no": return `HD-${year}-${n}`;
    case "notice_no": return `NTC-${year}-${n}`;
  }
}

/** Anything with drizzle's `execute` (a transaction, or the db itself). */
type Executor = { execute: (query: SQL) => PromiseLike<unknown> };

export async function nextNumber(tx: Executor, kind: NumberKind): Promise<string> {
  const rows = (await tx.execute(
    sql`SELECT nextval(${SEQUENCE[kind]}::regclass)::bigint AS seq`,
  )) as unknown as Array<{ seq: string | number }>;
  return formatNumber(kind, istYear(), Number(rows[0]!.seq));
}

/**
 * Allocate outside an existing transaction (route-level allocation). nextval()
 * is non-transactional, so a short transaction of its own is enough; it also
 * sets the tenant GUC like every other db access.
 */
export function allocateNumber(kind: NumberKind): Promise<string> {
  return db.transaction((tx) => nextNumber(tx, kind));
}

/**
 * Terminal-outcome hook for the create commands. When the queue gives up on a
 * command (rejected, or retries exhausted) the caller already holds a 202, so
 * leave an audited failure record (audit.event.record, outcome "failure")
 * instead of letting the command vanish into a DLQ log line. Runs outside any
 * handler tenant context (bus.ts), hence runWithTenant.
 */
export function auditFailedCreate(action: string, resourceType: string): SubscribeOptions {
  return {
    onOutcome: async (outcome: CommandOutcome) => {
      if (outcome.status === "succeeded") return;
      await runWithTenant(outcome.tenantId, () =>
        db.transaction(async (tx) => {
          await enqueue(tx, {
            topic: "audit.event.record", eventType: "audit.event.record",
            tenantId: outcome.tenantId, actorId: "00000000-0000-0000-0000-000000000000",
            correlationId: outcome.messageId,
            payload: {
              service: SERVICE, action, resourceType, resourceId: outcome.messageId,
              outcome: "failure", details: { status: outcome.status, reason: outcome.reason ?? null, messageId: outcome.messageId },
            },
          });
        }),
      );
    },
  };
}
