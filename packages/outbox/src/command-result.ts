/**
 * @civitasone/outbox — command-result LIBRARY (FF-01 slice A, component C1).
 *
 * Design: erp-gap-remediation/03-designs/FF-01.md §2.1 (C1), §2.4 (guarded
 * upsert), §2.5 (state machine), §2.7 (idempotency), §5 (security), and owner
 * decision D-20 (WAVE0-DECISIONS.md §1).
 *
 * WHAT THIS ADDS, AND WHY IT IS NOT recordCommandOutcome():
 *   index.ts already has recordCommandOutcome() / getCommandOutcome(), built
 *   under G-ASYNC-1. They are deliberately KEPT and UNCHANGED — procurement
 *   and notification call them today and must keep working (this PR is
 *   additive, no caller changes). But they have two gaps the family exists to
 *   close (03-designs/FF-01.md §0 items 3-4):
 *     - recordCommandOutcome() uses `ON CONFLICT DO NOTHING`, so a legitimate
 *       retry after a `rejected` can never flip the row to `succeeded` — a
 *       deterministic-id approve would report "rejected" forever (§0 item 4).
 *     - the stored outcome carries only `reason` free text, never a stable
 *       `code`/`params` a status API could safely expose (§0 item 6, D-20).
 *   This library is the forward path every B/C adopter uses:
 *     - CommandRefusal: a NonRetryableError subclass carrying a stable `code`
 *       and non-PII `params` — throw it from a consumer for a known business
 *       rejection, and the code/params reach the caller without any free text.
 *     - recordCommandResult(): the §2.4 GUARDED UPSERT — a later `succeeded`
 *       replaces an earlier `rejected`/`failed`, a `succeeded` is never
 *       downgraded, and `attempts` increments. (D-20 accepts "rejected may
 *       become succeeded" on deterministic ids.)
 *     - getCommandResult(): tenant-scoped read that returns the STATUS-API view
 *       — code + params only, never `reason` (D-20).
 *     - subscribeCommand(): a thin wrapper over queue.subscribe() that refuses
 *       to wrap a non-COMMAND topic (silo-safety, 03-designs/FF-01.md §3.4) and
 *       records the terminal outcome via recordCommandResult() from onOutcome.
 *     - refusalCodeOf(): parses a legacy NonRetryableError message into a code,
 *       same convention as services/finance-service/src/modules/gl/refusal.ts,
 *       so adopters get a `code` for commands not yet migrated to CommandRefusal.
 *
 * RETENTION POLICY (D-20): rejected/failed rows live 30 days, succeeded rows 7
 * days. The TABLES come in the B/C PRs; this library only EXPOSES the policy as
 * COMMAND_RESULT_RETENTION so adopters' purge wiring reads one source of truth.
 */
import { and, eq, sql } from "drizzle-orm";
import { NonRetryableError } from "@civitasone/queue";
import type { Queue, Handler, SubscribeOptions, CommandOutcome } from "@civitasone/queue";
import {
  commandResults,
  markProcessed,
  type DrizzleTx,
  type CommandOutcomeStatus,
} from "./index.js";

/**
 * D-20 retention policy, in days, by terminal status. The library is the single
 * source of truth; the per-service purge (startOutboxPurge / purgeOutbox in
 * index.ts) and the B/C migrations read these numbers rather than re-deciding
 * them. `rejected`/`failed` are kept longer because they are the operational
 * evidence an officer or an auditor needs after a refusal; a `succeeded` row is
 * only a poll target and can go sooner.
 */
export const COMMAND_RESULT_RETENTION = Object.freeze({
  rejected: 30,
  failed: 30,
  succeeded: 7,
} as const satisfies Record<CommandOutcomeStatus, number>);

/**
 * The ONLY topic class this library records a result for: a COMMAND (one
 * consumer, imperative, caller holds the id). Events fan out to many consumers
 * and MUST NOT be recorded here — in a silo database every service's `_inbox`
 * objects share one physical table keyed by message_id, so recording an event
 * would conflate two services' rows (03-designs/FF-01.md §3.4). A command topic
 * is a dotted name whose middle segment is `.command.` OR that ends in an
 * imperative verb form the fleet already uses (`.create`, `.update`, `.repost`,
 * `.approve`, …); the simplest robust rule the fleet's own topic names satisfy
 * is "contains a `.command.` segment OR the caller asserts it is a command".
 * subscribeCommand() takes the assertion route: the caller opts a topic in, and
 * the guard below only REJECTS topics that look like events (`.*.ed`-style past
 * tense such as `finance.gl.posted`, `finance.gl.rejected`). This keeps the
 * check conservative — it blocks the known-dangerous event-shaped names without
 * guessing at every command verb.
 */
