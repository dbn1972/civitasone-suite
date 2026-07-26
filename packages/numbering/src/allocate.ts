/**
 * Gapless, transaction-safe sequence allocation.
 *
 * The single atomic statement `INSERT ... ON CONFLICT DO UPDATE ... RETURNING`
 * takes a row lock on the (tenant, key, bucket) counter row, so concurrent
 * allocations serialise: each sees the prior committed value and returns the
 * next one. A rolled-back transaction releases the lock WITHOUT consuming the
 * number (the increment rolls back with it) — no gaps, no duplicates.
 *
 * The statement is built with `sql.identifier` for every table/column name, so
 * the same primitive drives ANY counter table (this service's
 * `metadata.number_sequences`, procurement's `procurement.doc_counters`, ...)
 * by config alone rather than copy-pasted SQL per service.
 */
import { sql, type SQL, type SQLWrapper } from "drizzle-orm";
import { type NumberFormatSpec } from "./spec.js";
import { formatReference, resetBucket, type FormatOptions } from "./format.js";

/** Minimal drizzle-transaction shape needed to run the allocation statement. */
export interface SqlExecutor {
  execute(query: SQL): Promise<unknown>;
}

/**
 * Physical layout of a counter table. `tenantCol`/`keyCol`/`bucketCol` together
 * must form the table's PRIMARY KEY / UNIQUE constraint (the ON CONFLICT target).
 */
export interface GaplessSeqConfig {
  schema: string;
  table: string;
  tenantCol?: string; // default "tenant_id"
  keyCol: string;     // e.g. "format_key" or "doc_type"
  bucketCol: string;  // e.g. "bucket" or "period"
  valueCol: string;   // e.g. "current_value" or "last_seq"
}

const IDENT_RE = /^[a-z_][a-z0-9_]*$/i;

function ident(name: string): SQLWrapper {
  if (!IDENT_RE.test(name)) throw new Error(`unsafe SQL identifier: ${JSON.stringify(name)}`);
  return sql.identifier(name);
}

/**
 * Allocate the next gapless value for (tenantId, key, bucket) inside the
 * caller's transaction. Returns a positive `bigint` starting at 1n.
 */
export async function allocateGaplessSeq(
  tx: SqlExecutor,
  cfg: GaplessSeqConfig,
  tenantId: string,
  key: string,
  bucket: string,
): Promise<bigint> {
  const tenantCol = ident(cfg.tenantCol ?? "tenant_id");
  const keyCol = ident(cfg.keyCol);
  const bucketCol = ident(cfg.bucketCol);
  const valueCol = ident(cfg.valueCol);
  const schema = ident(cfg.schema);
  const table = ident(cfg.table);

  const query = sql`
    INSERT INTO ${schema}.${table} (${tenantCol}, ${keyCol}, ${bucketCol}, ${valueCol})
    VALUES (${tenantId}::uuid, ${key}, ${bucket}, 1)
    ON CONFLICT (${tenantCol}, ${keyCol}, ${bucketCol})
    DO UPDATE SET ${valueCol} = ${schema}.${table}.${valueCol} + 1
    RETURNING ${valueCol} AS value
  `;
  const res = await tx.execute(query);
  const rows = (Array.isArray(res) ? res : (res as { rows?: unknown[] }).rows ?? []) as Array<{ value: string | number | bigint }>;
  const raw = rows[0]?.value;
  if (raw === undefined || raw === null) throw new Error("allocateGaplessSeq: no value returned");
  return BigInt(raw);
}

export interface AllocateReferenceParams {
  spec: NumberFormatSpec;
  seqConfig: GaplessSeqConfig;
  /** Logical format key, e.g. "procurement.po" — the counter partition. */
  formatKey: string;
  tenantId: string;
  /** Timestamp the number is minted for (drives FY / reset bucket). */
  at?: Date;
  /** Optional override forwarded to the formatter (legacy layouts). */
  segments?: string[];
}

export interface AllocatedReference {
  reference: string;
  sequence: bigint;
  bucket: string;
}

/**
 * High-level allocate: derive the reset bucket from the spec, allocate the next
 * gapless counter, and format the reference string — all inside `tx`.
 */
export async function allocateReference(
  tx: SqlExecutor,
  params: AllocateReferenceParams,
): Promise<AllocatedReference> {
  const at = params.at ?? new Date();
  const bucket = resetBucket(params.spec, at);
  const sequence = await allocateGaplessSeq(tx, params.seqConfig, params.tenantId, params.formatKey, bucket);
  const opts: FormatOptions = { at };
  if (params.segments) opts.segments = params.segments;
  const reference = formatReference(params.spec, sequence, opts);
  return { reference, sequence, bucket };
}
