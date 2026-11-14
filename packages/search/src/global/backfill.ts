/**
 * Per-tenant backfill / reindex: dry run by default, capped, resumable.
 *
 * A service supplies `fetchPage` (keyset on the primary key, tenant-scoped, ascending) and `toRecord` (row -> contract
 * record, or null to skip). The runner pages until the cap or the end, writes through `sink` (null = dry run), and
 * returns `lastId`, which is passed back as `afterId` to resume. Re-running is safe: the sink upserts by document id.
 */
import { buildGlobalDocument, type GlobalSearchDocument, type GlobalSearchRecordInput, UUID_RE } from "./contract.js";

export interface BackfillSource<Row> {
  tenantId: string;
  /** Rows with id > afterId, ascending by id, at most `size`. */
  fetchPage: (afterId: string | null, size: number) => Promise<Row[]>;
  idOf: (row: Row) => string;
  toRecord: (row: Row) => GlobalSearchRecordInput | null;
}

export interface BackfillOptions {
  /** null => dry run: everything is read and validated, nothing is written. */
  sink: ((docs: GlobalSearchDocument[]) => Promise<void>) | null;
  pageSize?: number;
  /** Hard cap on rows scanned in this run. */
  maxRecords?: number;
  afterId?: string | null;
}

export interface BackfillResult {
  dryRun: boolean;
  scanned: number;
  indexed: number;
  skipped: number;
  redactions: number;
  /** Pass as --after to continue. Null when nothing was read. */
  lastId: string | null;
  /** True when the end of the data was reached (not merely the cap). */
  done: boolean;
}

export async function runBackfill<Row>(src: BackfillSource<Row>, opts: BackfillOptions): Promise<BackfillResult> {
  if (!UUID_RE.test(src.tenantId)) throw new Error("tenantId must be a UUID");
  const pageSize = Math.min(1000, Math.max(1, opts.pageSize ?? 500));
  const cap = Math.max(1, opts.maxRecords ?? 5000);
  let afterId = opts.afterId ?? null;
  const res: BackfillResult = { dryRun: opts.sink === null, scanned: 0, indexed: 0, skipped: 0, redactions: 0, lastId: afterId, done: false };

  while (res.scanned < cap) {
    const want = Math.min(pageSize, cap - res.scanned);
    const rows = await src.fetchPage(afterId, want);
    if (rows.length === 0) {
      res.done = true;
      break;
    }
    const docs: GlobalSearchDocument[] = [];
    for (const row of rows) {
      res.scanned += 1;
      const rec = src.toRecord(row);
      if (!rec || rec.tenantId !== src.tenantId) {
        res.skipped += 1; // also drops any row that does not belong to the requested tenant
        continue;
      }
      const built = buildGlobalDocument(rec);
      res.redactions += built.redactions;
      docs.push(built.doc);
    }
    if (opts.sink && docs.length) await opts.sink(docs);
    res.indexed += docs.length;
    afterId = src.idOf(rows[rows.length - 1]!);
    res.lastId = afterId;
    if (rows.length < want) {
      res.done = true;
      break;
    }
  }
  return res;
}

export interface BackfillArgs {
  tenantId: string;
  apply: boolean;
  limit: number;
  after: string | null;
  purge: boolean;
  /** Restrict to one entity type (required with --after, since a cursor belongs to one type). */
  only: string | null;
}

/** `--tenant <uuid> [--apply] [--limit N] [--after <uuid> --only <type>] [--purge]`. Dry run unless --apply. */
export function parseBackfillArgs(argv: string[]): BackfillArgs {
  const a = argv.filter((x) => x !== "--");
  const get = (name: string): string | undefined => {
    const i = a.indexOf(name);
    return i >= 0 ? a[i + 1] : undefined;
  };
  const tenantId = (get("--tenant") ?? "").toLowerCase();
  if (!UUID_RE.test(tenantId)) throw new Error("--tenant <uuid> is required");
  const after = get("--after") ?? null;
  if (after !== null && !UUID_RE.test(after)) throw new Error("--after must be a UUID");
  const limitRaw = get("--limit");
  const limit = limitRaw === undefined ? 5000 : Number(limitRaw);
  if (!Number.isInteger(limit) || limit < 1 || limit > 1_000_000) throw new Error("--limit must be an integer 1..1000000");
  const only = get("--only") ?? null;
  if (after !== null && only === null) throw new Error("--after needs --only <entityType>: a cursor belongs to one entity type");
  return { tenantId, apply: a.includes("--apply"), limit, after, purge: a.includes("--purge"), only };
}
