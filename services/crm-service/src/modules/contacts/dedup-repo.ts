/**
 * Persistence for configurable dedup rules + candidate fetch (DQ-001).
 */
import { eq, and, sql } from "drizzle-orm";
import { db, scopedRead } from "../../shared/db.js";
import { dedupRules, type DedupRuleRow } from "./dedup-schema.js";
import { contacts } from "./schema.js";
import { DEFAULT_DEDUP_RULES, type DedupRule, type DedupCandidate, type DedupField } from "./dedup-domain.js";

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
 */
export async function upsertRules(
  tenantId: string,
  rules: RuleUpsert[],
  actorId: string,
): Promise<DedupRule[]> {
  await db.transaction(async (tx) => {
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
  });
  return getRules(tenantId, actorId);
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
