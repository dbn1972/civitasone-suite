/**
 * Persistence for configurable dedup rules + candidate fetch (DQ-001).
 */
import { eq, and, sql } from "drizzle-orm";
import { db, scopedRead } from "../../shared/db.js";
import { HttpError } from "../../shared/context.js";
import { enqueue } from "../../shared/outbox.js";
import { dedupRules, dedupDismissals, type DedupRuleRow } from "./dedup-schema.js";
import { contacts } from "./schema.js";
import { DEFAULT_DEDUP_RULES, type DedupRule, type DedupCandidate, type DedupField } from "./dedup-domain.js";
import { computeDedupPairs, pairIdOf, type DedupCandidatePair, type DedupPairInput } from "./dedup-candidates-domain.js";

const AUDIT_TOPIC = "audit.event.record";

/** Map a DB row to the pure-domain rule shape. */
function toRule(r: DedupRuleRow): DedupRule {
  return {
    field: r.field as DedupField,
    matchType: r.matchType as "exact" | "fuzzy",
    weight: r.weight,
    threshold: r.threshold,
    enabled: r.enabled,
  };
}

/**
 * Read a tenant's dedup rules, seeding the defaults the first time they are
 * requested. Seeding is idempotent (ON CONFLICT DO NOTHING on tenant+field), so
 * a concurrent first read cannot double-insert.
 */
export async function getRules(tenantId: string, actorId: string): Promise<DedupRule[]> {
  const existing = await scopedRead((tx) =>
    tx.select().from(dedupRules).where(eq(dedupRules.tenantId, tenantId)),
  );
  if (existing.length > 0) return existing.map(toRule);

  await db.transaction(async (tx) => {
    for (const d of DEFAULT_DEDUP_RULES) {
      await tx
        .insert(dedupRules)
        .values({
          tenantId,
          field: d.field,
          matchType: d.matchType,
          weight: d.weight,
          threshold: d.threshold,
          enabled: d.enabled,
          createdBy: actorId,
          updatedBy: actorId,
        })
        .onConflictDoNothing();
    }
  });

  const seeded = await scopedRead((tx) =>
    tx.select().from(dedupRules).where(eq(dedupRules.tenantId, tenantId)),
  );
  return seeded.map(toRule);
}

/**
 * GAP-CRM-DEDUP-RULES-02 — list-level optimistic-concurrency metadata.
 *
 * `version` is a tenant-list token derived from `SUM(version)` across the
 * tenant's rule rows. Every upsert bumps at least one row's `version` by 1 (an
 * insert starts at 1, an update does `version + 1`), so the list sum strictly
 * increases on ANY change to the list — whether a different row or the same
 * row — which is exactly what a wholesale-PUT editor needs to detect a
 * concurrent admin edit. No schema change is required.
 */
export interface RulesListMeta {
  version: string;
  updatedBy: string | null;
  updatedAt: string | null;
}

export interface RulesList {
  rules: DedupRule[];
  meta: RulesListMeta;
}

type VersionRow = { version: string | number | null; updatedBy: string | null; updatedAt: Date | string | null };

/** Compute the list version + last-change metadata from a locked/unlocked tx. */
async function readListMeta(
  tx: { execute: (q: ReturnType<typeof sql>) => Promise<unknown> },
  tenantId: string,
  lock: boolean,
): Promise<RulesListMeta> {
  // The aggregate itself cannot carry FOR UPDATE; when locking is requested we
  // first lock the tenant's rows, then aggregate within the same transaction so
  // the version we compare against cannot change under us (no TOCTOU).
  if (lock) {
    await tx.execute(sql`SELECT id FROM crm.dedup_rules WHERE tenant_id = ${tenantId} FOR UPDATE`);
  }
  const rows = (await tx.execute(sql`
    SELECT COALESCE(SUM(version), 0)::text AS version,
           (SELECT updated_by FROM crm.dedup_rules WHERE tenant_id = ${tenantId} ORDER BY updated_at DESC LIMIT 1) AS "updatedBy",
           (SELECT updated_at FROM crm.dedup_rules WHERE tenant_id = ${tenantId} ORDER BY updated_at DESC LIMIT 1) AS "updatedAt"
    FROM crm.dedup_rules
    WHERE tenant_id = ${tenantId}
  `)) as unknown as VersionRow[];
  const r = rows[0];
  const updatedAt = r?.updatedAt ?? null;
  return {
    version: String(r?.version ?? "0"),
    updatedBy: r?.updatedBy ?? null,
    updatedAt: updatedAt instanceof Date ? updatedAt.toISOString() : updatedAt,
  };
}

