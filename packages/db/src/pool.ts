import postgres from "postgres";

export type SqlClientOptions = {
  max?: number;
  prepare?: boolean;
  idle_timeout?: number;
  connect_timeout?: number;
};

/** Postgres OID for `json`. postgres-js keys its serializer table by OID. */
const OID_JSON = 114;
/** Postgres OID for `jsonb`. */
const OID_JSONB = 3802;

/**
 * Serializer for every parameter the server describes as json(114) or jsonb(3802).
 *
 * WHY this exists at all:
 * Drizzle's `PgJsonb.mapToDriverValue` already returns `JSON.stringify(value)` — i.e.
 * the driver receives *JSON text*, not a JS document. postgres-js then applies its
 * builtin `json.serialize = x => JSON.stringify(x)` to that same value because the
 * server-side ParameterDescription says the slot is jsonb. The document is therefore
 * encoded twice and Postgres stores a jsonb *string* whose text happens to be the
 * intended document: `jsonb_typeof` reports `string`, `->>'key'` returns NULL, and no
 * GIN/containment operator can ever match. Reads hid the damage because postgres-js
 * parses once and Drizzle's `mapFromDriverValue` parses again.
 *
 * WHY the "already valid JSON text" discriminator is correct:
 * Drizzle is the only writer on the ORM path and it *always* hands over the output of
 * `JSON.stringify`, so a string arriving here is, for Drizzle traffic, valid JSON text
 * by construction — passing it through unchanged is exactly one encoding, which is what
 * Postgres wants. Anything that is not a string (plain objects/arrays from raw
 * `sql` calls, numbers, booleans, Date) cannot be JSON text yet, so it still gets
 * encoded once, preserving the pre-existing raw-driver behaviour byte for byte.
 *
 * WHY a JSON scalar string is safe: `hello` is not valid JSON text (`JSON.parse`
 * throws), so it falls to `JSON.stringify` and still lands as the jsonb string
 * `"hello"` — unchanged from before this fix.
 *
 * WHY the `typeof x === "string"` guard is load-bearing: `JSON.parse` coerces its
 * argument, so `JSON.parse(123)` succeeds. Without the guard a bare number would be
 * returned as a number to postgres-js's `Bind()`, which expects a string.
 *
 * RESIDUAL AMBIGUITY (accepted, documented deliberately):
 * a caller bypassing Drizzle and passing the *string* `"123"` while intending the jsonb
 * *string* `"123"` will instead get the jsonb *number* `123`; likewise `"true"`, `"null"`
 * and any string that parses as JSON. This is unreachable through Drizzle (Drizzle would
 * send `"\"123\""` for that intent) and is a strictly smaller problem than leaving ~107k
 * already-written rows unqueryable, so we accept it rather than adding a marker type that
 * every call site would have to opt into.
 *
 * NOT COVERED: OID 3807 (`jsonb[]`). postgres-js builds array serializers lazily from the
 * element serializer only when it encounters the array type, and this override does not
 * register 3807. A catalogue sweep of every civitas_* database found zero columns with
 * udt_name `_jsonb`/`_json`, and no Drizzle schema in the repo declares `jsonb().array()`,
 * so there is nothing to fix today. If a `jsonb[]` column is ever introduced, extend this
 * override — see JSONB-ENCODING.md.
 */
export function serializeJsonParam(x: unknown): string {
  if (typeof x === "string") {
    try {
      JSON.parse(x);
      // Already JSON text (Drizzle's normal output) — encode zero further times.
      return x;
    } catch {
      // A bare string such as `hello`: encode once so it becomes a jsonb string.
      return JSON.stringify(x);
    }
  }
  // Objects, arrays, numbers, booleans, null, Date: identical to postgres-js's builtin.
  return JSON.stringify(x);
}

/**
 * `parse` is MANDATORY, not decorative. postgres-js `typeHandlers()` does
 * `types[k].from && [].concat(types[k].from).forEach(x => acc.parsers[x] = types[k].parse)`,
 * so declaring `from` without `parse` would assign `undefined` to `parsers[114]` and
 * `parsers[3802]` and every jsonb read on the platform would come back as raw text.
 * We supply `JSON.parse`, matching the builtin exactly.
 */
const jsonTypeOverride: postgres.PostgresType<unknown> = {
  to: OID_JSON,
  from: [OID_JSON, OID_JSONB],
  serialize: serializeJsonParam,
  parse: (raw: string): unknown => JSON.parse(raw),
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

  // Annotated as the widened Options type so the inferred return type stays
  // `postgres.Sql<{}>` — adding `types` must not change this function's public
  // signature. Without the annotation T infers as `{ json: PostgresType<unknown> }`
  // and the return type becomes `Sql<{ json: unknown }>`, which would leak into
  // every service's shared/db.ts.
  const options: postgres.Options<Record<string, postgres.PostgresType<unknown>>> = {
    max,
    prepare: overrides?.prepare ?? !viaBouncer,
    idle_timeout: overrides?.idle_timeout ?? 20,
    connect_timeout: overrides?.connect_timeout ?? 10,
    types: { json: jsonTypeOverride },
  };

  return postgres(url, options);
}
