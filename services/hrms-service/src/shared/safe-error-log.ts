import { pino } from "pino";

/**
 * UAT follow-up (duplicate employee number): a unique violation on an INSERT
 * reached the logs as a full postgres-js PostgresError, whose enumerable
 * `query`, `parameters` and `args` carry every inserted value (employee name,
 * sealed PAN, bank details ...) and whose `detail` echoes the conflicting key.
 * pino's default `err` serializer copies all of that. Every hrms logger (the
 * Fastify request logger and each module's pino instance) uses this serializer
 * instead: a database error is logged as its code, constraint, table, schema,
 * column and routine only. Never its message, detail, stack, query or values.
 * Any other error keeps pino's standard shape, with a database error nested
 * as `cause` reduced the same way.
 */
const PG_SAFE_FIELDS = ["code", "constraint_name", "table_name", "schema_name", "column_name", "routine", "severity"] as const;

export function isPostgresError(e: unknown): e is Record<string, unknown> {
  if (!e || typeof e !== "object") return false;
  const r = e as Record<string, unknown>;
  if (typeof r.code !== "string" || !/^[0-9A-Z]{5}$/.test(r.code)) return false;
  return r.name === "PostgresError" || "query" in r || "parameters" in r || "args" in r || "routine" in r;
}

export type SafeErr = { [key: string]: unknown; type: string; message: string; stack: string };

export function safeErr(err: unknown): SafeErr {
  if (isPostgresError(err)) {
    // A fixed message: the driver's own message, detail and stack can echo input values.
    const code = String(err.code);
    const constraint = typeof err.constraint_name === "string" ? ` on ${err.constraint_name}` : "";
    const out: SafeErr = { type: "PostgresError", message: `database error ${code}${constraint}`, stack: "" };
    for (const k of PG_SAFE_FIELDS) if (typeof err[k] === "string") out[k] = err[k];
    return out;
  }
  if (!(err instanceof Error)) return { type: typeof err, message: "non-Error value thrown", stack: "" };
  const base = pino.stdSerializers.err(err) as unknown as SafeErr;
  const cause = (err as { cause?: unknown }).cause;
  if (cause !== undefined) base.cause = safeErr(cause);
  return base;
}

/** Pass as `serializers` to pino / Fastify's logger. */
export const SAFE_LOG_SERIALIZERS = { err: safeErr, error: safeErr };

/** True for a unique violation, optionally on one named constraint (also when wrapped as `cause`). */
export function isUniqueViolation(err: unknown, constraint?: string): boolean {
  const e = isPostgresError(err) ? err : isPostgresError((err as { cause?: unknown } | null)?.cause) ? (err as { cause: Record<string, unknown> }).cause : null;
  if (!e || e.code !== "23505") return false;
  return constraint === undefined || e.constraint_name === constraint;
}