/**
 * Read the tenant's rules together with the list-level concurrency token
 * (GAP-CRM-DEDUP-RULES-02). Seeds defaults on first read via getRules.
 */
export async function getRulesList(tenantId: string, actorId: string): Promise<RulesList> {
  const rules = await getRules(tenantId, actorId);
  const meta = await scopedRead((tx) => readListMeta(tx, tenantId, false));
  return { rules, meta };
}

export interface RuleUpsert {
  field: DedupField;
  matchType: "exact" | "fuzzy";
  weight: number;
  threshold: number;
  enabled: boolean;
}

/**
 * Replace/insert the given rules for a tenant (upsert by tenant+field). Rules
 * not present in the payload are left untouched, so a partial PUT is additive.
 *
 * GAP-CRM-DEDUP-RULES-02 optimistic concurrency: when `expectedVersion` is
 * supplied, the tenant's rows are locked (`FOR UPDATE`) and the current list
 * version re-read INSIDE the write transaction before any mutation. A mismatch
 * throws 409 VERSION_CONFLICT and the transaction rolls back untouched, so a
 * stale wholesale PUT can never overwrite a concurrent admin's change. The lock
 * serializes two same-version writers: the first commits (bumping the version),
 * the second then observes the new version and 409s.
 */
export async function upsertRules(
  tenantId: string,
  rules: RuleUpsert[],
  actorId: string,
  correlationId: string,
  expectedVersion?: string,
): Promise<RulesList> {
  await db.transaction(async (tx) => {
    if (expectedVersion !== undefined) {
      const current = await readListMeta(tx as unknown as { execute: (q: ReturnType<typeof sql>) => Promise<unknown> }, tenantId, true);
      if (current.version !== expectedVersion) {
        throw new HttpError(
          409,
          "VERSION_CONFLICT",
          "These matching rules were changed by another admin. Reload to see the latest, then re-apply your changes.",
        );
      }
    }
    for (const r of rules) {
      await tx
        .insert(dedupRules)
        .values({
          tenantId,
          field: r.field,
          matchType: r.matchType,
          weight: r.weight,
          threshold: r.threshold,
          enabled: r.enabled,
          createdBy: actorId,
          updatedBy: actorId,
        })
        .onConflictDoUpdate({
          target: [dedupRules.tenantId, dedupRules.field],
          set: {
            matchType: r.matchType,
            weight: r.weight,
            threshold: r.threshold,
            enabled: r.enabled,
            updatedAt: new Date(),
            updatedBy: actorId,
            version: sql`${dedupRules.version} + 1`,
          },
        });
    }
    // Governance-sensitive config change: record an audit event transactionally
    // (commits with the rule write) so a change to matching rules is traceable.
    await enqueue(tx as Parameters<typeof enqueue>[0], {
      topic: AUDIT_TOPIC,
      eventType: AUDIT_TOPIC,
      tenantId,
      actorId,
      correlationId,
      payload: {
        service: "crm",
        action: "dedup_rules_update",
        resourceType: "dedup_rule",
        resourceId: tenantId,
        outcome: "success",
        metadata: { ruleCount: rules.length, fields: rules.map((r) => r.field) },
      },
    });
  });
  return getRulesList(tenantId, actorId);
}

/**
 * Fetch active contacts as dedup candidates. email/phone are AES-GCM ciphertext
 * at rest but decrypted in-app by the customType, so they arrive here in
 * cleartext ready for normalized comparison. Bounded to keep the pre-save check
 * responsive on large tenants.
 */
export async function fetchCandidates(
  tenantId: string,
  limit = 2000,
  excludeId?: string,
): Promise<DedupCandidate[]> {
  const rows = await scopedRead((tx) =>
    tx
      .select({
        id: contacts.id,
        name: contacts.name,
        email: contacts.email,
        phone: contacts.phone,
        company: contacts.company,
        gstin: contacts.gstin,
        pan: contacts.pan,
      })
      .from(contacts)
      .where(and(eq(contacts.tenantId, tenantId), sql`${contacts.status} = 'active'`))
      .limit(limit),
  );
  return rows
    .filter((r) => r.id !== excludeId)
    .map((r) => ({
      id: r.id,
      name: r.name,
      email: r.email,
      phone: r.phone,
      company: r.company,
      gstin: r.gstin,
      pan: r.pan,
    }));
}

