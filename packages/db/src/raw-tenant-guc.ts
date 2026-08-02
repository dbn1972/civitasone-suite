/**
 * Tenant GUC helper for raw `postgres.Sql` template-literal queries.
 *
 * `wrapWithTenantGuc` / `withTenantScope` only ever intercept Drizzle's
 * `db.transaction()`, because that is the single call site both wrap. A route
 * or query module that talks to `sqlClient` directly — no Drizzle schema
 * attached, so there is no `db.transaction()` to intercept — never gets
 * `app.tenant_id` set at all.
 *
 * That gap is not cosmetic: every RLS-forced table those queries touch fails
 * CLOSED for a non-superuser connection role, so the query returns success
 * with zero/empty rows — never an error. `services/helpdesk-service`'s
 * sla-engine module shipped exactly this shape for four endpoints and none of
 * them ever worked in production; nothing failed loudly because nothing was
 * *supposed* to fail. A fleet grep for the same shape (raw `sqlClient`
 * template literal, querying a FORCE-RLS table, no `db.transaction()` /
 * `withTenantGuc` / `sqlClient.begin()` / `runWithTenant()` anywhere in the
 * file) found the same defect in crm-service, estab-service, hrms-service and
 * payroll-service.
 *
 * Use this wherever a module has no Drizzle schema to attach `db.transaction()`
 * to but still queries RLS-protected tables via raw `sqlClient`.
 */
import type postgres from "postgres";

const TENANT_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Run `fn` inside a real transaction (`sqlClient.begin()`) with
 * `app.tenant_id` set LOCAL to it as the first statement — the same
 * per-transaction scoping `wrapWithTenantGuc` gives Drizzle's
 * `db.transaction()`, so the GUC is cleared automatically on commit/rollback
 * and never leaks onto a pooled connection reused by the next request.
 *
 * `tenantId` is validated as a UUID before use so it can never be used to
 * inject into the `set_config` call (it is passed as a bound parameter
 * regardless, but the check fails fast on a caller bug rather than sending a
 * malformed GUC value to Postgres).
 */
export async function withRawTenantGuc<TSql extends postgres.Sql<any>, T>(
  sqlClient: TSql,
  tenantId: string,
  fn: (tx: TSql) => Promise<T>,
): Promise<T> {
  if (!TENANT_ID_RE.test(tenantId)) {
    throw new Error(`withRawTenantGuc: invalid tenantId (must be a UUID): ${tenantId}`);
  }
  return (await sqlClient.begin(async (tx) => {
    await tx`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
    return fn(tx as unknown as TSql);
  })) as T;
}
