/**
 * One-off command: re-index existing knowledge documents into the search engine
 * with their accessLevel populated (needed once after the accessLevel facet is
 * introduced; engine initialize() registers the facet itself).
 *
 *   pnpm --filter @civitasone/knowledge-service reindex:search -- <tenantId> [<tenantId> ...]
 *
 * Needs the service DB env (DATABASE_URL) and the search engine env
 * (SEARCH_ENGINE and its host settings). Safe to re-run.
 */
import { createSearchEngine } from "@civitasone/search";
import { sqlClient } from "./shared/db.js";
import { reindexTenant } from "./modules/search/reindex.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function main(): Promise<void> {
  const tenants = process.argv.slice(2).filter((a) => a !== "--");
  if (tenants.length === 0 || tenants.some((t) => !UUID_RE.test(t))) {
    process.stderr.write("usage: reindex:search -- <tenantId> [<tenantId> ...]   (tenant ids must be UUIDs)\n");
    process.exitCode = 2;
    return;
  }
  const engine = createSearchEngine();
  await engine.initialize({ indexName: "knowledge_documents" });
  for (const tenantId of tenants) {
    const n = await reindexTenant(engine, tenantId);
    process.stdout.write(`tenant ${tenantId}: re-indexed ${n} document(s)\n`);
  }
  await engine.close();
}

main()
  .catch((err) => { process.stderr.write(`${err instanceof Error ? err.stack : String(err)}\n`); process.exitCode = 1; })
  .finally(() => sqlClient.end());
