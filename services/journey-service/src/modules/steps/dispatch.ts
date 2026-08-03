/**
 * steps/dispatch.ts — real stepType dispatch (P1-8).
 *
 * Before this module the step consumer accepted any `stepType`, wrote one
 * `executing` row and emitted `journey.step.completed` regardless of what the
 * step was supposed to do, so an active journey produced no observable effect.
 *
 * The dispatch is deliberately split in two halves:
 *
 *   planStep()      pure. Parses + validates the step's config and decides the
 *                   effect. Throws StepDispatchError for anything it cannot
 *                   honour, so an unsupported step can never be recorded as a
 *                   success.
 *   performApiCall() the only outbound I/O. Runs OUTSIDE the DB transaction,
 *                   because calling out from inside one pins a pooled
 *                   connection for the length of a remote timeout.
 *
 * Effects themselves are applied by the consumer: cross-service work leaves as
 * a queue command through the transactional outbox (never by touching another
 * service's tables or database), a `wait` parks the row until `resumeAt`, and
 * every other outcome is a terminal step status plus an audit event.
 */
import { z } from "zod";
import { STEP_TYPES, type StepType, type StepStatus } from "./domain.js";

/** Failure classes a step can end in. `retryable` decides queue retry vs terminal. */
export const FAILURE_CODES = {
  unknownStepType: "UNKNOWN_STEP_TYPE",
  invalidStepConfig: "INVALID_STEP_CONFIG",
  apiCallNotConfigured: "API_CALL_NOT_CONFIGURED",
  apiCallBlocked: "API_CALL_BLOCKED",
  apiCallRejected: "API_CALL_REJECTED",
  apiCallUnavailable: "API_CALL_UNAVAILABLE",
} as const;

export type FailureCode = (typeof FAILURE_CODES)[keyof typeof FAILURE_CODES];

/**
 * A step could not be dispatched. `retryable` distinguishes "the world is
 * temporarily broken" (rethrow so the queue retries and eventually DLQs) from
 * "this step definition can never work" (record a terminal `failed` step).
 */
export class StepDispatchError extends Error {
  constructor(
    readonly code: FailureCode,
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "StepDispatchError";
  }
}

// ── Step config contracts ────────────────────────────────────────────────────
// A journey step is stored as `{ type, config }` inside journeys.steps (jsonb).
// The jsonb is untyped at rest, so each step type validates its own config here
// at dispatch time. An unparseable config is a terminal failure, not a default.

const sendNotificationConfig = z.object({
  templateId: z.string().uuid(),
  channel: z.enum(["email", "sms", "push", "in_app", "whatsapp"]).optional(),
  /** Defaults to the enrolled profile when omitted. */
  recipientId: z.string().uuid().optional(),
  variables: z.record(z.string()).optional(),
  /** Journey sends are commercial by default so notification-service applies its consent gate. */
  category: z.enum(["transactional", "marketing"]).default("marketing"),
});

const waitConfig = z
  .object({
    delaySeconds: z.number().int().positive().optional(),
    delayMinutes: z.number().int().positive().optional(),
    delayHours: z.number().int().positive().optional(),
    delayDays: z.number().int().positive().optional(),
  })
  .refine(
    (c) =>
      c.delaySeconds !== undefined ||
      c.delayMinutes !== undefined ||
      c.delayHours !== undefined ||
      c.delayDays !== undefined,
    { message: "one of delaySeconds, delayMinutes, delayHours, delayDays is required" },
  );

const CONDITION_OPERATORS = [
  "eq",
  "neq",
  "gt",
  "gte",
  "lt",
  "lte",
  "exists",
  "not_exists",
  "in",
  "contains",
] as const;

const conditionConfig = z.object({
  /** Dotted path into the run context carried on the command. */
  attribute: z.string().min(1),
  operator: z.enum(CONDITION_OPERATORS),
  value: z.unknown().optional(),
  /** What a false gate does: skip this step and continue, or end the run. */
  onFalse: z.enum(["skip", "exit"]).default("skip"),
});

const apiCallConfig = z.object({
  url: z.string().url(),
  method: z.enum(["POST", "PUT", "PATCH"]).default("POST"),
  headers: z.record(z.string()).optional(),
  body: z.record(z.unknown()).optional(),
  timeoutMs: z.number().int().min(100).max(30_000).default(5_000),
});

export type ApiCallRequest = z.infer<typeof apiCallConfig>;

// ── Plan ─────────────────────────────────────────────────────────────────────

/** Where the run goes after this step. */
export type RunOutcome = "advance" | "exit" | "park";

export type StepPlan =
  | {
      kind: "notify";
      status: Extract<StepStatus, "completed">;
      runOutcome: "advance";
      /** Command payload for `notification.send`, enqueued via the outbox. */
      notification: Record<string, unknown>;
    }
  | { kind: "wait"; status: Extract<StepStatus, "waiting">; runOutcome: "park"; resumeAt: Date }
  | {
      kind: "condition";
      status: Extract<StepStatus, "completed" | "skipped">;
      runOutcome: "advance" | "exit";
      passed: boolean;
      reason: string;
    }
  | {
      kind: "api_call";
      status: Extract<StepStatus, "completed">;
      runOutcome: "advance";
      request: ApiCallRequest;
    };

