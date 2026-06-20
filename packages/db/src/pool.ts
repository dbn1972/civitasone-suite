import postgres from "postgres";

export type SqlClientOptions = {
  max?: number;
  prepare?: boolean;
  idle_timeout?: number;
  connect_timeout?: number;
};

/** PgBouncer-aware postgres-js client — use port 6432 or DB_VIA_PGBOUNCER=true. */
export function createSqlClient(connectionString?: string, overrides?: SqlClientOptions) {
  const url = connectionString ?? process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required");

  const viaBouncer =
    process.env.DB_VIA_PGBOUNCER === "true"
    || url.includes(":6432")
    || url.includes("pgbouncer");

  const max = overrides?.max ?? Number(process.env.DB_POOL_MAX ?? (viaBouncer ? 5 : 10));

  return postgres(url, {
    max,
    prepare: overrides?.prepare ?? !viaBouncer,
    idle_timeout: overrides?.idle_timeout ?? 20,
    connect_timeout: overrides?.connect_timeout ?? 10,
  });
}
