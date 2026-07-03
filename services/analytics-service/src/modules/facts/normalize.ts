/**
 * Map inbound cross-domain events to a normalised analytics fact row.
 * Pure + defensive: unknown shapes degrade to safe defaults rather than throw,
 * so a malformed upstream event can't crash the ingestion consumer.
 */
import type { FactEventInsert } from "./schema.js";
import { INBOUND } from "../../topics.js";

type Envelope = {
  messageId: string;
  tenantId: string;
  payload: Record<string, unknown>;
};

function num(v: unknown): string {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n.toFixed(2) : "0";
}

function str(v: unknown, fallback: string): string {
  return typeof v === "string" && v.length > 0 ? v.slice(0, 64) : fallback;
}

const SOURCE_BY_EVENT: Record<string, string> = {
  [INBOUND.financePaymentReleased]: "finance",
  [INBOUND.grantReleaseProcessed]: "grants",
  [INBOUND.procurementPoApproved]: "procurement",
};

export function normalizeFact(eventType: string, msg: Envelope): FactEventInsert {
  const p = msg.payload ?? {};
  const source = SOURCE_BY_EVENT[eventType] ?? "unknown";
  const systemActor = "00000000-0000-0000-0000-000000000000";
  return {
    tenantId: msg.tenantId,
    source,
    eventType: eventType.split(".").slice(1).join(".").slice(0, 64) || eventType.slice(0, 64),
    category: str(p.category ?? p.majorHead ?? p.module, "general"),
    status: str(p.status, "recorded"),
    amount: num(p.amount ?? p.totalAmount ?? p.value),
    occurredAt: typeof p.occurredAt === "string" ? new Date(p.occurredAt) : new Date(),
    dedupeKey: msg.messageId,
    createdBy: str(p.actorId, systemActor),
    updatedBy: str(p.actorId, systemActor),
  };
}
