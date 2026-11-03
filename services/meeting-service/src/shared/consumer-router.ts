/**
 * meeting-worker retry + dead-letter router, and the normalisation of whatever a consumer throws
 * (UAT J14, bundle 15).
 *
 * Before: worker.ts logged `err: err instanceof Error ? err.stack : String(err)`, i.e. a STRING,
 * and SAFE_LOG_SERIALIZERS reduces any non-Error to { type: "string", message: "non-Error value
 * thrown" }, so the J14 dead letter carried no cause at all. A thrown non-Error (a string, a plain
 * object, a raw DB error object) was also always retried three times, even when it was a
 * permanent validation or business-rule rejection.
 *
 * Now:
 *   - normaliseThrown(): every thrown value becomes an Error that says what failed without
 *     logging input values: a DB error is reduced to its SQLSTATE and safe metadata, a plain
 *     object to its code/status and key names (see normaliseThrown).
 *   - classifyConsumerFailure(): validation and business-rule failures are non-retryable and are
 *     dead-lettered after ONE attempt: NonRetryableError, an HttpError / status-carrying 4xx (bar
 *     408 / 429), a ZodError, an optimistic-lock VersionConflictError (the command carries a fixed
 *     expected version, so a retry can never succeed), and Postgres data exceptions (class 22) and
 *     integrity violations (class 23: CHECK, NOT NULL, FK, unique). Everything else (connection
 *     errors, serialization failures, an undefined relation during a deploy window) is retried.
 *   - makeConsumerRouter(): after dead-lettering it rethrows a NonRetryableError, so the bus parks
 *     the ORIGINAL message in the topic DLQ (<topic>__meeting-service-dlq, redrivable) and records a
 *     "rejected" command outcome, instead of acking a failed command as succeeded. The service
 *     topic meeting.dlq has no subscriber on UAT, so it was never a durable record by itself.
 */
import type { CommandEnvelope, Handler } from "@civitasone/queue";
import { NonRetryableError, isNonRetryable } from "@civitasone/queue";
import { isPostgresError, safeErr } from "@civitasone/observability";
import { ZodError } from "zod";
import { VersionConflictError } from "./outbox.js";

/** An Error built from a thrown value that was not an Error (a string, a plain object, undefined ...). */
export class NonErrorThrown extends Error {
  readonly thrownType: string;
  readonly details: unknown;
  constructor(message: string, thrownType: string, details?: unknown) {
    super(message);
    this.name = "NonErrorThrown";
    this.thrownType = thrownType;
    this.details = details;
  }
}

/**
 * A database error reduced to log-safe metadata (#2445 review item 6 / #2452 review). The
 * Postgres message, detail and hint can echo input values (22P02 "invalid input syntax for type
 * uuid: <value>", 22007 dates, 23505 key detail), so the message is the fixed
 * "database error <SQLSTATE>[ on <constraint>]" from safeErr and only code, constraint, table,
 * schema, column, routine and severity are kept. The original error is NOT kept as `cause`.
 */
export class ReducedDatabaseError extends Error {
  readonly code: string;
  constructor(reduced: Record<string, unknown> & { message: string }) {
    super(reduced.message);
    this.name = "ReducedDatabaseError";
    this.code = String(reduced.code ?? "");
    for (const [k, v] of Object.entries(reduced)) {
      if (k !== "type" && k !== "message" && k !== "stack" && k !== "code") (this as unknown as Record<string, unknown>)[k] = v;
    }
  }
}

/** Fields of a plain thrown object whose values are kept (codes and statuses only). */
const CARRIED_FIELDS = ["status", "statusCode", "httpStatus", "code"] as const;

function carriedScalar(v: unknown): string | number | undefined {
  return typeof v === "number" || (typeof v === "string" && /^[A-Za-z0-9_.:-]{1,64}$/.test(v)) ? v : undefined;
}

/**
 * Turn any thrown value into an Error that is safe to log and still says what failed:
 *  - a Postgres error (an Error instance or a plain object) -> ReducedDatabaseError;
 *  - an Error whose message embeds a Postgres cause message -> ReducedDatabaseError of the cause;
 *  - any other Error -> unchanged;
 *  - a string -> NonErrorThrown with that string;
 *  - a plain object -> NonErrorThrown carrying only its code/status values and its key NAMES
 *    (never the other values: a thrown row or payload would otherwise land in the log);
 *  - anything else -> NonErrorThrown "non-Error value thrown: <String(value)>".
 */
