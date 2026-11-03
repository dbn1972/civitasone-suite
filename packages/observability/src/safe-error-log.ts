/**
 * Log-safe error serializer shared by the services (UAT #2445 review, items 6 and the
 * hrms duplicate-employee 500). A postgres-js PostgresError carries enumerable `query`,
 * `parameters` and `args` (every inserted value: names, PAN, bank details ...) and a
 * `detail` that echoes the conflicting key; pino's default `err` serializer copies all
 * of it into the log line. Use SAFE_LOG_SERIALIZERS as the `serializers` of every pino
 * logger and of Fastify's request logger. A database error is logged as its code,
 * constraint, table, schema, column, routine and severity, with a fixed message and no
 * stack. Any other Error keeps pino's usual shape (type, message, stack, own enumerable
 * properties), with database errors nested as `cause` or as a property reduced the same
 * way. Written without pino so this package stays dependency-free.
 */
const PG_SAFE_FIELDS = ["code", "constraint_name", "table_name", "schema_name", "column_name", "routine", "severity"] as const;

export type SafeErr = { [key: string]: unknown; type: string; message: string; stack: string };

export function isPostgresError(e: unknown): e is Record<string, unknown> {
  if (!e || typeof e !== "object") return false;
  const r = e as Record<string, unknown>;
  if (typeof r.code !== "string" || !/^[0-9A-Z]{5}$/.test(r.code)) return false;
  return r.name === "PostgresError" || "query" in r || "parameters" in r || "args" in r || "routine" in r;
}

export function safeErr(err: unknown, depth = 0): SafeErr {
  if (isPostgresError(err)) {
    const code = String(err.code);
    const constraint = typeof err.constraint_name === "string" ? ` on ${err.constraint_name}` : "";
    const out: SafeErr = { type: "PostgresError", message: `database error ${code}${constraint}`, stack: "" };
    for (const k of PG_SAFE_FIELDS) if (typeof err[k] === "string") out[k] = err[k];
    return out;
  }
  if (!(err instanceof Error)) return { type: typeof err, message: "non-Error value thrown", stack: "" };
  const out: SafeErr = { type: err.constructor?.name || err.name || "Error", message: err.message, stack: err.stack ?? "" };
  if (depth > 5) return out;
  for (const [k, v] of Object.entries(err)) {
    if (k in out || k === "cause") continue;
    out[k] = v instanceof Error || isPostgresError(v) ? safeErr(v, depth + 1) : v;
  }
  const cause = (err as { cause?: unknown }).cause;
  if (cause !== undefined) out.cause = safeErr(cause, depth + 1);
  return out;
}

/** Pass as `serializers` to pino / Fastify's logger. */
export const SAFE_LOG_SERIALIZERS = { err: (e: unknown) => safeErr(e), error: (e: unknown) => safeErr(e) };

/** True for a unique violation, optionally on one named constraint (also when wrapped as `cause`). */
export function isUniqueViolation(err: unknown, constraint?: string): boolean {
  const cause = (err as { cause?: unknown } | null)?.cause;
  const e = isPostgresError(err) ? err : isPostgresError(cause) ? cause : null;
  if (!e || e.code !== "23505") return false;
  return constraint === undefined || e.constraint_name === constraint;
}