const EVENT_SHAPED_TOPIC = /\.(created|updated|deleted|posted|rejected|accepted|disbursed|paid|reconciled|failed|completed|cancelled|closed|opened|started|finished|released)$/i;

/** True if `topic` looks like a fan-out EVENT (past-tense tail) and so must not be wrapped as a command. */
export function isEventShapedTopic(topic: string): boolean {
  return EVENT_SHAPED_TOPIC.test(topic);
}

/**
 * A permanent business REFUSAL of a command, carrying a stable machine `code`
 * and non-PII `params`. Subclass of NonRetryableError, so a consumer that
 * throws it gets the fleet's existing dead-letter behaviour (bus.ts routes
 * NonRetryableError straight to the DLQ, no retries) AND the onOutcome hook
 * fires with status 'rejected'.
 *
 * D-20 / house rule 6: `code` + `params` are what a status API returns; the
 * human-readable `message` (passed to super) stays internal (operators, logs)
 * and is NEVER shown to a user. `params` MUST be non-PII (house rule, checked
 * by adopters' tests) — money goes as {minor:"<bigint>",currency:"INR"} (house
 * rule 4), never a float, never a name/email/phone/Aadhaar.
 */
export class CommandRefusal extends NonRetryableError {
  readonly code: string;
  readonly params: Record<string, unknown>;
  /** Always false for a refusal — a deterministic refusal is terminal, retrying cannot change it. */
  readonly retryable = false as const;

  constructor(
    code: string,
    params: Record<string, unknown> = {},
    /** Internal operator message. Defaults to the code so a bare throw still carries it; never user-facing. */
    message = code,
    cause?: unknown,
  ) {
    super(message, cause);
    this.name = "CommandRefusal";
    this.code = code;
    this.params = params;
  }
}

/** Type guard: the error is a CommandRefusal (carries a code + params). */
export function isCommandRefusal(err: unknown): err is CommandRefusal {
  return err instanceof CommandRefusal;
}

/**
 * Refusal codes a LEGACY NonRetryableError message may encode, for commands not
 * yet migrated to CommandRefusal. Same convention and spirit as
 * services/finance-service/src/modules/gl/refusal.ts:7-20 — a bracketed/leading
 * ALL-CAPS token (`[finance/payments] OVER_APPROPRIATION: ...`,
 * `PERIOD_CLOSED: ...`). Deliberately broad (any `[A-Z][A-Z0-9_]+`) because
 * this library is fleet-wide and must not hardcode one service's code list; the
 * finance parser stays narrow for its own domain.
 */
const LEADING_CODE = /^\s*\[[^\]]*\]\s*([A-Z][A-Z0-9_]+)\s*[:\-]/;
const BARE_LEADING_CODE = /^\s*([A-Z][A-Z0-9_]+)\s*[:\-]/;

/** Fallback code when nothing parseable is present — a refusal with no stable code. */
export const DEFAULT_REFUSAL_CODE = "REFUSED";

/**
 * Derive a stable refusal `code` from an error.
 *   - a CommandRefusal → its own `code` (authoritative).
 *   - an error with a string `code` property matching the token shape → that code.
 *   - otherwise parse the message: `[scope] CODE: ...` or `CODE: ...` / `CODE - ...`.
 *   - nothing parseable → DEFAULT_REFUSAL_CODE.
 * Never throws; never returns free text — only an uppercase token or the default.
 */
export function refusalCodeOf(err: unknown): string {
  if (isCommandRefusal(err)) return err.code;
  if (err !== null && typeof err === "object") {
    const code = (err as { code?: unknown }).code;
    if (typeof code === "string" && /^[A-Z][A-Z0-9_]+$/.test(code)) return code;
    const message = (err as { message?: unknown }).message;
    if (typeof message === "string") {
      const bracketed = LEADING_CODE.exec(message);
      if (bracketed) return bracketed[1] as string;
      const bare = BARE_LEADING_CODE.exec(message);
      if (bare) return bare[1] as string;
    }
  }
  return DEFAULT_REFUSAL_CODE;
}

