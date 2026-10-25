import { sql } from "drizzle-orm";
import type { CommandOutcome, SubscribeOptions } from "@civitasone/queue";
import { runWithTenant } from "@civitasone/db";
import { db, sqlClient } from "./db.js";
import { enqueue } from "./outbox.js";
import { SERVICE } from "../topics.js";

/**
 * Human-facing reference numbers come from Postgres SEQUENCEs
 * (migrations/0054_reference_number_sequences.sql), never from Date.now()/Math.random().
 * Booking, lease, lease-request and meeting-diary numbers are allocated by the CONSUMER inside the
 * transaction that inserts the row, so a retry re-runs nextval() and cannot collide or lose the command.
 */

const AUDIT_TOPIC = "audit.event.record";

type Exec = { execute: (q: ReturnType<typeof sql>) => Promise<unknown> };

const SEQUENCES = {
  booking: "booking.booking_number_seq",
  lease: "citizen_lease.lease_number_seq",
  leaseRequest: "citizen_lease.lease_request_number_seq",
  dakMtg: "files.dak_mtg_seq",
} as const;
type SeqKey = keyof typeof SEQUENCES;

/** Calendar year in India (IST), so the year rolls over at IST midnight, not UTC. */
export function istYear(now: Date = new Date()): number {
  return Number(new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric" }).format(now));
}

export function formatNumber(prefix: string, year: number, seq: number, sep: "-" | "/" = "-"): string {
  return `${prefix}${sep}${year}${sep}${String(seq).padStart(6, "0")}`;
}

async function nextval(tx: Exec, key: SeqKey): Promise<number> {
  const rows = (await tx.execute(sql`SELECT nextval(${SEQUENCES[key]}::regclass)::bigint AS seq`)) as unknown as Array<{ seq: string | number }>;
  return Number(rows[0]!.seq);
}

export async function nextBookingNumber(tx: Exec): Promise<string> {
  return formatNumber("BK", istYear(), await nextval(tx, "booking"));
}
export async function nextLeaseNumber(tx: Exec): Promise<string> {
  return formatNumber("LS", istYear(), await nextval(tx, "lease"));
}
export async function nextLeaseRequestNumber(tx: Exec): Promise<string> {
  return formatNumber("LR", istYear(), await nextval(tx, "leaseRequest"));
}
/** Diary (DAK) number for a meeting: `MTG/YYYY/000123`. */
export async function nextMeetingDakNo(tx: Exec): Promise<string> {
  return formatNumber("MTG", istYear(), await nextval(tx, "dakMtg"), "/");
}
/**
 * eFile number for a file raised from another module: `<REF>/YYYY/000123`. Allocated by the route-side
 * command (not the consumer) because the number is returned in the 202 body. A sequence value is unique by
 * construction; it needs no tenant GUC (a sequence is not row-level-secured).
 */
export async function allocateModuleFileNo(refType: string): Promise<string> {
  const prefix = refType.split("_")[0]?.toUpperCase().slice(0, 3) || "GEN";
  const rows = await sqlClient`SELECT nextval('files.file_from_module_seq')::bigint AS seq`;
  return formatNumber(prefix, istYear(), Number((rows[0] as { seq: string | number }).seq), "/");
}

/**
 * Terminal-outcome hook for the create commands. When the queue gives up on a command (rejected, or
 * retries exhausted) the caller already holds a 202, so leave an audited failure record
 * (audit.event.record, outcome "failure") instead of letting the command vanish into a DLQ log line.
 * Runs outside any handler tenant context, hence runWithTenant.
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
