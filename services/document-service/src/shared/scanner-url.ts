/**
 * DSN resolution for the bulk-scan cross-tenant scanner pool (pure, testable).
 *
 * The scanner pool MUST authenticate as the BYPASSRLS document_scanner role. Falling back to DATABASE_URL (the RLS-bound
 * service role) makes every discovery query see zero rows: the dispatcher, lease sweeper, upload expiry and retention would
 * silently do nothing. So outside an explicit development / test environment a missing (or service-role) scanner DSN is a
 * startup error. Allowlist, not a production blocklist: an unset NODE_ENV fails too.
 */
export function resolveScannerUrl(env: NodeJS.ProcessEnv): string {
  const scanner = env.DOCUMENT_SCANNER_DATABASE_URL;
  const devOrTest = ["development", "test"].includes(env.NODE_ENV ?? "");
  if (!scanner) {
    if (devOrTest && env.DATABASE_URL) return env.DATABASE_URL;        // dev / test: the service role is RLS-inert there
    throw new Error("DOCUMENT_SCANNER_DATABASE_URL is required for the bulk-scan scanner pool (must point at the document_scanner role; no fallback to DATABASE_URL outside development/test)");
  }
  if (!devOrTest && scanner === env.DATABASE_URL) {
    throw new Error("DOCUMENT_SCANNER_DATABASE_URL must differ from DATABASE_URL (the scanner pool needs the document_scanner BYPASSRLS role)");
  }
  return scanner;
}