/** The full persisted shape of one command result (operator/library view — includes `reason`). */
export interface CommandResultRecord {
  messageId: string;
  tenantId: string;
  topic: string;
  status: CommandOutcomeStatus;
  code: string | null;
  params: Record<string, unknown> | null;
  reason: string | null;
  retryable: boolean;
  attempts: number;
  resourceType: string | null;
  resourceId: string | null;
  occurredAt: Date;
  updatedAt: Date;
}

/** The STATUS-API view of a command result (D-20): code + params only, NEVER `reason`. */
export interface CommandResultView {
  status: CommandOutcomeStatus;
  code: string | null;
  params: Record<string, unknown> | null;
  retryable: boolean;
  attempts: number;
  resource: { type: string; id: string } | null;
  occurredAt: Date;
}

/** The input one terminal outcome is recorded from. */
export interface CommandResultInput {
  messageId: string;
  tenantId: string;
  topic: string;
  status: CommandOutcomeStatus;
  /** Stable refusal code (rejected/failed). Omit for succeeded. */
  code?: string | null;
  /** Non-PII params. Money as {minor,currency}. */
  params?: Record<string, unknown> | null;
  /** Internal free text (operators only). Never exposed by getCommandResult(). */
  reason?: string | null;
  /** True only for a transient 'failed' (retries exhausted); false for a deterministic 'rejected'. */
  retryable?: boolean;
  resourceType?: string | null;
  resourceId?: string | null;
}

/**
 * Record (or converge) a command's terminal result — the §2.4 GUARDED UPSERT.
 *
 * ON CONFLICT (message_id) DO UPDATE ... WHERE status <> 'succeeded':
 *   - first delivery: inserts the row.
 *   - a later `succeeded` after a `rejected`/`failed`: flips the row, bumps
 *     `attempts`, refreshes `updated_at` (the legitimate deterministic-id retry,
 *     D-20 / §0 item 4).
 *   - a late `rejected`/`failed` after a `succeeded`: the WHERE guard matches 0
 *     rows, so a success is NEVER downgraded (invariant I1).
 *   - the same refusal re-delivered: attempts increments.
 *
 * `tx` must already be tenant-scoped by the caller (same contract as enqueue /
 * markProcessed / recordCommandOutcome). Call from the onOutcome hook (see
 * subscribeCommand) inside the same transaction as markProcessed + the audit
 * outbox row (house rule 1).
 */
export async function recordCommandResult(tx: DrizzleTx, input: CommandResultInput): Promise<void> {
  const retryable = input.retryable ?? (input.status === "failed");
  await tx
    .insert(commandResults)
    .values({
      messageId: input.messageId,
      tenantId: input.tenantId,
      topic: input.topic,
      status: input.status,
      code: input.code ?? null,
      params: input.params ?? null,
      reason: input.reason ?? null,
      retryable,
      resourceType: input.resourceType ?? null,
      resourceId: input.resourceId ?? null,
      attempts: 1,
    })
    .onConflictDoUpdate({
      target: commandResults.messageId,
      set: {
        status: input.status,
        code: input.code ?? null,
        params: input.params ?? null,
        reason: input.reason ?? null,
        retryable,
        resourceType: input.resourceType ?? null,
        resourceId: input.resourceId ?? null,
        attempts: sql`${commandResults.attempts} + 1`,
        updatedAt: sql`now()`,
      },
      // I1: a succeeded result is terminal and never downgraded.
      setWhere: sql`${commandResults.status} <> 'succeeded'`,
    });
}

/**
 * Read a command's result for a status API — the D-20 view: `code` + `params`,
 * NEVER the free-text `reason`. Returns null while the command is still in
 * flight (no row yet) — render that as "processing", a distinct state from
 * "rejected" and from "unavailable" (invariant I5).
 *
 * `tenantId` is REQUIRED and filtered explicitly (defence in depth beside FORCE
 * RLS, which the B/C migrations add). ALWAYS pass the CALLER's own tenantId
 * (from the request context), never a value from the request body/params — this
 * filter plus RLS is what stops a caller reading another tenant's result.
 */