/**
 * GAP2-CRM-DEDUP-CANDIDATES-07 — fetch active contacts (with last-activity) for
 * the post-save pair computation. Keeps the comparison fields plus the display
 * snapshot the review UI shows.
 */
async function fetchPairInputs(tenantId: string, limit = 2000): Promise<DedupPairInput[]> {
  const rows = await scopedRead((tx) =>
    tx
      .select({
        id: contacts.id,
        name: contacts.name,
        email: contacts.email,
        phone: contacts.phone,
        company: contacts.company,
        gstin: contacts.gstin,
        pan: contacts.pan,
        lastActivityAt: contacts.lastActivityAt,
      })
      .from(contacts)
      .where(and(eq(contacts.tenantId, tenantId), sql`${contacts.status} = 'active'`))
      .limit(limit),
  );
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    email: r.email,
    phone: r.phone,
    company: r.company,
    gstin: r.gstin,
    pan: r.pan,
    lastActivity: r.lastActivityAt ? new Date(r.lastActivityAt).toISOString() : null,
  }));
}

/** Pair ids this tenant has dismissed (so they are never re-flagged). */
async function fetchDismissedPairIds(tenantId: string): Promise<Set<string>> {
  const rows = await scopedRead((tx) =>
    tx.select({ pairId: dedupDismissals.pairId }).from(dedupDismissals).where(eq(dedupDismissals.tenantId, tenantId)),
  );
  return new Set(rows.map((r) => r.pairId));
}

/**
 * GAP2-CRM-DEDUP-CANDIDATES-07 — the live list for /crm/dedup-candidates.
 * Computes near-duplicate pairs from the tenant's active contacts under the
 * configured rules (seeding defaults on first use), minus any dismissed pairs.
 */
export async function listDedupCandidatePairs(
  tenantId: string,
  actorId: string,
  limit = 200,
): Promise<DedupCandidatePair[]> {
  const [rules, inputs, dismissed] = await Promise.all([
    getRules(tenantId, actorId),
    fetchPairInputs(tenantId),
    fetchDismissedPairIds(tenantId),
  ]);
  return computeDedupPairs(inputs, rules, { dismissed, limit });
}

/**
 * GAP2-CRM-DEDUP-CANDIDATES-07 — dismiss a flagged pair so it does not resurface.
 * The decision is persisted and audited in the same transaction. Idempotent: a
 * repeat dismiss of the same pair refreshes who/when/why but does not error.
 */
export async function dismissDedupPair(
  tenantId: string,
  pairId: string,
  actorId: string,
  correlationId: string,
  reason?: string,
): Promise<{ pairId: string }> {
  // pairId is "contactA:contactB" (order-independent). Validate shape so a
  // malformed id cannot slip past as a NOT NULL violation at insert time.
  const parts = pairId.split(":");
  const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (parts.length !== 2 || !uuidRe.test(parts[0]!) || !uuidRe.test(parts[1]!)) {
    throw new HttpError(400, "INVALID_PAIR_ID", "pairId must be 'contactA:contactB' with two contact uuids");
  }
  const [contactA, contactB] = parts as [string, string];
  const canonical = pairIdOf(contactA, contactB);

  await db.transaction(async (tx) => {
    await tx
      .insert(dedupDismissals)
      .values({
        tenantId,
        pairId: canonical,
        contactA,
        contactB,
        reason: reason ?? null,
        dismissedBy: actorId,
      })
      .onConflictDoUpdate({
        target: [dedupDismissals.tenantId, dedupDismissals.pairId],
        set: { reason: reason ?? null, dismissedBy: actorId, dismissedAt: new Date() },
      });

    await enqueue(tx as Parameters<typeof enqueue>[0], {
      topic: AUDIT_TOPIC,
      eventType: AUDIT_TOPIC,
      tenantId,
      actorId,
      correlationId,
      payload: {
        service: "crm",
        action: "dedup_candidate_dismiss",
        resourceType: "dedup_dismissal",
        resourceId: canonical,
        outcome: "success",
        metadata: { contactA, contactB, hasReason: Boolean(reason) },
      },
    });
  });

  return { pairId: canonical };
}
