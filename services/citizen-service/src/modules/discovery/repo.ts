import { eq, and, desc } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { eligibilityRuleSets } from "../eligibility/schema.js";
import {
  discoveryConsents, discoveryMatches,
  type ConsentRow, type ConsentInsert, type MatchRow, type MatchInsert,
} from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

export async function findActiveConsentTx(tx: Writer, tenantId: string, citizenId: string, scope: string): Promise<ConsentRow | null> {
  const rows = await (tx as typeof db).select().from(discoveryConsents)
    .where(and(
      eq(discoveryConsents.tenantId, tenantId),
      eq(discoveryConsents.citizenId, citizenId),
      eq(discoveryConsents.scope, scope),
    ))
    .orderBy(desc(discoveryConsents.createdAt)).limit(1);
  return rows[0] ?? null;
}

export async function findActiveConsent(tenantId: string, citizenId: string, scope: string): Promise<ConsentRow | null> {
  return db.transaction((tx) => findActiveConsentTx(tx, tenantId, citizenId, scope));
}

export async function insertConsent(tx: Writer, row: ConsentInsert): Promise<void> {
  await tx.insert(discoveryConsents).values(row);
}

export async function updateConsent(tx: Writer, id: string, tenantId: string, patch: Partial<ConsentInsert>): Promise<void> {
  await tx.update(discoveryConsents).set({ ...patch, updatedAt: new Date() })
    .where(and(eq(discoveryConsents.id, id), eq(discoveryConsents.tenantId, tenantId)));
}

/** All published rule sets for the tenant — the candidate pool for discovery. */
export async function listPublishedRuleSets(tx: Writer, tenantId: string, limit = 500) {
  return (tx as typeof db).select().from(eligibilityRuleSets)
    .where(and(eq(eligibilityRuleSets.tenantId, tenantId), eq(eligibilityRuleSets.status, "published")))
    .orderBy(desc(eligibilityRuleSets.version)).limit(limit);
}

export async function insertMatch(tx: Writer, row: MatchInsert): Promise<void> {
  await tx.insert(discoveryMatches).values(row);
}

export async function findMatchByIdTx(tx: Writer, id: string, tenantId: string): Promise<MatchRow | null> {
  const rows = await (tx as typeof db).select().from(discoveryMatches)
    .where(and(eq(discoveryMatches.id, id), eq(discoveryMatches.tenantId, tenantId))).limit(1);
  return rows[0] ?? null;
}

export async function updateMatch(tx: Writer, id: string, tenantId: string, patch: Partial<MatchInsert>): Promise<void> {
  await tx.update(discoveryMatches).set({ ...patch, updatedAt: new Date() })
    .where(and(eq(discoveryMatches.id, id), eq(discoveryMatches.tenantId, tenantId)));
}

export async function listMatchesByCitizen(tenantId: string, citizenId: string, limit = 200): Promise<MatchRow[]> {
  return db.transaction((tx) => tx.select().from(discoveryMatches)
    .where(and(eq(discoveryMatches.tenantId, tenantId), eq(discoveryMatches.citizenId, citizenId)))
    .orderBy(desc(discoveryMatches.createdAt)).limit(limit));
}
