/**
 * identity/name-key-repo.ts — CR-CDP-02 candidate retrieval for phonetic name matching.
 *
 * Retrieval only. Scoring lives in phonetic-domain.ts so it stays reproducible in a unit
 * test; this file's whole job is to hand the scorer a *bounded* candidate window instead
 * of the tenant's entire profile table.
 *
 * The window is the union of two cheap index probes:
 *   phonetic_key = $key            — btree, catches transliteration variants exactly
 *   name_normalized % $normalized  — pg_trgm GIN, catches typos the coder misses
 */
import { eq, and, sql, desc } from "drizzle-orm";
import { scopedRead, type ScopedTx } from "../../shared/db.js";
import { profileNameKeys, type ProfileNameKeyRow, type ProfileNameKeyInsert } from "./schema.js";

export function toView(r: ProfileNameKeyRow) {
  return {
    id: r.id,
    tenantId: r.tenantId,
    profileId: r.profileId,
    phoneticKey: r.phoneticKey,
    updatedAt: r.updatedAt.toISOString(),
    version: r.version,
  };
}

export type NameKeyView = ReturnType<typeof toView>;

export async function findByProfile(profileId: string, tenantId: string): Promise<ProfileNameKeyRow | null> {
  const rows = await scopedRead((tx) =>
    tx.select().from(profileNameKeys)
      .where(and(eq(profileNameKeys.profileId, profileId), eq(profileNameKeys.tenantId, tenantId)))
      .limit(1),
  );
  return rows[0] ?? null;
}

/**
 * Insert or refresh the key for a profile. One key row per profile, so a renamed profile
 * updates in place rather than accumulating stale keys that would match forever.
 */
export async function upsert(tx: ScopedTx, row: ProfileNameKeyInsert): Promise<void> {
  await tx.insert(profileNameKeys).values(row).onConflictDoUpdate({
    target: [profileNameKeys.tenantId, profileNameKeys.profileId],
    set: {
      nameNormalized: row.nameNormalized,
      phoneticKey: row.phoneticKey,
      updatedAt: new Date(),
      updatedBy: row.updatedBy,
      version: sql`${profileNameKeys.version} + 1`,
    },
  });
}

export interface NameCandidate {
  profileId: string;
  name: string;
}

/**
 * Retrieve the candidate window for a normalized name + phonetic key.
 *
 * `limit` is applied in SQL: the caller re-ranks in the domain, but the number of rows
 * crossing the wire must not be a function of tenant size.
 */
export async function findCandidates(
  tenantId: string,
  phoneticKey: string,
  nameNormalized: string,
  limit: number,
): Promise<NameCandidate[]> {
  const rows = await scopedRead((tx) =>
    tx.select({ profileId: profileNameKeys.profileId, name: profileNameKeys.nameNormalized })
      .from(profileNameKeys)
      .where(and(
        eq(profileNameKeys.tenantId, tenantId),
        sql`(${profileNameKeys.phoneticKey} = ${phoneticKey} OR ${profileNameKeys.nameNormalized} % ${nameNormalized})`,
      ))
      .orderBy(desc(sql`similarity(${profileNameKeys.nameNormalized}, ${nameNormalized})`))
      .limit(limit),
  );
  return rows;
}

/**
 * Purge the key for a profile. Used by identity stitching: the anonymous shell's name key
 * must not keep matching after the shell has been absorbed, or the next lookup would
 * resurface a profile that no longer exists as a distinct person.
 */
export async function deleteByProfile(tx: ScopedTx, profileId: string, tenantId: string): Promise<number> {
  const result = await tx
    .delete(profileNameKeys)
    .where(and(eq(profileNameKeys.profileId, profileId), eq(profileNameKeys.tenantId, tenantId)))
    .returning({ id: profileNameKeys.id });
  return result.length;
}
