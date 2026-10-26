import { sql } from "drizzle-orm";
import type { CommandOutcome, SubscribeOptions } from "@civitasone/queue";
import { runWithTenant } from "@civitasone/db";
import { db, type Db } from "./db.js";
import { enqueue } from "./outbox.js";

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

const AUDIT_TOPIC = "audit.event.record";
const SYSTEM_ACTOR = "00000000-0000-0000-0000-000000000000";

/**
 * Human-facing reference numbers are allocated by the CONSUMER (or the route
 * handler that owns the insert), inside the transaction that inserts the row,
 * from a Postgres SEQUENCE (migrations/0047_reference_number_sequences.sql).
 * They used to be built from `Date.now()` / random uuid slices before the
 * command was published, so a UNIQUE-violation retry replayed the same value
 * and an accepted (202) command could be lost for good.
 */

/** Calendar year in India (IST), so the year rolls over at IST midnight, not UTC. */
export function istYear(now: Date = new Date()): number {
  return Number(new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric" }).format(now));
}

export function formatNumber(prefix: string, year: number, seq: number): string {
  return `${prefix}-${year}-${String(seq).padStart(6, "0")}`;
}

async function nextval(tx: Tx, seqName: "case_number_seq" | "definition_import_seq"): Promise<number> {
  const rows = (await tx.execute(
    sql`SELECT nextval(${`workflow.${seqName}`}::regclass)::bigint AS seq`,
  )) as unknown as Array<{ seq: string | number }>;
  return Number(rows[0]!.seq);
}

/** CASE-YYYY-000123 -- case registry rows (root and split children). */
export async function nextCaseNumber(tx: Tx): Promise<string> {
  return formatNumber("CASE", istYear(), await nextval(tx, "case_number_seq"));
}

/** BPMN-YYYY-000123 -- definition code for an imported BPMN process. */
export async function nextImportedDefinitionCode(tx: Tx): Promise<string> {
  return formatNumber("BPMN", istYear(), await nextval(tx, "definition_import_seq"));
}

/**
 * Write the audited failure record for a create command that reached a terminal
 * failure (the caller already holds a 202, so it must not vanish silently).
 * Runs outside any handler tenant context, hence runWithTenant.
 */
export async function recordFailedCreate(
  action: string, resourceType: string,
  info: { messageId: string; tenantId: string; status: string; reason?: string | null },
): Promise<void> {
  await runWithTenant(info.tenantId, () =>
    db.transaction(async (tx) => {
      await enqueue(tx, {
        topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
        tenantId: info.tenantId, actorId: SYSTEM_ACTOR, correlationId: info.messageId,
        payload: {
          service: "workflow", action, resourceType, resourceId: info.messageId,
          outcome: "failure", details: { status: info.status, reason: info.reason ?? null, messageId: info.messageId },
        },
      });
    }),
  );
}

/**
 * Terminal-outcome hook for plain `queue.subscribe` create commands: when the
 * queue gives up (rejected, or retries exhausted) leave an audited failure.
 */
export function auditFailedCreate(action: string, resourceType: string): SubscribeOptions {
  return {
    onOutcome: async (outcome: CommandOutcome) => {
      if (outcome.status === "succeeded") return;
      await recordFailedCreate(action, resourceType, outcome);
    },
  };
}