export function normaliseThrown(thrown: unknown): Error {
  if (isPostgresError(thrown)) return new ReducedDatabaseError(safeErr(thrown));
  if (thrown instanceof Error) {
    const cause = (thrown as { cause?: unknown }).cause;
    if (isPostgresError(cause) && typeof cause.message === "string" && cause.message.length > 0 && thrown.message.includes(cause.message)) {
      return new ReducedDatabaseError(safeErr(cause));
    }
    return thrown;
  }
  if (typeof thrown === "string") return new NonErrorThrown(thrown.length > 0 ? thrown : "empty string thrown", "string");
  if (thrown !== null && typeof thrown === "object") {
    const o = thrown as Record<string, unknown>;
    const keys = Object.keys(o).slice(0, 20);
    const carried: Record<string, string | number> = {};
    for (const k of CARRIED_FIELDS) {
      const v = carriedScalar(o[k]);
      if (v !== undefined) carried[k] = v;
    }
    const summary = Object.entries(carried).map(([k, v]) => `${k} ${v}`).join(", ");
    const message = `non-Error object thrown (${summary ? `${summary}; ` : ""}keys: ${keys.join(", ") || "none"})`;
    const e = new NonErrorThrown(message, "object", { keys, ...carried });
    for (const [k, v] of Object.entries(carried)) (e as unknown as Record<string, unknown>)[k] = v;
    return e;
  }
  return new NonErrorThrown(`non-Error value thrown: ${String(thrown)}`, typeof thrown);
}

function statusOf(err: Error): number | null {
  const r = err as unknown as Record<string, unknown>;
  for (const k of ["status", "statusCode", "httpStatus"]) {
    if (typeof r[k] === "number") return r[k] as number;
  }
  return null;
}

function pgCodeOf(err: Error): string | null {
  if (err instanceof ReducedDatabaseError) return err.code || null;
  if (isPostgresError(err)) return String((err as unknown as { code: string }).code);
  const cause = (err as { cause?: unknown }).cause;
  if (cause instanceof ReducedDatabaseError) return cause.code || null;
  if (isPostgresError(cause)) return String(cause.code);
  return null;
}

/** True for a failure that a retry can never fix (validation, business rule, constraint). */
export function isPermanentFailure(err: Error): boolean {
  if (isNonRetryable(err)) return true;
  if (err instanceof ZodError) return true;
  if (err instanceof VersionConflictError) return true;
  const status = statusOf(err);
  if (status !== null && status >= 400 && status < 500 && status !== 408 && status !== 429) return true;
  const pg = pgCodeOf(err);
  if (pg !== null && (pg.startsWith("22") || pg.startsWith("23"))) return true;
  return false;
}

/**
 * Normalise a thrown value and classify it: a permanent failure comes back as a NonRetryableError
 * (with the normalised Error as its cause), anything else as the normalised Error.
 */
export function classifyConsumerFailure(thrown: unknown): Error {
  // Decided on the ORIGINAL value: a NonRetryableError whose message embeds a DB error is
  // reduced by normaliseThrown and must stay non-retryable.
  const wasPermanent = isNonRetryable(thrown);
  const err = normaliseThrown(thrown);
  if (err instanceof NonRetryableError) return err;
  if (wasPermanent || isPermanentFailure(err)) return new NonRetryableError(err.message, err);
  return err;
}

export type ConsumerHandler = (msg: CommandEnvelope) => Promise<void>;

export interface ConsumerRouterDeps {
  topic: string;
  /** Looked up on every delivery, so registrations added at boot are always visible. */
  getHandler: (topic: string) => ConsumerHandler | undefined;
  /** Establish the tenant context (app.tenant_id GUC) around the handler. */
  runInTenant: (tenantId: string, fn: () => Promise<void>) => Promise<void>;
  /** Durable record of last resort: log, metric, and the service DLQ publish. */
  deadLetter: (topic: string, msg: CommandEnvelope, err: Error, attempts: number) => Promise<void>;
  onMissingHandler: (topic: string, msg: CommandEnvelope) => void;
  maxAttempts: number;
  backoffMs: readonly number[];
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Retry + DLQ router for one topic: transient failures are retried with backoff, a permanent one
 * (or exhaustion) is dead-lettered with the normalised Error and the real attempt count, then
 * handed back to the bus as a NonRetryableError (see the file header).
 */
export function makeConsumerRouter(deps: ConsumerRouterDeps): Handler {
  const sleep = deps.sleep ?? defaultSleep;
  return async (msg: CommandEnvelope): Promise<void> => {
    const handler = deps.getHandler(deps.topic);
    if (!handler) {
      deps.onMissingHandler(deps.topic, msg);
      return;
    }
    let lastErr: Error = new Error("consumer failed");
    let attempts = 0;
    for (let attempt = 1; attempt <= deps.maxAttempts; attempt++) {
      attempts = attempt;
      try {
        await deps.runInTenant(msg.tenantId, () => handler(msg));
        return;
      } catch (thrown) {
        lastErr = classifyConsumerFailure(thrown);
        if (isNonRetryable(lastErr)) break;
        if (attempt < deps.maxAttempts) {
          await sleep(deps.backoffMs[attempt - 1] ?? deps.backoffMs[deps.backoffMs.length - 1] ?? 0);
        }
      }
    }
    await deps.deadLetter(deps.topic, msg, lastErr, attempts);
    throw lastErr instanceof NonRetryableError ? lastErr : new NonRetryableError(lastErr.message, lastErr);
  };
}
