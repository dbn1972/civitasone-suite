/**
 * UAT F84: fail loudly when the bulk-scan scanner pool cannot bypass RLS.
 *
 * bulk_scan.* is FORCE ROW LEVEL SECURITY and document_svc is NOBYPASSRLS (admin-service 0058). If the scanner pool
 * authenticates as anything other than a BYPASSRLS role (the development / test fallback to DATABASE_URL, or a
 * mis-set DOCUMENT_SCANNER_DATABASE_URL), every cross-tenant discovery query sees zero rows and the dispatcher,
 * lease sweeper, upload expiry and retention silently do nothing. document-worker calls this once at start, before
 * starting those schedulers, so that misconfiguration is a startup error instead of a quiet no-op.
 */
/** Structural view of a postgres-js `sql` tag: only a parameterless tagged-template call is needed. */
export type ScannerRoleQuery = (strings: TemplateStringsArray, ...values: never[]) => PromiseLike<unknown>;

export async function assertScannerBypassesRls(sql: ScannerRoleQuery): Promise<string> {
  const rows = (await sql`select current_user::text as role, rolbypassrls from pg_roles where rolname = current_user`) as
    ReadonlyArray<{ role?: string; rolbypassrls?: boolean }>;
  const row = rows[0];
  if (!row || row.rolbypassrls !== true) {
    throw new Error(
      `document-worker: the bulk-scan scanner pool connects as '${row?.role ?? "unknown"}', which cannot bypass RLS, so ` +
        "cross-tenant discovery (dispatcher, lease sweeper, upload expiry, retention) would find no work. Set " +
        "DOCUMENT_SCANNER_DATABASE_URL to the BYPASSRLS document_scanner role (document-service migration 0007). Refusing to start.",
    );
  }
  return row.role ?? "";
}