export interface PlanStepInput {
  stepType: string;
  config: Record<string, unknown>;
  /** The enrolled profile — the default notification recipient. */
  profileId: string;
  /** Attributes the trigger/enrollment captured, read by `condition_check`. */
  context: Record<string, unknown>;
  now: Date;
}

/**
 * Decide what a step does. Pure — no I/O, no clock of its own (`now` is passed
 * so wait deadlines are testable).
 *
 * Throws StepDispatchError rather than returning a default for anything it
 * cannot honour. Silently treating an unknown step type as a success is the
 * exact defect this replaces.
 */
export function planStep(input: PlanStepInput): StepPlan {
  if (!isStepType(input.stepType)) {
    throw new StepDispatchError(
      FAILURE_CODES.unknownStepType,
      `unsupported step type '${input.stepType}'; supported: ${STEP_TYPES.join(", ")}`,
      false,
    );
  }

  switch (input.stepType) {
    case "send_notification":
      return planSendNotification(input);
    case "wait":
      return planWait(input);
    case "condition_check":
      return planCondition(input);
    case "api_call":
      return planApiCall(input);
  }
}

function isStepType(value: string): value is StepType {
  return (STEP_TYPES as readonly string[]).includes(value);
}

// Generic over the schema, not over its output: z.ZodType<T> would collapse the
// input and output types and lose every `.default()` the configs rely on.
function parseConfig<S extends z.ZodTypeAny>(
  schema: S,
  stepType: string,
  config: Record<string, unknown>,
): z.output<S> {
  const parsed = schema.safeParse(config);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("; ");
    throw new StepDispatchError(
      FAILURE_CODES.invalidStepConfig,
      `invalid config for step type '${stepType}': ${detail}`,
      false,
    );
  }
  return parsed.data;
}

function planSendNotification(input: PlanStepInput): StepPlan {
  const c = parseConfig(sendNotificationConfig, "send_notification", input.config);
  return {
    kind: "notify",
    status: "completed",
    runOutcome: "advance",
    notification: {
      templateId: c.templateId,
      recipientId: c.recipientId ?? input.profileId,
      ...(c.channel ? { channel: c.channel } : {}),
      ...(c.variables ? { variables: c.variables } : {}),
      category: c.category,
    },
  };
}

function planWait(input: PlanStepInput): StepPlan {
  const c = parseConfig(waitConfig, "wait", input.config);
  const seconds =
    (c.delaySeconds ?? 0) +
    (c.delayMinutes ?? 0) * 60 +
    (c.delayHours ?? 0) * 3_600 +
    (c.delayDays ?? 0) * 86_400;
  return {
    kind: "wait",
    status: "waiting",
    runOutcome: "park",
    resumeAt: new Date(input.now.getTime() + seconds * 1_000),
  };
}

function planCondition(input: PlanStepInput): StepPlan {
  const c = parseConfig(conditionConfig, "condition_check", input.config);
  const actual = readPath(input.context, c.attribute);
  const passed = evaluate(c.operator, actual, c.value);
  if (passed) {
    return {
      kind: "condition",
      status: "completed",
      runOutcome: "advance",
      passed: true,
      reason: `${c.attribute} ${c.operator} matched`,
    };
  }
  return {
    kind: "condition",
    status: "skipped",
    runOutcome: c.onFalse === "exit" ? "exit" : "advance",
    passed: false,
    reason: `${c.attribute} ${c.operator} did not match`,
  };
}

function planApiCall(input: PlanStepInput): StepPlan {
  const c = parseConfig(apiCallConfig, "api_call", input.config);
  // Reject the target before any request is attempted, so a blocked host is a
  // config failure rather than an outbound connection we then have to abort.
  assertUrlAllowed(c.url);
  return { kind: "api_call", status: "completed", runOutcome: "advance", request: c };
}

// ── Condition evaluation ─────────────────────────────────────────────────────

/** Read `a.b.c` out of a nested record. Returns undefined for any missing hop. */
export function readPath(source: Record<string, unknown>, path: string): unknown {
  let cursor: unknown = source;
  for (const key of path.split(".")) {
    if (cursor === null || typeof cursor !== "object") return undefined;
    cursor = (cursor as Record<string, unknown>)[key];
  }
  return cursor;
}

export function evaluate(
  operator: (typeof CONDITION_OPERATORS)[number],
  actual: unknown,
  expected: unknown,
): boolean {
  switch (operator) {
    case "exists":
      return actual !== undefined && actual !== null;
    case "not_exists":
      return actual === undefined || actual === null;
    case "eq":
      return actual === expected;
    case "neq":
      return actual !== expected;
    case "gt":
    case "gte":
    case "lt":
    case "lte": {
      const a = Number(actual);
      const b = Number(expected);
      if (Number.isNaN(a) || Number.isNaN(b)) return false;
      if (operator === "gt") return a > b;
      if (operator === "gte") return a >= b;
      if (operator === "lt") return a < b;
      return a <= b;
    }
    case "in":
      return Array.isArray(expected) && expected.includes(actual);
    case "contains":
      if (Array.isArray(actual)) return actual.includes(expected);
      if (typeof actual === "string") return actual.includes(String(expected));
      return false;
  }
}

