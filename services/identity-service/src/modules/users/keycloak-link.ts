/**
 * FQ14: the identity user <-> Keycloak user mapping (users.users.keycloak_user_id).
 *
 * Every service sees a login as its JWT `sub` (the Keycloak user id), but
 * users.users.id is identity-service's own id. Storing the Keycloak id on the
 * identity row lets the internal user lookups resolve a sub tenant-scoped,
 * without a Keycloak round-trip. Written from three places: the createUser
 * consumer after provisioning, the admin keycloak-reconcile route, and the
 * one-off backfill below for users that existed before migration 0033.
 */
import { and, eq, isNull, asc, gt, count, sql } from "drizzle-orm";
import { runWithTenant } from "@civitasone/db";
import { db, scopedRead } from "../../shared/db.js";

type ScopedTx = Parameters<Parameters<typeof scopedRead>[0]>[0];
import { users } from "./schema.js";
import * as keycloak from "../../shared/keycloak.js";

export type PersistOutcome = "linked" | "unchanged" | "conflict" | "not_found";

function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: string; cause?: { code?: string } };
  return e?.code === "23505" || e?.cause?.code === "23505";
}

/**
 * Record `kcUserId` as user `userId`'s Keycloak id. Never overwrites a
 * DIFFERENT existing mapping (that needs a human: "conflict"), and a Keycloak
 * id already mapped to another identity user is a "conflict" too (unique index).
 */
export async function persistKeycloakUserId(tenantId: string, userId: string, kcUserId: string): Promise<PersistOutcome> {
  try {
    return await runWithTenant(tenantId, () => db.transaction(async (tx) => {
      const rows = await tx.select({ kc: users.keycloakUserId }).from(users)
        .where(and(eq(users.id, userId), eq(users.tenantId, tenantId)))
        .for("update")
        .limit(1);
      if (!rows[0]) return "not_found" as const;
      if (rows[0].kc === kcUserId) return "unchanged" as const;
      if (rows[0].kc) return "conflict" as const;
      await tx.update(users).set({ keycloakUserId: kcUserId, updatedAt: new Date() })
        .where(and(eq(users.id, userId), eq(users.tenantId, tenantId)));
      return "linked" as const;
    }));
  } catch (err) {
    if (isUniqueViolation(err)) return "conflict";
    throw err;
  }
}

export type BackfillReport = {
  tenantId: string;
  apply: boolean;
  /**
   * FQ16: users of this tenant visible to the backfill, mapped or not. 0 means
   * nothing was readable for the tenant (no users, or a wrong tenant id), so an
   * empty scan is never mistaken for "everyone is already linked".
   */
  tenantUsers: number;
  scanned: number;
  linked: number;
  wouldLink: number;
  unmatched: string[];
  /** realm user found but without a `tid` equal to this tenant: never mapped. */
  tidMissing: string[];
  conflicts: string[];
  errors: string[];
};

/**
 * One-off backfill for users created before keycloak_user_id existed. For
 * every user of ONE tenant with no mapping, find its realm user (by the
 * tenant-namespaced username, else by the identity_user_id attribute; both
 * tenant-checked in keycloak.ts) and, with apply, store the mapping. Dry run
 * by default. Reads Keycloak only; never creates or changes a realm user.
 */
export async function backfillKeycloakUserIds(opts: { tenantId: string; apply: boolean; pageSize?: number }): Promise<BackfillReport> {
  const { tenantId, apply } = opts;
  const pageSize = opts.pageSize ?? 200;
  const report: BackfillReport = { tenantId, apply, tenantUsers: 0, scanned: 0, linked: 0, wouldLink: 0, unmatched: [], tidMissing: [], conflicts: [], errors: [] };

  // FQ16: users.users is FORCE RLS and the service role is NOBYPASSRLS, so a
  // read only sees rows when app.tenant_id is set on its transaction. The db
  // wrapper sets it from AsyncLocalStorage, which nothing populates in a CLI
  // (no request hook), so every read returned zero rows and the backfill
  // reported `scanned: 0` as success. Run each read in this tenant's context
  // and check the GUC really is set, so a missing context fails loudly.
  const readAsTenant = <T>(fn: (tx: ScopedTx) => Promise<T>): Promise<T> =>
    Promise.resolve(runWithTenant(tenantId, () => scopedRead(async (tx) => {
      const guc = await tx.execute<{ tid: string | null }>(sql`SELECT current_setting('app.tenant_id', true) AS tid`);
      const tid = guc[0]?.tid ?? null;
      if (tid !== tenantId) {
        throw new Error(`tenant context not applied to the users read (app.tenant_id=${tid ?? "unset"}); refusing to report an empty scan`);
      }
      return fn(tx);
    })));

  const total = await readAsTenant((tx) => tx.select({ n: count() }).from(users).where(eq(users.tenantId, tenantId)));
  report.tenantUsers = Number(total[0]?.n ?? 0);

  let after: string | null = null;
  for (;;) {
    const cursor: string | null = after;
    const page: Array<{ id: string; email: string }> = await readAsTenant((tx) => tx.select({ id: users.id, email: users.email }).from(users)
      .where(and(
        eq(users.tenantId, tenantId),
        isNull(users.keycloakUserId),
        ...(cursor ? [gt(users.id, cursor)] : []),
      ))
      .orderBy(asc(users.id))
      .limit(pageSize));
    if (page.length === 0) break;
    for (const u of page) {
      report.scanned++;
      const r = await keycloak.lookupUserId({ tenantId, email: u.email, identityUserId: u.id });
      if (!r.ok) { report.errors.push(u.id); continue; }
      if (r.skipped) throw new Error("keycloak admin creds not configured; nothing to backfill from");
      if (r.reason?.startsWith("tid_missing")) { report.tidMissing.push(u.id); continue; }
      if (!r.kcUserId || !r.tenantVerified) { report.unmatched.push(u.id); continue; }
      if (!apply) { report.wouldLink++; continue; }
      const outcome = await persistKeycloakUserId(tenantId, u.id, r.kcUserId);
      if (outcome === "linked") report.linked++;
      else if (outcome === "conflict") report.conflicts.push(u.id);
    }
    after = page[page.length - 1]!.id;
  }
  return report;
}

