import { eq, and, sql, gte, desc } from "drizzle-orm";
import { db, scopedRead } from "../../shared/db.js";
import { publicEstablishments, otpChallenges } from "./schema.js";
import { cases } from "../case-registry/schema.js";

/** Narrow write surface accepted for the transactional (consumer) path. */
export type Writer = Pick<typeof db, "insert" | "update" | "select">;

export type PublicEstablishmentRow    = typeof publicEstablishments.$inferSelect;
export type PublicEstablishmentInsert = typeof publicEstablishments.$inferInsert;
export type OtpChallengeRow    = typeof otpChallenges.$inferSelect;
export type OtpChallengeInsert = typeof otpChallenges.$inferInsert;

/**
 * IMPORTANT — why these reads use PLAIN db.select() (NOT scopedRead):
 *   public_establishments and otp_challenges have NO row-level security (they are
 *   pre-auth / cross-tenant registries — see the migration header). They are read
 *   BEFORE a tenant is known, so there is no `app.tenant_id` GUC to set. Wrapping them
 *   in scopedRead would be pointless (no RLS to satisfy) and, worse, misleading. Only
 *   the DOWNSTREAM case read (`getPublicCaseByCnr`), which hits the RLS-protected
 *   court.cases, uses scopedRead — and its CALLER wraps it in runWithTenant(resolvedTenant).
 */

// ─── Establishment directory (no RLS) ───────────────────────────────────────────

/** Idempotent insert on the deterministic id: a redelivery with the same id is a no-op. */
export async function insertEstablishment(tx: Writer, row: PublicEstablishmentInsert): Promise<void> {
  await tx.insert(publicEstablishments).values(row).onConflictDoNothing({ target: publicEstablishments.id });
}

/**
 * Public directory listing. Projects ONLY the caller-safe columns — tenant_id is
 * NEVER exposed. Active establishments only.
 */
export async function listActiveEstablishments(): Promise<
  { courtName: string; publicSlug: string; establishmentCode: string }[]
> {
  return db
    .select({
      courtName:         publicEstablishments.courtName,
      publicSlug:        publicEstablishments.publicSlug,
      establishmentCode: publicEstablishments.establishmentCode,
    })
    .from(publicEstablishments)
    .where(eq(publicEstablishments.active, true))
    .orderBy(publicEstablishments.courtName);
}

/** Resolve a tenant from a CNR prefix. Returns the first active match (or undefined). */
export async function findEstablishmentByPrefix(
  prefix: string,
): Promise<{ tenantId: string; establishmentCode: string } | undefined> {
  const rows = await db
    .select({ tenantId: publicEstablishments.tenantId, establishmentCode: publicEstablishments.establishmentCode })
    .from(publicEstablishments)
    .where(and(eq(publicEstablishments.cnrPrefix, prefix), eq(publicEstablishments.active, true)))
    .limit(1);
  return rows[0];
}

/** Resolve a tenant from a public slug. Returns the first active match (or undefined). */
export async function findEstablishmentBySlug(
  slug: string,
): Promise<{ tenantId: string; establishmentCode: string } | undefined> {
  const rows = await db
    .select({ tenantId: publicEstablishments.tenantId, establishmentCode: publicEstablishments.establishmentCode })
    .from(publicEstablishments)
    .where(and(eq(publicEstablishments.publicSlug, slug), eq(publicEstablishments.active, true)))
    .limit(1);
  return rows[0];
}

// ─── OTP challenges (no RLS, keyed on mobile hash) ──────────────────────────────

export async function insertChallenge(tx: Writer, row: OtpChallengeInsert): Promise<void> {
  await tx.insert(otpChallenges).values(row).onConflictDoNothing({ target: otpChallenges.id });
}

export async function getChallenge(id: string): Promise<OtpChallengeRow | undefined> {
  const rows = await db.select().from(otpChallenges).where(eq(otpChallenges.id, id)).limit(1);
  return rows[0];
}

