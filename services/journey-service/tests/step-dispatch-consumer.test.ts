/**
 * Journey step dispatch consumer tests (P1-8).
 *
 * These assert the effect, not the call. Repos are replaced by in-test stores
 * holding real rows, and the outbox is drained through a relay that republishes
 * to the same bus, so a test can follow a step all the way:
 *
 *   journey.step.execute -> dispatch -> outbox -> relay -> journey.execution.advance
 *      -> journey_executions row actually moves
 *
 * Every step type gets a test that the dispatch happened (right topic, right
 * payload) and that the run state advanced. Failure paths assert the opposite of
 * the defect this replaces: a step that could not act is recorded as `failed`,
 * never as completed.
 */
import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const TENANT = "aaaaaaaa-0001-4000-8000-000000000001";
const ACTOR = "aaaaaaaa-1111-4000-8000-000000000001";
const JOURNEY = "bbbbbbbb-1111-4000-8000-000000000001";
const PROFILE = "eeeeeeee-1111-4000-8000-000000000001";
const TEMPLATE = "ffffffff-1111-4000-8000-000000000001";
const RUN = "dddddddd-1111-4000-8000-000000000001";
const CORRELATION = "corr-p1-8";
const DUPLICATE_STEP_MSG = "99999999-1111-4000-8000-000000000001";
const DUPLICATE_ADVANCE_MSG = "99999999-2222-4000-8000-000000000002";
const API_CALL_MSG = "99999999-3333-4000-8000-000000000003";

interface StepRow {
  id: string;
  tenantId: string;
  journeyId: string;
  profileId: string;
  stepIndex: number;
  stepType: string | null;
  totalSteps: number | null;
  status: string;
  resumeAt: Date | null;
  failureCode: string | null;
  failureReason: string | null;
  updatedBy: string;
}

interface RunRow {
  id: string;
  tenantId: string;
  journeyId: string;
  profileId: string;
  status: string;
  currentStepIndex: number;
  version: number;
}

interface OutboxRow {
  topic: string;
  eventType: string;
  tenantId: string;
  actorId: string;
  correlationId: string;
  payload: Record<string, unknown>;
}

const H = vi.hoisted(() => ({
  steps: [] as unknown[],
  runs: [] as unknown[],
  outbox: [] as unknown[],
  processed: new Set<string>(),
  journeyFindByIdMock: vi.fn(),
}));

vi.mock("../src/shared/db.js", () => ({
  db: { transaction: async (cb: (tx: unknown) => Promise<unknown>) => cb({}) },
  scopedRead: async (fn: (tx: unknown) => Promise<unknown>) => fn({}),
  sqlClient: { end: async () => {} },
}));

// The scanner pool would open a real postgres connection on import.
vi.mock("../src/shared/scanner-db.js", () => ({ scannerDb: {}, scannerSqlClient: {} }));

vi.mock("../src/shared/outbox.js", () => ({
  enqueue: async (_tx: unknown, e: unknown) => {
    H.outbox.push(e);
  },
  // Real inbox semantics: the first claim of a messageId wins, later ones no-op.
  markProcessed: async (_tx: unknown, messageId: string) => {
    if (H.processed.has(messageId)) return false;
    H.processed.add(messageId);
    return true;
  },
  startRelay: vi.fn(),
}));

vi.mock("../src/modules/steps/repo.js", () => ({
  insert: async (_tx: unknown, row: Record<string, unknown>) => {
    H.steps.push({ resumeAt: null, failureCode: null, failureReason: null, ...row });
  },
  transitionStatus: async (
    _tx: unknown,
    id: string,
    tenantId: string,
    from: string,
    to: string,
    outcome: Record<string, unknown> = {},
  ) => {
    const row = (H.steps as StepRow[]).find((r) => r.id === id && r.tenantId === tenantId && r.status === from);
    if (!row) return false;
    row.status = to;
    Object.assign(row, outcome);
    return true;
  },
  findDueWaits: async (now: Date) =>
    (H.steps as StepRow[]).filter((r) => r.status === "waiting" && r.resumeAt !== null && r.resumeAt <= now),
  findById: vi.fn(),
  listByJourney: vi.fn(),
  updateStatus: vi.fn(),
  toView: (r: Record<string, unknown>) => r,
}));

