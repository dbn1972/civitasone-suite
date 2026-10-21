import { createHash } from "node:crypto";

export type AuditEventView = {
  id: string;
  tenantId: string;
  type: string;
  actor: Record<string, unknown>;
  target: string | null;
  payload: Record<string, unknown>;
  // CERT-In required fields
  ipAddress: string | null;
  userAgent: string | null;
  oldValue: Record<string, unknown> | null;
  newValue: Record<string, unknown> | null;
  severity: string;
  prevHash: string | null;
  eventHash: string | null;
  correlationId: string | null;
  occurredAt: string;
  /** ISO-8601 string; computed as occurredAt + 180d if DB column not yet present (pre-migration compat) */
  retainUntil: string;
};

export type IngestPayload = {
  service: string;
  action: string;
  resourceType: string;
  resourceId: string;
  outcome: string;
  [k: string]: unknown;
};

/**
 * Tamper-evident chain hash. P1-4: the digest now binds the full event content
 * (actor, target, payload) in addition to identity + prevHash, so a row's body
 * cannot be altered without breaking the chain. Content is folded into a stable
 * SHA-256 digest of canonical JSON to keep the chained string bounded.
 */
export function computeHash(
  id: string,
  tenantId: string,
  type: string,
  prevHash: string | null,
  occurredAt: string,
  content: { actor: unknown; target: unknown; payload: unknown },
): string {
  const contentDigest = createHash("sha256")
    .update(JSON.stringify({ actor: content.actor ?? null, target: content.target ?? null, payload: content.payload ?? null }))
    .digest("hex");
  return createHash("sha256")
    .update(`${id}:${tenantId}:${type}:${prevHash ?? ""}:${occurredAt}:${contentDigest}`)
    .digest("hex")
    .slice(0, 64);
}

/**
 * GAP-HR-AUDIT-LOG-04: the outcome column of the CSV export. The producer's own
 * `payload.outcome` wins; only without one is it inferred from the severity (the
 * same error/critical -> failure, info/warning -> success rule the list routes
 * use), and anything else is "unknown" rather than a guess.
 */
export function exportOutcome(outcome: string | null | undefined, severity: string | null | undefined): string {
  if (outcome) return outcome;
  if (severity === "error" || severity === "critical") return "failure";
  if (severity === "info" || severity === "warning") return "success";
  return "unknown";
}

/** Human-readable actor for the export: the email, else the name, else the bare actor id; "system" when none. */
export function exportActorLabel(actor: Record<string, unknown> | null | undefined): string {
  if (!actor) return "system";
  for (const k of ["email", "name", "actorId"] as const) {
    const v = actor[k];
    if (typeof v === "string" && v.length > 0) return v;
  }
  return "system";
}
