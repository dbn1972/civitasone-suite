/**
 * Collision-free meeting / resolution numbering (UAT F81, F82).
 *
 * The old allocator read MAX(existing sequence) for a (committee, FY) scope and formatted
 * `<code>/<FY>/<seq>`. That broke in two ways:
 *   - Committees without a `code` all fall back to the `MTG` (or `RES`) prefix, but the
 *     sequence was scoped per committee, so every code-less committee issued `MTG/<FY>/001`.
 *   - Two concurrent creates under one committee both read the same MAX and issued the same
 *     number. The UNIQUE index the code comments relied on never existed.
 *
 * Numbers are now allocated from a transactional counter in `meeting.number_sequences`, keyed
 * by (tenant, series, FY), through the shared gap-free allocator in `@civitasone/numbering`.
 * The series key is the formatted PREFIX itself (for example `meeting:MTG` or
 * `resolution:FC/RES`), not the committee id. Two numbers can only be equal if they share a
 * prefix and FY, so one counter per prefix makes them unique by construction, whatever the
 * committee codes are. All code-less committees deterministically share the tenant's `MTG`
 * (or `RES`) series.
 *
 * The first allocation in a series seeds the counter from the highest number already issued
 * with that prefix and FY, so numbering continues after existing (pre-fix) rows instead of
 * restarting at 001. Migration 0014 adds partial UNIQUE indexes on (tenant_id, meeting_number)
 * and (tenant_id, resolution_number) as the backstop.
 */
import { sql, type SQL } from "drizzle-orm";
import { allocateGaplessSeq, formatSequence, type GaplessSeqConfig, type SqlExecutor } from "@civitasone/numbering";
import { meetingNumberPrefix } from "../modules/meeting-core/domain.js";
import { resolutionNumberPrefix, LEGACY_CODELESS_RESOLUTION_PREFIX } from "../modules/decision/domain.js";

export const MEETING_SEQ_CONFIG: GaplessSeqConfig = {
  schema: "meeting",
  table: "number_sequences",
  tenantCol: "tenant_id",
  keyCol: "series_key",
  bucketCol: "bucket",
  valueCol: "current_value",
  updatedAtCol: "updated_at",
};

/** Width of the counter segment, unchanged from the legacy `001` layout. */
const COUNTER_WIDTH = 3;

/**
 * Seed the (tenant, series, FY) counter from the highest sequence already issued under any of
 * `prefixes` (each a full `<prefix>/<FY>/` string), if the counter row does not exist yet.
 * Concurrent seeders are safe: the loser's INSERT waits on the winner's PK and then does nothing.
 */
async function seedSeries(
  tx: SqlExecutor,
  args: { tenantId: string; seriesKey: string; bucket: string; existing: SQL },
): Promise<void> {
  await tx.execute(sql`
    INSERT INTO meeting.number_sequences (tenant_id, series_key, bucket, current_value)
    SELECT ${args.tenantId}::uuid, ${args.seriesKey}, ${args.bucket}, COALESCE(MAX(s.seq), 0)
    FROM (${args.existing}) s
    WHERE NOT EXISTS (
      SELECT 1 FROM meeting.number_sequences ns
      WHERE ns.tenant_id = ${args.tenantId}::uuid AND ns.series_key = ${args.seriesKey} AND ns.bucket = ${args.bucket}
    )
    ON CONFLICT (tenant_id, series_key, bucket) DO NOTHING
  `);
}

/** SELECT the numeric tail of every `column` value that starts with one of `prefixes`. */
function existingSequences(table: SQL, column: SQL, tenantId: string, prefixes: string[]): SQL {
  const parts = prefixes.map(
    (p) => sql`
      SELECT substr(${column}, ${p.length + 1})::bigint AS seq
      FROM ${table}
      WHERE tenant_id = ${tenantId}::uuid
        AND starts_with(${column}, ${p})
        AND substr(${column}, ${p.length + 1}) ~ '^[0-9]{1,18}$'`,
  );
  return sql.join(parts, sql` UNION ALL `);
}

async function allocate(
  tx: SqlExecutor,
  args: { tenantId: string; seriesKey: string; financialYear: string; existing: SQL },
): Promise<bigint> {
  await seedSeries(tx, { tenantId: args.tenantId, seriesKey: args.seriesKey, bucket: args.financialYear, existing: args.existing });
  return allocateGaplessSeq(tx, MEETING_SEQ_CONFIG, args.tenantId, args.seriesKey, args.financialYear);
}

/** Allocate the next meeting number, e.g. `FC/2026-27/004` or `MTG/2026-27/012`, inside `tx`. */
export async function allocateMeetingNumber(
  tx: SqlExecutor,
  args: { tenantId: string; committeeCode: string | null; financialYear: string },
): Promise<string> {
  const prefix = meetingNumberPrefix(args.committeeCode);
  const head = `${prefix}/${args.financialYear}/`;
  const seq = await allocate(tx, {
    tenantId: args.tenantId,
    seriesKey: `meeting:${prefix}`,
    financialYear: args.financialYear,
    existing: existingSequences(sql`meeting.meetings`, sql`meeting_number`, args.tenantId, [head]),
  });
  return `${head}${formatSequence(seq, COUNTER_WIDTH)}`;
}

/** Allocate the next resolution number, e.g. `FC/RES/2026-27/004` or `RES/2026-27/002`, inside `tx`. */
export async function allocateResolutionNumber(
  tx: SqlExecutor,
  args: { tenantId: string; committeeCode: string | null; financialYear: string },
): Promise<string> {
  const prefix = resolutionNumberPrefix(args.committeeCode);
  const head = `${prefix}/${args.financialYear}/`;
  // Code-less resolutions used to be issued as `RES/RES/<FY>/<seq>`; continue after them.
  const heads = prefix === "RES" ? [head, `${LEGACY_CODELESS_RESOLUTION_PREFIX}/${args.financialYear}/`] : [head];
  const seq = await allocate(tx, {
    tenantId: args.tenantId,
    seriesKey: `resolution:${prefix}`,
    financialYear: args.financialYear,
    existing: existingSequences(sql`meeting.resolutions`, sql`resolution_number`, args.tenantId, heads),
  });
  return `${head}${formatSequence(seq, COUNTER_WIDTH)}`;
}