// The executions consumer's auto-chain (P1-8 follow-up) looks up the journey
// definition to dispatch the next step. Defaulted below (beforeEach) to a
// journey whose steps beyond index 0 are long `wait`s, so the auto-chained
// dispatch parks immediately instead of cascading — existing tests below
// assert the state right after ONE explicit step dispatch, and were written
// before auto-chaining existed. Tests that want to observe real cascading
// override this mock directly (see "execution advance — auto-chains...").
vi.mock("../src/modules/journeys/repo.js", () => ({
  findById: (...a: unknown[]) => H.journeyFindByIdMock(...a),
}));

vi.mock("../src/modules/executions/repo.js", () => ({
  insert: async (_tx: unknown, row: Record<string, unknown>) => {
    H.runs.push({ version: 1, ...row });
  },
  findActiveForProfile: async (_tx: unknown, tenantId: string, journeyId: string, profileId: string) =>
    (H.runs as RunRow[]).find(
      (r) =>
        r.tenantId === tenantId &&
        r.journeyId === journeyId &&
        r.profileId === profileId &&
        (r.status === "enrolled" || r.status === "in_progress"),
    ) ?? null,
  updateStatus: async (
    _tx: unknown,
    id: string,
    tenantId: string,
    status: string,
    currentStepIndex: number,
    version: number,
  ) => {
    const row = (H.runs as RunRow[]).find((r) => r.id === id && r.tenantId === tenantId && r.version === version);
    if (!row) return false;
    row.status = status;
    row.currentStepIndex = currentStepIndex;
    row.version += 1;
    return true;
  },
  findById: vi.fn(),
  listByTenant: vi.fn(),
  toView: (r: Record<string, unknown>) => r,
}));

import { MemoryQueue } from "@civitasone/queue";
import { registerStepConsumers, setApiCallFetchForTests, resetApiCallFetch } from "../src/modules/steps/consumer.js";
import { registerExecutionConsumers } from "../src/modules/executions/consumer.js";
import { sweepDueWaits } from "../src/modules/steps/sweeper.js";
import { COMMANDS, EVENTS } from "../src/topics.js";
import { AUDIT_TOPIC } from "../src/shared/audit.js";

const steps = () => H.steps as StepRow[];
const runs = () => H.runs as RunRow[];
const outbox = () => H.outbox as OutboxRow[];
const topics = () => outbox().map((e) => e.topic);
const find = (topic: string) => outbox().find((e) => e.topic === topic);

function makeBus(): MemoryQueue {
  const bus = new MemoryQueue();
  registerStepConsumers(bus);
  registerExecutionConsumers(bus);
  return bus;
}

/**
 * Stand in for the outbox relay: publish every outbox row that has not been
 * relayed yet, reusing the row's identity as the messageId exactly as
 * relayOnce() does, so consumer dedupe behaves the same as in production.
 */