/** Bump the attempt counter for a failed verification (attempt-cap enforcement). */
export async function incrementChallengeAttempt(id: string): Promise<void> {
  await db
    .update(otpChallenges)
    .set({ attempts: sql`${otpChallenges.attempts} + 1` })
    .where(eq(otpChallenges.id, id));
}

/** Mark a challenge single-use consumed (only if not already consumed). */
export async function consumeChallenge(id: string): Promise<void> {
  await db
    .update(otpChallenges)
    .set({ consumedAt: new Date() })
    .where(and(eq(otpChallenges.id, id), sql`${otpChallenges.consumedAt} IS NULL`));
}

/** Count challenges created for a mobile hash since `sinceIso` (per-mobile rate limit). */
export async function countRecentChallenges(mobileHash: string, sinceIso: string): Promise<number> {
  const rows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(otpChallenges)
    .where(and(eq(otpChallenges.mobileHash, mobileHash), gte(otpChallenges.createdAt, new Date(sinceIso))));
  return rows[0]?.count ?? 0;
}

// ─── Tenant-scoped PUBLIC case read (court.cases HAS RLS) ────────────────────────

/**
 * Read a case by CNR, RETURNING ONLY the public-safe columns. court.cases is
 * RLS-protected, so this MUST run under the tenant GUC: it uses `scopedRead` (which
 * sets the GUC from AsyncLocalStorage), and the CALLER wraps the whole thing in
 * `runWithTenant(resolvedTenantId, () => getPublicCaseByCnr(...))`. The tenant_id
 * predicate is defence-in-depth on top of RLS. Never selects party/PII columns.
 */
export async function getPublicCaseByCnr(
  tenantId: string,
  cnr: string,
): Promise<{
  cnrNumber: string;
  caseType: string | null;
  title: string | null;
  status: string;
  stage: string | null;
  filingDate: string | null;
  disposalDate: string | null;
} | undefined> {
  const rows = await scopedRead<Array<{ cnrNumber: string; caseType: string | null; title: string | null; status: string; stage: string | null; filingDate: string | null; disposalDate: string | null }>>((tx: any) =>
    tx
      .select({
        cnrNumber:    cases.cnrNumber,
        caseType:     cases.caseType,
        title:        cases.title,
        status:       cases.status,
        stage:        cases.stage,
        filingDate:   cases.filingDate,
        disposalDate: cases.disposalDate,
      })
      .from(cases)
      .where(and(eq(cases.tenantId, tenantId), eq(cases.cnrNumber, cnr)))
      .limit(1),
  );
  return rows[0];
}

/**
 * Directory-scoped variant: read the most recent public case by CNR within a resolved
 * tenant. NOTE: court.cases has NO decomposed case-number/year columns — the CNR is the
 * key — so a case-number+year lookup is NOT feasible with real columns. This helper
 * therefore supports the (slug-resolved tenant + CNR) path only, matching on cnr_number.
 * (See the module report for the integrator.)
 */
export async function getPublicCaseByNumber(
  tenantId: string,
  cnr: string,
): Promise<{
  cnrNumber: string;
  caseType: string | null;
  title: string | null;
  status: string;
  stage: string | null;
  filingDate: string | null;
  disposalDate: string | null;
} | undefined> {
  const rows = await scopedRead<Array<{ cnrNumber: string; caseType: string | null; title: string | null; status: string; stage: string | null; filingDate: string | null; disposalDate: string | null }>>((tx: any) =>
    tx
      .select({
        cnrNumber:    cases.cnrNumber,
        caseType:     cases.caseType,
        title:        cases.title,
        status:       cases.status,
        stage:        cases.stage,
        filingDate:   cases.filingDate,
        disposalDate: cases.disposalDate,
      })
      .from(cases)
      .where(and(eq(cases.tenantId, tenantId), eq(cases.cnrNumber, cnr)))
      .orderBy(desc(cases.filingDate))
      .limit(1),
  );
  return rows[0];
}
