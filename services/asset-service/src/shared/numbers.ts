import { sql } from "drizzle-orm";
import type { CommandOutcome, SubscribeOptions } from "@civitasone/queue";
import { runWithTenant } from "@civitasone/db";
import { db } from "./db.js";
import { enqueue } from "./outbox.js";
import { SERVICE } from "../topics.js";

/**
 * Human-facing reference numbers are allocated by the CONSUMER, inside the
 * transaction that inserts the row, from a Postgres SEQUENCE
 * (migrations/0041_reference_number_sequences.sql). They used to be generated
 * in-process as `PREFIX-${Date.now().toString(36)}-${counter}`, where the
 * counter restarted at 0 on every worker restart and was not shared between
 * replicas, so two creates could be issued the same number and stored silently.
 */

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

const AUDIT_TOPIC = "audit.event.record";

/** Every reference-number sequence: prefix + fully-qualified sequence name. */
export const NUMBER_SEQUENCES = {
  streetlightFault:   { prefix: "SLF", seq: "streetlight.fault_number_seq" },
  streetlightRequest: { prefix: "SLR", seq: "streetlight.request_number_seq" },
  waterApplication:   { prefix: "WA",  seq: "water_connections.application_number_seq" },
  waterConnection:    { prefix: "WC",  seq: "water_connections.connection_number_seq" },
  waterBill:          { prefix: "WB",  seq: "water_metering.bill_number_seq" },
  waterTankerBooking: { prefix: "WT",  seq: "water_tanker.booking_number_seq" },
} as const;

export type NumberKind = keyof typeof NUMBER_SEQUENCES;

/** Calendar year in India (IST), so the year rolls over at IST midnight, not UTC. */
export function istYear(now: Date = new Date()): number {
  return Number(new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric" }).format(now));
}

export function formatNumber(prefix: string, year: number, seq: number): string {
  return `${prefix}-${year}-${String(seq).padStart(6, "0")}`;
}

/** Allocate the next number of `kind` inside the caller's insert transaction. */
export async function nextNumber(tx: Tx, kind: NumberKind): Promise<string> {
  const { prefix, seq } = NUMBER_SEQUENCES[kind];
  const rows = (await tx.execute(
    sql`SELECT nextval(${seq}::regclass)::bigint AS seq`,
  )) as unknown as Array<{ seq: string | number }>;
  return formatNumber(prefix, istYear(), Number(rows[0]!.seq));
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
