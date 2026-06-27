/**
 * Tenant-scoped transaction helper (SAST-003 remediation).
 *
 * Sets the Postgres session GUC `app.tenant_id` for the duration of a
 * transaction so that ROW LEVEL SECURITY policies of the form
 *   tenant_id = current_setting('app.tenant_id')::uuid
 * are enforced as a defense-in-depth backstop behind the application-layer
 * `WHERE tenant_id = $1` clauses.
 *
 * SAFETY: `set_config(key, value, true)` sets the value **local to the current
 * transaction** (reverts on commit/rollback). It is harmless even when no RLS
 * policy reads the GUC — it simply sets a session variable. Therefore this can
 * be adopted incrementally, service by service, without breaking services that
 * have not yet enabled RLS enforcement on their connecting role.
 *
 * ROLLOUT (must be staged — do NOT flip fleet-wide blind):
 *   1. Confirm each service's DB login role is NOT a superuser and does NOT
 *      have the BYPASSRLS attribute (otherwise RLS is silently skipped).
 *      Verify with:  SELECT rolname, rolsuper, rolbypassrls FROM pg_roles;
 *   2. Ensure the FORCE ROW LEVEL SECURITY migrations are applied for the
 *      service's tables.
 *   3. Wrap tenant-scoped writes/reads in `withTenantScope(db, tenantId, tx => …)`.
 *   4. Add an integration test: a query WITHOUT the GUC set must be rejected on
 *      a FORCE-RLS table (proves the backstop is live).
 *
 * The application-layer tenant predicate (added in SAST-001) remains the
 * primary control; this GUC is the secondary backstop.
 */

/** Minimal shape of a drizzle/postgres-js db with `transaction` + `execute`. */
type TxRunner<TTx> = {
  transaction: <T>(fn: (tx: TTx) => Promise<T>) => Promise<T>;
};

const TENANT_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Run `fn` inside a transaction with `app.tenant_id` set to `tenantId` (local
 * to the transaction). The tenantId is validated as a UUID before use so it can
 * never be used to inject into the set_config call.
 */
export async function withTenantScope<TTx, T>(
  db: TxRunner<TTx> & { transaction: (fn: (tx: TTx) => Promise<T>) => Promise<T> },
  tenantId: string,
  fn: (tx: TTx) => Promise<T>,
): Promise<T> {
  if (!TENANT_ID_RE.test(tenantId)) {
    throw new Error(`withTenantScope: invalid tenantId (must be a UUID): ${tenantId}`);
  }
  return db.transaction(async (tx) => {
    // `tx` is a drizzle transaction; `execute` runs raw parameterised SQL.
    // set_config(..., true) => transaction-local; reverts automatically.
    const runner = tx as unknown as {
      execute: (q: unknown) => Promise<unknown>;
      // drizzle exposes the `sql` tag via the parent import in callers; we accept
      // a pre-built statement through the `setTenantGuc` helper instead.
    };
    await setTenantGuc(runner, tenantId);
    return fn(tx);
  });
}

/**
 * Execute the `set_config('app.tenant_id', <uuid>, true)` statement on a
 * transaction-like runner. Exposed separately so callers that already manage
 * their own transaction can set the GUC without re-wrapping.
 *
 * The caller must pass a runner whose `execute` accepts a drizzle `sql` tagged
 * template. We build the statement with a bound parameter (no string concat).
 */
export async function setTenantGuc(
  runner: { execute: (q: unknown) => Promise<unknown> },
  tenantId: string,
): Promise<void> {
  if (!TENANT_ID_RE.test(tenantId)) {
    throw new Error(`setTenantGuc: invalid tenantId (must be a UUID): ${tenantId}`);
  }
  // Lazy import keeps drizzle-orm an optional peer for this helper.
  const { sql } = await import("drizzle-orm");
  await runner.execute(sql`SELECT set_config('app.tenant_id', ${tenantId}, true)`);
}