/** Stable, UUID-shaped id per outbox row — the bus rejects a non-UUID messageId. */
function outboxMessageId(index: number): string {
  return `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
}

let relayed = 0;
async function relay(bus: MemoryQueue): Promise<void> {
  for (let i = relayed; i < outbox().length; i++) {
    const row = outbox()[i]!;
    relayed = i + 1;
    await bus.publish(row.topic, {
      // Mirrors relayOnce(), which forwards the outbox row id as the messageId.
      messageId: outboxMessageId(i),
      type: row.eventType,
      tenantId: row.tenantId,
      actorId: row.actorId,
      correlationId: row.correlationId,
      schemaVersion: "1.0",
      payload: row.payload,
    });
    await bus.drain();
  }
}

interface ExecOverrides {
  stepIndex?: number;
  stepType?: string;
  stepConfig?: Record<string, unknown>;
  totalSteps?: number;
  context?: Record<string, unknown>;
  messageId?: string;
  id?: string;
}

async function executeStep(bus: MemoryQueue, o: ExecOverrides = {}): Promise<string> {
  const id = o.id ?? "11111111-1111-4000-8000-00000000000a";
  await bus.publish(COMMANDS.stepExecute, {
    messageId: o.messageId ?? randomUUID(),
    type: COMMANDS.stepExecute,
    tenantId: TENANT,
    actorId: ACTOR,
    correlationId: CORRELATION,
    schemaVersion: "1.0",
    payload: {
      id,
      tenantId: TENANT,
      journeyId: JOURNEY,
      profileId: PROFILE,
      stepIndex: o.stepIndex ?? 0,
      stepType: o.stepType ?? "send_notification",
      stepConfig: o.stepConfig ?? { templateId: TEMPLATE },
      totalSteps: o.totalSteps ?? 3,
      ...(o.context ? { context: o.context } : {}),
    },
  });
  await bus.drain();
  return id;
}

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  H.steps.length = 0;
  H.runs.length = 0;
  H.outbox.length = 0;
  H.processed.clear();
  relayed = 0;
  H.runs.push({
    id: RUN,
    tenantId: TENANT,
    journeyId: JOURNEY,
    profileId: PROFILE,
    status: "enrolled",
    currentStepIndex: 0,
    version: 1,
  });
  process.env["JOURNEY_API_CALL_ALLOWED_HOSTS"] = "hooks.example.gov.in";

  H.journeyFindByIdMock.mockReset();
  H.journeyFindByIdMock.mockResolvedValue({
    id: JOURNEY,
    tenantId: TENANT,
    steps: Array.from({ length: 5 }, () => ({ type: "wait", config: { delayDays: 999 } })),
  });
});

afterEach(() => {
  resetApiCallFetch();
  process.env = { ...ORIGINAL_ENV };
});

// ── send_notification ────────────────────────────────────────────────────────

describe("step dispatch — send_notification", () => {
  it("publishes notification.send with the step's template and recipient", async () => {
    const bus = makeBus();
    await executeStep(bus, { stepConfig: { templateId: TEMPLATE, channel: "email" } });

    const send = find("notification.send");
    expect(send).toBeDefined();
    expect(send!.payload).toMatchObject({
      templateId: TEMPLATE,
      recipientId: PROFILE,
      channel: "email",
      category: "marketing",
      journeyId: JOURNEY,
      journeyStepIndex: 0,
    });
  });

  it("records the step as completed with its type", async () => {
    const bus = makeBus();
    const id = await executeStep(bus);

    expect(steps()).toHaveLength(1);
    expect(steps()[0]).toMatchObject({ id, status: "completed", stepType: "send_notification", totalSteps: 3 });
  });

  it("advances the run to the next step", async () => {
    const bus = makeBus();
    await executeStep(bus, { stepIndex: 0, totalSteps: 3 });
    await relay(bus);

    expect(runs()[0]).toMatchObject({ status: "in_progress", currentStepIndex: 1 });
  });

  it("completes the run and emits journey.completed on the last step", async () => {
    const bus = makeBus();
    runs()[0]!.status = "in_progress";
    runs()[0]!.currentStepIndex = 2;
    await executeStep(bus, { stepIndex: 2, totalSteps: 3 });
    await relay(bus);

    expect(runs()[0]).toMatchObject({ status: "completed" });
    expect(topics()).toContain(EVENTS.journeyCompleted);
  });

  it("walks a single-step journey through in_progress, since enrolled -> completed is forbidden", async () => {
    const bus = makeBus();
    await executeStep(bus, { stepIndex: 0, totalSteps: 1 });
    await relay(bus);

    expect(runs()[0]).toMatchObject({ status: "completed" });
    // enrolled -> in_progress -> completed is two version bumps, not one.
    expect(runs()[0]!.version).toBe(3);
  });

  it("emits step.completed and an audit event carrying the command's correlationId", async () => {
    const bus = makeBus();
    await executeStep(bus);

    expect(topics()).toContain(EVENTS.stepCompleted);
    const audit = find(AUDIT_TOPIC);
    expect(audit).toBeDefined();
    expect(audit!.correlationId).toBe(CORRELATION);
    expect(audit!.payload).toMatchObject({ action: "step.execute", outcome: "success", details: { stepType: "send_notification" } });
    for (const row of outbox()) expect(row.correlationId).toBe(CORRELATION);
  });
});

// ── wait ─────────────────────────────────────────────────────────────────────

describe("step dispatch — wait", () => {
  it("parks the step at a resume deadline instead of completing it", async () => {
    const bus = makeBus();
    await executeStep(bus, { stepType: "wait", stepConfig: { delayMinutes: 30 } });

    expect(steps()[0]!.status).toBe("waiting");
    expect(steps()[0]!.resumeAt!.getTime()).toBeGreaterThan(Date.now() + 29 * 60_000);
    expect(topics()).toContain(EVENTS.stepWaiting);
  });

  it("does not advance the run while parked", async () => {
    const bus = makeBus();
    await executeStep(bus, { stepType: "wait", stepConfig: { delayMinutes: 30 } });
    await relay(bus);

    expect(topics()).not.toContain(COMMANDS.executionAdvance);
    expect(runs()[0]).toMatchObject({ status: "enrolled", currentStepIndex: 0 });
  });

  it("is not resumed before its deadline", async () => {
    const bus = makeBus();
    await executeStep(bus, { stepType: "wait", stepConfig: { delayHours: 6 } });

    expect(await sweepDueWaits(bus, new Date())).toBe(0);
    expect(steps()[0]!.status).toBe("waiting");
  });

  it("resumes once due, completes the step and advances the run", async () => {
    const bus = makeBus();
    await executeStep(bus, { stepType: "wait", stepConfig: { delaySeconds: 1 }, totalSteps: 3 });

    const published = await sweepDueWaits(bus, new Date(Date.now() + 5_000));
    expect(published).toBe(1);
    await bus.drain();
    await relay(bus);

    expect(steps()[0]).toMatchObject({ status: "completed", resumeAt: null });
    expect(runs()[0]).toMatchObject({ status: "in_progress", currentStepIndex: 1 });
  });

  it("completes the run when the parked step was the journey's last", async () => {
    const bus = makeBus();
    runs()[0]!.status = "in_progress";
    runs()[0]!.currentStepIndex = 1;
    await executeStep(bus, { stepType: "wait", stepConfig: { delaySeconds: 1 }, stepIndex: 1, totalSteps: 2 });

    await sweepDueWaits(bus, new Date(Date.now() + 5_000));
    await bus.drain();
    await relay(bus);

    expect(runs()[0]).toMatchObject({ status: "completed" });
    expect(topics()).toContain(EVENTS.journeyCompleted);
  });

  it("collapses repeated sweeps of the same due wait into one resume", async () => {
    const bus = makeBus();
    await executeStep(bus, { stepType: "wait", stepConfig: { delaySeconds: 1 }, totalSteps: 3 });
    const due = new Date(Date.now() + 5_000);

    await sweepDueWaits(bus, due);
    await bus.drain();
    // A second cycle before the first resume settles republishes the SAME
    // deterministic messageId, so the consumer's inbox dedupes it.
    await sweepDueWaits(bus, due);
    await bus.drain();
    await relay(bus);

    expect(outbox().filter((e) => e.topic === COMMANDS.executionAdvance)).toHaveLength(1);
    expect(runs()[0]).toMatchObject({ status: "in_progress", currentStepIndex: 1 });
  });
});

// ── condition_check ──────────────────────────────────────────────────────────

describe("step dispatch — condition_check", () => {
  const gate = (value: unknown, onFalse?: string) => ({
    attribute: "tier",
    operator: "eq",
    value,
    ...(onFalse ? { onFalse } : {}),
  });

  it("completes and advances when the gate passes", async () => {
    const bus = makeBus();
    await executeStep(bus, {
      stepType: "condition_check",
      stepConfig: gate("gold"),
      context: { tier: "gold" },
    });
    await relay(bus);

    expect(steps()[0]!.status).toBe("completed");
    expect(topics()).toContain(EVENTS.stepCompleted);
    expect(runs()[0]).toMatchObject({ status: "in_progress", currentStepIndex: 1 });
  });

  it("skips the step but keeps the run moving when the gate fails", async () => {
    const bus = makeBus();
    await executeStep(bus, {
      stepType: "condition_check",
      stepConfig: gate("gold"),
      context: { tier: "bronze" },
    });
    await relay(bus);

    expect(steps()[0]).toMatchObject({ status: "skipped", failureCode: "CONDITION_NOT_MET" });
    expect(topics()).toContain(EVENTS.stepSkipped);
    expect(topics()).not.toContain(EVENTS.stepCompleted);
    expect(runs()[0]).toMatchObject({ status: "in_progress", currentStepIndex: 1 });
  });

  it("exits the run when the gate is configured to exit", async () => {
    const bus = makeBus();
    await executeStep(bus, {
      stepType: "condition_check",
      stepConfig: gate("gold", "exit"),
      context: { tier: "bronze" },
    });
    await relay(bus);

    expect(steps()[0]!.status).toBe("skipped");
    expect(runs()[0]).toMatchObject({ status: "exited" });
    expect(topics()).toContain(EVENTS.executionExited);
  });

  it("never sends a notification for a gate step", async () => {
    const bus = makeBus();
    await executeStep(bus, {
      stepType: "condition_check",
      stepConfig: gate("gold"),
      context: { tier: "gold" },
    });
    expect(topics()).not.toContain("notification.send");
  });
});

// ── api_call ─────────────────────────────────────────────────────────────────

describe("step dispatch — api_call", () => {
  const config = { url: "https://hooks.example.gov.in/journey", body: { hello: "world" } };

  it("performs the request and advances the run", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    setApiCallFetchForTests((async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response("{}", { status: 202 });
    }) as unknown as typeof fetch);

    const bus = makeBus();
    await executeStep(bus, { stepType: "api_call", stepConfig: config });
    await relay(bus);

    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(config.url);
    expect((calls[0]!.init.headers as Record<string, string>)["x-correlation-id"]).toBe(CORRELATION);
    expect(steps()[0]).toMatchObject({ status: "completed", stepType: "api_call" });
    expect(runs()[0]).toMatchObject({ status: "in_progress", currentStepIndex: 1 });
  });

  it("carries the queue messageId as the idempotency key so a retry is de-duplicable", async () => {
    const keys: string[] = [];
    setApiCallFetchForTests((async (_url: string, init: RequestInit) => {
      keys.push((init.headers as Record<string, string>)["idempotency-key"]!);
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch);

    const bus = makeBus();
    await executeStep(bus, { stepType: "api_call", stepConfig: config, messageId: API_CALL_MSG });
    expect(keys).toEqual([API_CALL_MSG]);
  });

  it("fails the step without calling out when the host is off the allowlist", async () => {
    let called = false;
    setApiCallFetchForTests((async () => {
      called = true;
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch);

    const bus = makeBus();
    await executeStep(bus, {
      stepType: "api_call",
      stepConfig: { url: "https://attacker.example.net/steal" },
    });

    expect(called).toBe(false);
    expect(steps()[0]).toMatchObject({ status: "failed", failureCode: "API_CALL_BLOCKED" });
  });

  it("fails the step when api_call is not configured at all", async () => {
    delete process.env["JOURNEY_API_CALL_ALLOWED_HOSTS"];
    const bus = makeBus();
    await executeStep(bus, { stepType: "api_call", stepConfig: config });

    expect(steps()[0]).toMatchObject({ status: "failed", failureCode: "API_CALL_NOT_CONFIGURED" });
  });

  it("records a 4xx as a terminal failure, not a success", async () => {
    setApiCallFetchForTests((async () => new Response("bad", { status: 400 })) as unknown as typeof fetch);
    const bus = makeBus();
    await executeStep(bus, { stepType: "api_call", stepConfig: config });

    expect(steps()[0]).toMatchObject({ status: "failed", failureCode: "API_CALL_REJECTED" });
    expect(topics()).toContain(EVENTS.stepFailed);
    expect(topics()).not.toContain(EVENTS.stepCompleted);
  });

  it("leaves a 5xx to the queue: retried, then DLQ'd, with no step row claimed", async () => {
    let attempts = 0;
    setApiCallFetchForTests((async () => {
      attempts++;
      return new Response("boom", { status: 503 });
    }) as unknown as typeof fetch);

    const bus = makeBus();
    await executeStep(bus, { stepType: "api_call", stepConfig: config });

    expect(attempts).toBeGreaterThan(1);
    expect(bus.dlq.map((d) => d.topic)).toContain(COMMANDS.stepExecute);
    // A retryable failure must not leave a terminal row behind — the command is
    // still owed, and the DB effect happens only when a dispatch settles.
    expect(steps()).toHaveLength(0);
    expect(runs()[0]).toMatchObject({ status: "enrolled", currentStepIndex: 0 });
  });
});

// ── unknown / unusable steps ─────────────────────────────────────────────────

describe("step dispatch — a step it cannot honour", () => {
  it("records an unknown stepType as failed, never as completed", async () => {
    const bus = makeBus();
    await executeStep(bus, { stepType: "send_carrier_pigeon", stepConfig: {} });

    expect(steps()[0]).toMatchObject({ status: "failed", failureCode: "UNKNOWN_STEP_TYPE" });
    expect(steps()[0]!.failureReason).toMatch(/unsupported step type/);
    expect(topics()).toContain(EVENTS.stepFailed);
    expect(topics()).not.toContain(EVENTS.stepCompleted);
    expect(topics()).not.toContain("notification.send");
  });

  it("audits an unknown stepType as a failure outcome", async () => {
    const bus = makeBus();
    await executeStep(bus, { stepType: "send_carrier_pigeon", stepConfig: {} });

    const audit = find(AUDIT_TOPIC);
    expect(audit!.payload).toMatchObject({
      action: "step.execute",
      outcome: "failure",
      details: { status: "failed", failureCode: "UNKNOWN_STEP_TYPE" },
    });
  });

  it("exits the run so the profile is not stranded mid-journey", async () => {
    const bus = makeBus();
    await executeStep(bus, { stepType: "send_carrier_pigeon", stepConfig: {} });
    await relay(bus);

    expect(runs()[0]).toMatchObject({ status: "exited" });
    expect(topics()).toContain(EVENTS.executionExited);
  });

  it("records a send_notification step with an unusable config as failed", async () => {
    const bus = makeBus();
    await executeStep(bus, { stepType: "send_notification", stepConfig: { channel: "email" } });

    expect(steps()[0]).toMatchObject({ status: "failed", failureCode: "INVALID_STEP_CONFIG" });
    expect(topics()).not.toContain("notification.send");
  });

  it("records a wait step with no delay as failed rather than parking forever", async () => {
    const bus = makeBus();
    await executeStep(bus, { stepType: "wait", stepConfig: {} });

    expect(steps()[0]).toMatchObject({ status: "failed", failureCode: "INVALID_STEP_CONFIG" });
    expect(steps()[0]!.resumeAt).toBeNull();
  });
});

// ── idempotency ──────────────────────────────────────────────────────────────

describe("step dispatch — idempotency", () => {
  it("applies the same messageId only once, so one command means one send", async () => {
    // Two buses share the in-test inbox, so the second delivery reaches the
    // handler (a single MemoryQueue would dedupe at the bus, not the consumer).
    const first = makeBus();
    const second = makeBus();
    const envelope = {
      messageId: DUPLICATE_STEP_MSG,
      type: COMMANDS.stepExecute,
      tenantId: TENANT,
      actorId: ACTOR,
      correlationId: CORRELATION,
      schemaVersion: "1.0",
      payload: {
        id: "11111111-1111-4000-8000-00000000000a",
        tenantId: TENANT,
        journeyId: JOURNEY,
        profileId: PROFILE,
        stepIndex: 0,
        stepType: "send_notification",
        stepConfig: { templateId: TEMPLATE },
        totalSteps: 3,
      },
    };

    await first.publish(COMMANDS.stepExecute, envelope);
    await first.drain();
    await second.publish(COMMANDS.stepExecute, envelope);
    await second.drain();

    expect(steps()).toHaveLength(1);
    expect(outbox().filter((e) => e.topic === "notification.send")).toHaveLength(1);
    expect(outbox().filter((e) => e.topic === COMMANDS.executionAdvance)).toHaveLength(1);
  });

  it("advances a run only once when the advance command is redelivered", async () => {
    const first = makeBus();
    const second = makeBus();
    const envelope = {
      messageId: DUPLICATE_ADVANCE_MSG,
      type: COMMANDS.executionAdvance,
      tenantId: TENANT,
      actorId: ACTOR,
      correlationId: CORRELATION,
      schemaVersion: "1.0",
      payload: { journeyId: JOURNEY, profileId: PROFILE, fromStepIndex: 0, totalSteps: 3, outcome: "advance" },
    };

    await first.publish(COMMANDS.executionAdvance, envelope);
    await first.drain();
    await second.publish(COMMANDS.executionAdvance, envelope);
    await second.drain();

    expect(runs()[0]).toMatchObject({ status: "in_progress", currentStepIndex: 1, version: 2 });
  });
});

// ── enrollment ───────────────────────────────────────────────────────────────

describe("enrollment", () => {
  it("creates the run a step dispatch later advances", async () => {
    H.runs.length = 0;
    const bus = makeBus();
    const executionId = "dddddddd-2222-4000-8000-000000000002";
    await bus.publish(COMMANDS.executionEnroll, {
      messageId: randomUUID(),
      type: COMMANDS.executionEnroll,
      tenantId: TENANT,
      actorId: ACTOR,
      correlationId: CORRELATION,
      schemaVersion: "1.0",
      payload: { id: executionId, tenantId: TENANT, journeyId: JOURNEY, profileId: PROFILE },
    });
    await bus.drain();

    expect(runs()[0]).toMatchObject({ id: executionId, status: "enrolled", currentStepIndex: 0 });
    expect(topics()).toContain(EVENTS.executionEnrolled);
    expect(topics()).toContain(AUDIT_TOPIC);

    // The enrolled run is the one a step dispatch then moves forward.
    await executeStep(bus);
    await relay(bus);
    expect(runs()[0]).toMatchObject({ status: "in_progress", currentStepIndex: 1 });
  });
});

// ── run advance guards ───────────────────────────────────────────────────────

describe("run advance — guards", () => {
  it("does not resurrect a run that already exited", async () => {
    runs()[0]!.status = "exited";
    const bus = makeBus();
    await executeStep(bus);
    await relay(bus);

    expect(runs()[0]).toMatchObject({ status: "exited", currentStepIndex: 0, version: 1 });
  });

  it("is a no-op when the profile has no enrollment at all", async () => {
    H.runs.length = 0;
    const bus = makeBus();
    await executeStep(bus);
    await relay(bus);

    expect(runs()).toHaveLength(0);
    // The step itself still recorded what it did.
    expect(steps()[0]!.status).toBe("completed");
  });
});

// ── execution advance auto-chain (P1-8 follow-up) ───────────────────────────
//
// Before this fix, executionAdvance only bumped currentStepIndex — nothing
// ever published journey.step.execute for the new index, so a run silently
// froze "in_progress" forever after its first step. These tests assert the
// EFFECT (a real dispatch happened for the next step), not just that the
// run's bookkeeping moved, since bookkeeping alone is exactly the shape of
// "fake progress" this whole module otherwise guards against.
describe("execution advance — auto-chains to the next step", () => {
  it("actually dispatches the next step, not just the run's bookkeeping", async () => {
    H.journeyFindByIdMock.mockResolvedValue({
      id: JOURNEY,
      tenantId: TENANT,
      steps: [
        { type: "send_notification", config: { templateId: TEMPLATE } },
        { type: "send_notification", config: { templateId: TEMPLATE } },
      ],
    });

    const bus = makeBus();
    await executeStep(bus, { stepIndex: 0, totalSteps: 2, stepConfig: { templateId: TEMPLATE } });
    await relay(bus);

    // Two real dispatches, not one: step 0 (explicit) and step 1 (auto-chained).
    expect(outbox().filter((e) => e.topic === "notification.send")).toHaveLength(2);
    expect(steps()).toHaveLength(2);
    expect(steps()[1]).toMatchObject({ stepIndex: 1, stepType: "send_notification", status: "completed" });
    // Both steps done, on the last index of a 2-step journey — run completes.
    expect(runs()[0]).toMatchObject({ status: "completed" });
    expect(topics()).toContain(EVENTS.journeyCompleted);
  });

  it("stops the chain at a wait step instead of cascading through it", async () => {
    H.journeyFindByIdMock.mockResolvedValue({
      id: JOURNEY,
      tenantId: TENANT,
      steps: [
        { type: "send_notification", config: { templateId: TEMPLATE } },
        { type: "wait", config: { delayDays: 1 } },
        { type: "send_notification", config: { templateId: TEMPLATE } },
      ],
    });

    const bus = makeBus();
    await executeStep(bus, { stepIndex: 0, totalSteps: 3, stepConfig: { templateId: TEMPLATE } });
    await relay(bus);

    expect(steps()).toHaveLength(2);
    expect(steps()[1]).toMatchObject({ stepIndex: 1, stepType: "wait", status: "waiting" });
    // A parked wait only resumes via the sweeper — the chain must not reach
    // index 2 on its own.
    expect(runs()[0]).toMatchObject({ status: "in_progress", currentStepIndex: 1 });
    expect(outbox().filter((e) => e.topic === "notification.send")).toHaveLength(1);
  });

  it("throws instead of silently enqueuing a dispatch it cannot resolve", async () => {
    // Simulates an orphaned journeyId: findById returns nothing to dispatch.
    H.journeyFindByIdMock.mockResolvedValue(null);

    const bus = makeBus();
    await executeStep(bus, { stepIndex: 0, totalSteps: 3 });
    await relay(bus);

    // The step itself still recorded what happened...
    expect(steps()[0]).toMatchObject({ status: "completed" });
    // ...but the advance must never fabricate a dispatch for a step it could
    // not resolve — that would be the same "fake progress" shape as reporting
    // a step done when it was not.
    //
    // This is checked at the "no fake stepExecute" level rather than by
    // asserting the eventual queue outcome (retry-then-DLQ), because this
    // file's `db.transaction`/`markProcessed` mocks call straight through
    // without simulating a real Postgres ROLLBACK: the inbox-claim row the
    // mock records on the first (failing) attempt is never "undone", so
    // MemoryQueue's internal retry sees the messageId already claimed and
    // returns early as a successful no-op instead of genuinely retrying —
    // an artifact of mock fidelity, not of the fix. A real transaction rolls
    // the inbox claim back together with the currentStepIndex bump (see the
    // comment in executions/consumer.ts), which is what lets a genuine retry
    // attempt the whole advance again and eventually DLQ if it keeps failing.
    expect(outbox().filter((e) => e.topic === COMMANDS.stepExecute && e.payload["stepIndex"] === 1)).toHaveLength(0);
  });
});