// ── Outbound api_call ────────────────────────────────────────────────────────

/**
 * Hosts a journey `api_call` step may reach, from
 * `JOURNEY_API_CALL_ALLOWED_HOSTS` (comma separated). An entry beginning with a
 * dot matches that domain and its subdomains; anything else must match the host
 * exactly.
 *
 * Fails CLOSED: with no allowlist configured, every `api_call` step fails
 * terminally instead of letting a tenant-authored URL turn the worker into an
 * SSRF proxy for the cluster's internal network.
 */
function allowedHosts(): string[] {
  return (process.env.JOURNEY_API_CALL_ALLOWED_HOSTS ?? "")
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter((h) => h.length > 0);
}

/** Literal addresses that must never be reachable, allowlisted or not. */
function isBlockedAddressLiteral(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  // IPv6 loopback / link-local / unique-local
  if (host === "::1" || host === "::" || host.startsWith("fe80:") || host.startsWith("fc") || host.startsWith("fd")) {
    return true;
  }
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!v4) return false;
  const [a, b] = [Number(v4[1]), Number(v4[2])];
  if (a === 127 || a === 0 || a === 10) return true;
  if (a === 169 && b === 254) return true; // link-local, incl. cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  return false;
}

/**
 * Validate an `api_call` target. Throws StepDispatchError (non-retryable) when
 * the URL is unusable, off-allowlist, or points at a private/loopback address.
 */
export function assertUrlAllowed(rawUrl: string): URL {
  const hosts = allowedHosts();
  if (hosts.length === 0) {
    throw new StepDispatchError(
      FAILURE_CODES.apiCallNotConfigured,
      "api_call steps are disabled: JOURNEY_API_CALL_ALLOWED_HOSTS is not configured",
      false,
    );
  }

  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new StepDispatchError(FAILURE_CODES.apiCallBlocked, `api_call url is not a valid URL`, false);
  }

  const insecureAllowed = process.env.JOURNEY_API_CALL_ALLOW_INSECURE === "true";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && insecureAllowed)) {
    throw new StepDispatchError(
      FAILURE_CODES.apiCallBlocked,
      `api_call url must use https (got '${url.protocol}')`,
      false,
    );
  }

  if (isBlockedAddressLiteral(url.hostname)) {
    throw new StepDispatchError(
      FAILURE_CODES.apiCallBlocked,
      "api_call url resolves to a loopback, link-local or private address",
      false,
    );
  }

  const host = url.hostname.toLowerCase();
  const permitted = hosts.some((h) => (h.startsWith(".") ? host === h.slice(1) || host.endsWith(h) : host === h));
  if (!permitted) {
    throw new StepDispatchError(
      FAILURE_CODES.apiCallBlocked,
      `api_call host '${host}' is not in JOURNEY_API_CALL_ALLOWED_HOSTS`,
      false,
    );
  }

  return url;
}

export interface ApiCallOutcome {
  status: number;
}

export type Fetcher = typeof fetch;

/**
 * Execute an `api_call` step's request. MUST be called outside a DB transaction.
 *
 * `Idempotency-Key` carries the queue messageId, so a retry of the same command
 * is de-duplicable by the receiver: the DB effect is exactly-once (the consumer
 * dedupes on messageId) but the HTTP call is at-least-once, and the key is how a
 * well-behaved endpoint collapses the duplicate.
 *
 * 4xx is the caller's fault and terminal; 429/5xx, timeouts and transport
 * errors are retryable so the queue can back off and finally DLQ.
 */
export async function performApiCall(
  request: ApiCallRequest,
  meta: { idempotencyKey: string; correlationId: string; tenantId: string },
  fetchImpl: Fetcher = fetch,
): Promise<ApiCallOutcome> {
  const url = assertUrlAllowed(request.url);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), request.timeoutMs);

  try {
    const res = await fetchImpl(url.toString(), {
      method: request.method,
      headers: {
        "content-type": "application/json",
        "x-correlation-id": meta.correlationId,
        "idempotency-key": meta.idempotencyKey,
        ...(request.headers ?? {}),
      },
      body: JSON.stringify(request.body ?? {}),
      signal: controller.signal,
    });

    if (res.status >= 200 && res.status < 300) return { status: res.status };
    if (res.status === 429 || res.status >= 500) {
      throw new StepDispatchError(
        FAILURE_CODES.apiCallUnavailable,
        `api_call endpoint returned ${res.status}`,
        true,
      );
    }
    throw new StepDispatchError(
      FAILURE_CODES.apiCallRejected,
      `api_call endpoint rejected the request with ${res.status}`,
      false,
    );
  } catch (err) {
    if (err instanceof StepDispatchError) throw err;
    const reason = err instanceof Error ? err.message : String(err);
    throw new StepDispatchError(
      FAILURE_CODES.apiCallUnavailable,
      `api_call transport failure: ${reason}`,
      true,
    );
  } finally {
    clearTimeout(timer);
  }
}
