/**
 * CAP-086 — retention & erasure policy helper.
 *
 * DPDP §8(7) requires erasing personal data once the purpose is served / consent
 * withdrawn, subject to legal retention. A RetentionPolicy maps a data category
 * to a retention window; helpers identify records due for erasure and produce a
 * tombstoned (field-erased) copy. Pure.
 */
export interface RetentionPolicy {
  /** Data category, e.g. "kyc", "audit", "marketing". */
  category: string;
  /** Days to retain from the anchor date. */
  retainDays: number;
  /** Legal hold suspends erasure regardless of age. */
  legalHold?: boolean;
}

export function retentionDeadline(anchor: Date, policy: RetentionPolicy): Date {
  return new Date(anchor.getTime() + policy.retainDays * 86_400_000);
}

/** True when a record has passed its retention window (and is not on legal hold). */
export function isRetentionExpired(anchor: Date, policy: RetentionPolicy, now = new Date()): boolean {
  if (policy.legalHold) return false;
  return now.getTime() > retentionDeadline(anchor, policy).getTime();
}

/** Filter records whose anchor date is past retention. */
export function dueForErasure<T>(records: T[], anchorOf: (r: T) => Date, policy: RetentionPolicy, now = new Date()): T[] {
  return records.filter((r) => isRetentionExpired(anchorOf(r), policy, now));
}

export type ErasureMode = "null" | "tombstone" | "hash";

/**
 * Produce an erased copy of `record`: the named PII fields are replaced per
 * `mode` while non-PII fields (ids, timestamps) are preserved so referential
 * integrity and audit trails survive erasure ("erasure by anonymisation").
 */
export function eraseFields<T extends Record<string, unknown>>(record: T, fields: string[], mode: ErasureMode = "tombstone"): T {
  const out: Record<string, unknown> = { ...record };
  for (const f of fields) {
    if (!(f in out)) continue;
    switch (mode) {
      case "null": out[f] = null; break;
      case "tombstone": out[f] = "[erased]"; break;
      case "hash": {
        const v = out[f];
        out[f] = v === null || v === undefined ? v : `erased:${String(v).length}`;
        break;
      }
    }
  }
  return out as T;
}
