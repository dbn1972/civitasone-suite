/**
 * Minimal Drizzle transaction type for the search indexing utility.
 * Re-exported from @civitasone/outbox to avoid circular deps at runtime.
 */
import type { PgDatabase } from "drizzle-orm/pg-core";
import type { PostgresJsQueryResultHKT } from "drizzle-orm/postgres-js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type DrizzleTx = PgDatabase<PostgresJsQueryResultHKT, any, any>;
