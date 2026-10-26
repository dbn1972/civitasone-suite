import { sql } from "drizzle-orm";
import type { CommandOutcome, SubscribeOptions } from "@civitasone/queue";
import { runWithTenant } from "@civitasone/db";
import { db, type ScopedTx } from "./db.js";
import { enqueue } from "./outbox.js";
import { AUDIT_TOPIC, SERVICE } from "../topics.js";

/**
 * Human-facing reference numbers are allocated by the CONSUMER, inside the
 * transaction that inserts the row, from a Postgres SEQUENCE
 * (migrations/0003_number_sequences.sql). They used to be generated in the
 * route handler as `PREFIX-${Date.now()}-${randomInt()}` and carried in the
 * command payload, so a UNIQUE-violation retry replayed the same code and an
 * accepted (202) command could be lost for good.
 */

/** Calendar year in India (IST), so the year rolls over at IST midnight, not UTC. */
export function istYear(now: Date = new Date()): number {
  return Number(new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric" }).format(now));
}

export function formatNumber(prefix: string, year: number, seq: number): string {
  return `${prefix}-${year}-${String(seq).padStart(6, "0")}`;
}

type SeqName = "complaint_number_seq" | "registration_number_seq" | "request_number_seq" | "task_number_seq" | "hotspot_code_seq";

async function nextval(tx: ScopedTx, seqName: SeqName): Promise<number> {
  const rows = (await tx.execute(
    sql`SELECT nextval(${`civitas_swm.${seqName}`}::regclass)::bigint AS seq`,
  )) as unknown as Array<{ seq: string | number }>;
  return Number(rows[0]!.seq);
}

export async function nextComplaintNumber(tx: ScopedTx): Promise<string> {
  return formatNumber("SWM", istYear(), await nextval(tx, "complaint_number_seq"));
}

export async function nextRegistrationNumber(tx: ScopedTx): Promise<string> {
  return formatNumber("SWMG", istYear(), await nextval(tx, "registration_number_seq"));
}

export async function nextRequestNumber(tx: ScopedTx): Promise<string> {
  return formatNumber("SWMR", istYear(), await nextval(tx, "request_number_seq"));
}

export async function nextTaskNumber(tx: ScopedTx): Promise<string> {
  return formatNumber("SWMT", istYear(), await nextval(tx, "task_number_seq"));
}

export async function nextHotspotCode(tx: ScopedTx): Promise<string> {
  return formatNumber("SWMH", istYear(), await nextval(tx, "hotspot_code_seq"));
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
            topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
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
