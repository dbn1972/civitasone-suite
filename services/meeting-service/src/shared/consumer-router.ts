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
 *   - normaliseThrown(): every thrown value becomes an Error that keeps the original details
 *     (message, status/code, a log-safe reduction of a DB error object), so the log line and the
 *     DLQ reason say what actually failed.
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

/** Fields of a plain thrown object that are copied onto the Error so classification and logs can use them. */
const CARRIED_FIELDS = ["status", "statusCode", "httpStatus", "code"] as const;

/** Turn any thrown value into an Error that keeps the original details. An Error is returned as is. */
export function normaliseThrown(thrown: unknown): Error {
  if (thrown instanceof Error) return thrown;
  if (isPostgresError(thrown)) {
    // A raw DB error object (not an Error instance): keep only the log-safe fields, never the
    // query / parameters, which carry input values.
    const reduced = safeErr(thrown);
    const e = new NonErrorThrown(reduced.message, "PostgresError", reduced);
    for (const [k, v] of Object.entries(reduced)) {
      if (k !== "type" && k !== "message" && k !== "stack") (e as unknown as Record<string, unknown>)[k] = v;
    }
    return e;
  }
  if (typeof thrown === "string") return new NonErrorThrown(thrown.length > 0 ? thrown : "empty string thrown", "string");
  if (thrown !== null && typeof thrown === "object") {
    const o = thrown as Record<string, unknown>;
    const message = typeof o.message === "string" && o.message.length > 0
      ? o.message
      : `non-Error object thrown (keys: ${Object.keys(o).slice(0, 10).join(", ") || "none"})`;
    const e = new NonErrorThrown(message, "object", o);
    for (const k of CARRIED_FIELDS) if (o[k] !== undefined) (e as unknown as Record<string, unknown>)[k] = o[k];
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
  if (isPostgresError(err)) return String((err as unknown as { code: string }).code);
  const cause = (err as { cause?: unknown }).cause;
  if (isPostgresError(cause)) return String(cause.code);
  if (err instanceof NonErrorThrown && err.thrownType === "PostgresError") {
    const code = (err as unknown as { code?: unknown }).code;
    return typeof code === "string" ? code : null;
  }
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
  const err = normaliseThrown(thrown);
  if (err instanceof NonRetryableError) return err;
  if (isPermanentFailure(err)) {
    const permanent = new NonRetryableError(err.message, err);
    return permanent;
  }
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
