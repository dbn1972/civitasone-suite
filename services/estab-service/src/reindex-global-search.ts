/**
 * Per-tenant backfill / reindex of estab records into cross-module search.
 * Dry run by default; capped and resumable. See @civitasone/search runGlobalSearchCli for the flags.
 *
 *   pnpm --filter @civitasone/estab-service reindex:global-search -- --tenant <uuid> [--apply] [--limit N] [--only <type> --after <id>]
 *
 * Needs the service DB env (DATABASE_URL) and, with --apply, MEILISEARCH_HOST / MEILISEARCH_API_KEY.
 */
import { withTenantScope } from "@civitasone/db";
import { runGlobalSearchCli } from "@civitasone/search";
import { db, sqlClient } from "./shared/db.js";
import { backfillEntities } from "./shared/global-search.js";

runGlobalSearchCli(process.argv.slice(2), (tenantId) =>
  backfillEntities(tenantId, ((fn: (tx: never) => Promise<unknown>) => withTenantScope(db, tenantId, (tx) => fn(tx as never))) as never),
)
  .catch((err) => { process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`); process.exitCode = 1; })
  .finally(() => sqlClient.end());
