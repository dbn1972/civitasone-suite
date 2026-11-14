/**
 * Shared driver for the per-service `reindex:global-search` commands.
 *
 *   pnpm --filter @civitasone/<service> reindex:global-search -- --tenant <uuid>                 # DRY RUN (default)
 *   pnpm --filter @civitasone/<service> reindex:global-search -- --tenant <uuid> --apply         # write to the index
 *   ... --limit 2000 --only finance.bill --after <last id from the previous run>               # capped + resumable
 *   ... --tenant <uuid> --purge --apply                                                         # remove the tenant's slice
 *
 * A dry run reads and validates every row and reports counts (and personal-data redactions) but never contacts the
 * search engine. `--limit` is a per-entity-type cap for the run; the printed `lastId` is the next `--after`.
 * Rerunning is safe (upsert by document id). Run it BEFORE adding the tenant to GLOBAL_SEARCH_TENANTS.
 */
import { GLOBAL_ENTITY_TYPES, isGlobalEntityType, type GlobalEntityType } from "./catalogue.js";
import { GlobalSearchIndex } from "./global-index.js";
import { isGlobalSearchEnabled } from "./flag.js";
import { parseBackfillArgs, runBackfill, type BackfillResult, type BackfillSource } from "./backfill.js";

export interface BackfillEntity {
  entityType: GlobalEntityType;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  source: BackfillSource<any>;
}

export interface CliIO {
  out: (line: string) => void;
}

export async function runGlobalSearchCli(
  argv: string[],
  entitiesFor: (tenantId: string) => BackfillEntity[],
  io: CliIO = { out: (l) => process.stdout.write(`${l}\n`) },
  index: Pick<GlobalSearchIndex, "initialize" | "upsert" | "removeTenant" | "waitForTask"> = new GlobalSearchIndex(),
): Promise<BackfillResult[]> {
  const args = parseBackfillArgs(argv);
  if (args.only !== null && !isGlobalEntityType(args.only)) throw new Error(`--only: unknown entity type ${args.only}`);
  if (!isGlobalSearchEnabled(args.tenantId)) {
    io.out(`note: tenant ${args.tenantId} is not in GLOBAL_SEARCH_TENANTS; the index is not consulted for it until it is switched on`);
  }
  if (args.purge) {
    if (!args.apply) {
      io.out(`DRY RUN: would remove every global-search document of tenant ${args.tenantId} (add --apply)`);
      return [];
    }
    await index.initialize();
    await index.waitForTask(await index.removeTenant(args.tenantId));
    io.out(`purged tenant ${args.tenantId} from the global search index`);
    return [];
  }
  const entities = entitiesFor(args.tenantId).filter((e) => args.only === null || e.entityType === args.only);
  if (entities.length === 0) throw new Error(`this service has nothing to index for ${args.only ?? "this tenant"}`);
  if (args.apply) await index.initialize();
  const results: BackfillResult[] = [];
  for (const e of entities) {
    const r = await runBackfill(e.source, {
      sink: args.apply ? async (docs) => void (await index.waitForTask(await index.upsert(docs))) : null,
      maxRecords: args.limit,
      afterId: args.after,
    });
    results.push(r);
    io.out(
      `${r.dryRun ? "DRY RUN " : ""}${e.entityType} (${GLOBAL_ENTITY_TYPES[e.entityType].module}): scanned=${r.scanned} ` +
        `${r.dryRun ? "would-index" : "indexed"}=${r.indexed} skipped=${r.skipped} redactions=${r.redactions} ` +
        `${r.done ? "complete" : `INCOMPLETE (cap reached) resume: --only ${e.entityType} --after ${r.lastId}`}`,
    );
  }
  if (results.some((r) => r.dryRun)) io.out("dry run only: re-run with --apply to write");
  return results;
}