export async function getCommandResult(
  db: DrizzleTx,
  tenantId: string,
  messageId: string,
): Promise<CommandResultView | null> {
  const rows = await db
    .select({
      status: commandResults.status,
      code: commandResults.code,
      params: commandResults.params,
      retryable: commandResults.retryable,
      attempts: commandResults.attempts,
      resourceType: commandResults.resourceType,
      resourceId: commandResults.resourceId,
      occurredAt: commandResults.occurredAt,
    })
    .from(commandResults)
    .where(and(eq(commandResults.messageId, messageId), eq(commandResults.tenantId, tenantId)))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  return {
    status: row.status,
    code: row.code,
    params: row.params ?? null,
    retryable: row.retryable,
    attempts: row.attempts,
    resource:
      row.resourceType !== null && row.resourceId !== null
        ? { type: row.resourceType, id: row.resourceId }
        : null,
    occurredAt: row.occurredAt,
  };
}

/**
 * Map a bus CommandOutcome (messageId, tenantId, topic, status, reason?) to the
 * recordCommandResult() input, deriving a stable `code` from the reason text
 * for a non-success outcome (via refusalCodeOf on a synthetic error, so a
 * legacy NonRetryableError that reached the DLQ still yields a code). A
 * CommandRefusal thrown by the handler is not visible here (the bus only hands
 * onOutcome a flattened outcome), so adopters that want structured params throw
 * CommandRefusal AND record it in their own handler transaction; this mapping
 * is the safety-net path for everything else.
 */
export function outcomeToResultInput(outcome: CommandOutcome): CommandResultInput {
  const base: CommandResultInput = {
    messageId: outcome.messageId,
    tenantId: outcome.tenantId,
    topic: outcome.topic,
    status: outcome.status,
    reason: outcome.reason ?? null,
    retryable: outcome.status === "failed",
  };
  if (outcome.status !== "succeeded") {
    base.code = refusalCodeOf({ message: outcome.reason ?? "" });
  }
  return base;
}

/** How subscribeCommand() persists a terminal outcome: tenant-scoped, in one tx. */
export type RecordOutcome = (outcome: CommandOutcome) => Promise<void>;

/**
 * Subscribe a COMMAND topic and record its terminal result automatically.
 *
 * A thin, additive wrapper over queue.subscribe(): it wires an onOutcome that
 * persists the result via `record` (which the adopting service builds from
 * recordCommandResult inside its own tenant-scoped transaction — this package
 * takes no DB handle of its own, same as the rest of outbox). Any onOutcome the
 * caller also passes is still invoked (composed, not replaced).
 *
 * REFUSES a non-command (event-shaped) topic — throws before subscribing — so
 * an event fan-out can never be recorded into `_inbox.command_results` and
 * conflate two services' rows in a silo database (03-designs/FF-01.md §3.4).
 */
export function subscribeCommand<T = unknown>(
  queue: Queue,
  topic: string,
  handler: Handler<T>,
  record: RecordOutcome,
  options: SubscribeOptions = {},
): void {
  if (isEventShapedTopic(topic)) {
    throw new Error(
      `subscribeCommand refuses event-shaped topic "${topic}": command-results record COMMANDS only ` +
        `(one consumer, caller holds the id). Recording an event would conflate services' rows in a ` +
        `silo _inbox.command_results (03-designs/FF-01.md §3.4). Use queue.subscribe() for events.`,
    );
  }
  const callerOnOutcome = options.onOutcome;
  queue.subscribe<T>(topic, handler, {
    ...options,
    onOutcome: async (outcome) => {
      await record(outcome);
      if (callerOnOutcome) await callerOnOutcome(outcome);
    },
  });
}

/**
 * Build a RecordOutcome for subscribeCommand that runs recordCommandResult
 * inside a tenant-scoped transaction the caller supplies via `runInTenantTx`.
 * The adopting service passes a function that opens a transaction scoped to the
 * outcome's tenant (e.g. runWithTenant(tenantId, () => db.transaction(...)))
 * and, in that same transaction, also writes its markProcessed + audit row
 * (house rule 1). Kept separate from subscribeCommand so the wrapper stays
 * free of any tenant-routing assumption.
 */
export function makeRecordOutcome(
  runInTenantTx: (tenantId: string, fn: (tx: DrizzleTx) => Promise<void>) => Promise<void>,
): RecordOutcome {
  return (outcome: CommandOutcome) =>
    runInTenantTx(outcome.tenantId, (tx) => recordCommandResult(tx, outcomeToResultInput(outcome)));
}
