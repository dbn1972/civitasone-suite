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
  /** Hash-chain (recorded) instant: strictly increasing per tenant; orders the chain. */
  occurredAt: string;
  /** UAT B10-F83: when the audited action happened (producer commit time); occurredAt for older rows. */
  eventAt: string;
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
 * V4-G-05: canonical, key-order-independent JSON. Postgres jsonb does not
 * preserve object key order, so a digest over plain JSON.stringify of the
 * pre-insert object can never be reproduced from the stored row. The value is
 * first normalised through a JSON round-trip (drops undefined, applies toJSON,
 * exactly what the jsonb column keeps) and object keys are then sorted
 * recursively.
 */
export function canonicalJson(value: unknown): string {
  const normalised: unknown = JSON.parse(JSON.stringify(value ?? null));
  const ser = (v: unknown): string => {
    if (Array.isArray(v)) return `[${v.map(ser).join(",")}]`;
    if (v !== null && typeof v === "object") {
      const o = v as Record<string, unknown>;
      return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${ser(o[k])}`).join(",")}}`;
    }
    return JSON.stringify(v);
  };
  return ser(normalised);
}

/**
 * Tamper-evident chain hash. P1-4: the digest binds the full event content
 * (actor, target, payload) in addition to identity + prevHash, so a row's body
 * cannot be altered without breaking the chain. Content is folded into a stable
 * SHA-256 digest of canonical JSON to keep the chained string bounded.
 * V4-G-05: `occurredAt` MUST be the exact instant persisted in occurred_at and
 * the content is canonicalised, so the hash is reproducible from stored rows.
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
    .update(canonicalJson({ actor: content.actor ?? null, target: content.target ?? null, payload: content.payload ?? null }))
    .digest("hex");
  return createHash("sha256")
    .update(`${id}:${tenantId}:${type}:${prevHash ?? ""}:${occurredAt}:${contentDigest}`)
    .digest("hex")
    .slice(0, 64);
}

/**
 * V4-G-05: the instant to hash AND persist as occurred_at for the next chain
 * link. Strictly later than the previous link (ms resolution) so chain order
 * by occurred_at is unambiguous even when two appends land in the same ms.
 */
export function nextOccurredAt(latestOccurredAt: string | null | undefined, nowMs: number = Date.now()): Date {
  const prev = latestOccurredAt ? Date.parse(latestOccurredAt) : NaN;
  return new Date(Number.isFinite(prev) && prev >= nowMs ? prev + 1 : nowMs);
}

export type ChainRow = {
  id: string;
  tenantId: string;
  type: string;
  actor: unknown;
  target: unknown;
  payload: unknown;
  prevHash: string | null;
  eventHash: string | null;
  occurredAt: string;
};

export type ChainVerification = {
  ok: boolean;
  checked: number;
  /** ids whose prevHash is not the preceding row's eventHash (first row is the anchor and is not link-checked). */
  linkBreaks: string[];
  /** ids whose stored eventHash is not reproducible from the stored row. */
  hashMismatches: string[];
};

/**
 * V4-G-05: re-verify a tenant's chain from STORED rows (ordered oldest first).
 * Rows written before this fix hashed an instant that was never persisted and
 * therefore report as hashMismatches; their linkage is still checked.
 */
export function verifyChain(rows: readonly ChainRow[]): ChainVerification {
  const linkBreaks: string[] = [];
  const hashMismatches: string[] = [];
  rows.forEach((r, i) => {
    if (i > 0 && r.prevHash !== rows[i - 1]!.eventHash) linkBreaks.push(r.id);
    const expected = computeHash(r.id, r.tenantId, r.type, r.prevHash, r.occurredAt, {
      actor: r.actor, target: r.target, payload: r.payload,
    });
    if (expected !== r.eventHash) hashMismatches.push(r.id);
  });
  return { ok: linkBreaks.length === 0 && hashMismatches.length === 0, checked: rows.length, linkBreaks, hashMismatches };
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

/**
 * OWNER DECISION #20 (TENANT-ADMIN-AUDIT-03, DPDP): actor identifiers and source
 * IPs leave the tenant audit LIST masked by default. The clear values are only
 * available through the audited reveal route (audit_officer + reason).
 */
export function maskActorLabel(actor: string): string {
  const at = actor.indexOf("@");
  if (at < 1) return actor; // service ids / usernames are not personal identifiers here
  return `${actor.slice(0, 1)}***${actor.slice(at)}`;
}

export function maskIpAddress(ip: string): string {
  const v = ip.trim();
  if (v.includes(":")) return `${v.split(":")[0] ?? ""}:*:*:*`;
  const parts = v.split(".");
  if (parts.length === 4) return `${parts[0]}.${parts[1]}.*.*`;
  return "***";
}

/** The human label of an event actor (email, else name, else "system"). */
export function actorLabel(actor: unknown): string {
  if (typeof actor === "object" && actor !== null) {
    const a = actor as Record<string, unknown>;
    if (typeof a.email === "string" && a.email.length > 0) return a.email;
    if (typeof a.name === "string" && a.name.length > 0) return a.name;
  }
  return "system";
}
