import { createHash } from "node:crypto";
import { enqueue } from "../../shared/outbox.js";
import { COMMANDS } from "../../topics.js";
import type { JournalLine } from "./schema.js";

/**
 * Deterministic UUID derived from a stable string key. Used to make the GL
 * journal produced by a source document (bill/payment/challan) idempotent: the
 * same source doc always yields the same journal id, so a redelivered
 * journalPost cannot double-post (the gl consumer skips an existing id).
 */
export function deterministicId(key: string): string {
  const h = createHash("sha256").update(key).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

type SpineJournalInput = {
  tenantId: string;
  actorId: string;
  correlationId: string;
  /** Stable source key, e.g. "bill:<billId>" — drives the deterministic journal id + messageId. */
  sourceKey: string;
  type: string;
  postingDate: string;
  /** Lines already resolved to head UUIDs in accountCode; amounts are bigint paise. */
  lines: JournalLine[];
};

/**
 * Enqueue a balanced GL journal for a source document, in the SAME tx as the
 * business write. The gl consumer (finance.gl.post) picks it up via the outbox
 * relay and posts the double-entry. The journal id is deterministic from the
 * source key so redelivery is a no-op.
 *
 * NOTE: amounts are PAISE bigint end-to-end. We serialise debit/credit as
 * decimal strings (never Number()) so values that exceed 2^53 survive the
 * JSON payload round-trip; the gl consumer rebuilds them with BigInt(...).
 */
export async function enqueueSpineJournal(
  tx: Parameters<typeof enqueue>[0],
  j: SpineJournalInput,
): Promise<string> {
  const journalId = deterministicId(j.sourceKey);
  const lines = j.lines.map((l) => ({
    accountCode: l.accountCode,
    debitMinor: BigInt(l.debitMinor).toString(),
    creditMinor: BigInt(l.creditMinor).toString(),
    ...(l.narration ? { narration: l.narration } : {}),
  }));
  await enqueue(tx, {
    topic: COMMANDS.journalPost,
    eventType: COMMANDS.journalPost,
    tenantId: j.tenantId,
    actorId: j.actorId,
    correlationId: j.correlationId,
    payload: {
      id: journalId,
      tenantId: j.tenantId,
      voucherNo: "AUTO",
      type: j.type,
      postingDate: j.postingDate,
      lines,
    },
  });
  return journalId;
}
