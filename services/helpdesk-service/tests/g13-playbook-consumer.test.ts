/**
 * G13 Resolution Playbooks — consumer tests (src/modules/playbooks/consumer.ts).
 *
 * Handlers are invoked DIRECTLY rather than through queue.publish(), because
 * MemoryQueue dedupes on (topic, messageId) before a handler ever runs — so a
 * redelivery, the thing idempotency is actually about, cannot be simulated
 * through the queue. Each call is wrapped in runWithTenant() exactly as
 * tenantScoped() does in production, so the FORCE-RLS policies see the same
 * app.tenant_id GUC.
 *
 * What is asserted here:
 *   - markProcessed(tx, msg.messageId) really is the first statement in every
 *     handler's transaction, so a redelivery is a complete no-op (structural
 *     check + behavioural check per handler).
 *   - tenant isolation: a handler carrying tenant B's id cannot read or write
 *     tenant A's playbooks, runs or steps.
 *   - the outbox event is enqueued in the SAME transaction as the business
 *     write (and is absent when the write did not happen).
 *   - run-step outcome recording: who completed what, when, and that a second
 *     attempt never overwrites the first actor/timestamp.
 *   - VERSION PINNING: a run keeps working against the playbook version it
 *     started under even after a newer version of the same key is published.
 *
 * TEST HYGIENE: every tenant id is a fresh randomUUID() minted by this file and
 * teardown deletes only rows carrying one of those ids (plus the _inbox rows for
 * the message ids this file generated). Nothing is truncated.
 */
import { describe, it, expect, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve as resolvePath } from "node:path";
import { and, eq, inArray } from "drizzle-orm";
import { runWithTenant } from "@civitasone/db";
import type { CommandEnvelope, Handler, PublishInput, Queue } from "@civitasone/queue";
import { db, sqlClient } from "../src/shared/db.js";
import { tickets } from "../src/modules/tickets/schema.js";
import { playbooks, playbookRuns, playbookRunSteps } from "../src/modules/playbooks/schema.js";
import { outboxSchema } from "../src/shared/outbox.js";
import { COMMANDS, EVENTS } from "../src/topics.js";
import type { PlaybookStep } from "../src/modules/playbooks/domain.js";
import {
  handlePlaybookCreate,
  handlePlaybookDeprecate,
  handlePlaybookPublish,
  handlePlaybookUpdate,
  handleRunComplete,
  handleRunStart,
  handleStepComplete,
  handleTicketCreatedAutoAttach,
  registerPlaybookConsumers,
  ticketMatchesPlaybook,
  type PlaybookCreatePayload,
  type PlaybookLifecyclePayload,
  type PlaybookUpdatePayload,
  type RunCompletePayload,
  type RunStartPayload,
  type StepCompletePayload,
  type TicketCreatedPayload,
} from "../src/modules/playbooks/consumer.js";

const { outboxMessages, processed } = outboxSchema;
const AUDIT_TOPIC = "audit.event.record";

const ACTOR = randomUUID();
const OTHER_ACTOR = randomUUID();

/** Every tenant and message id this file created, so teardown stays scoped. */
const tenants = new Set<string>();
const messageIds = new Set<string>();

function freshTenant(): string {
  const t = randomUUID();
  tenants.add(t);
  return t;
}

function msgId(): string {
  const id = randomUUID();
  messageIds.add(id);
  return id;
}

// ── envelope + delivery helpers ─────────────────────────────────────────────

function envelope<T>(
  type: string,
  tenantId: string,
  payload: T,
  opts: { messageId?: string; actorId?: string } = {},
): CommandEnvelope<T> {
  return {
    messageId: opts.messageId ?? msgId(),
    type,
    tenantId,
    actorId: opts.actorId ?? ACTOR,
    correlationId: `corr-${randomUUID().slice(0, 8)}`,
    timestamp: new Date().toISOString(),
    schemaVersion: "1.0",
    payload,
  };
}

/** Deliver exactly as tenantScoped() would: handler inside the tenant context. */
function deliver<T>(handler: (m: CommandEnvelope<T>) => Promise<void>, msg: CommandEnvelope<T>): Promise<void> {
  return runWithTenant(msg.tenantId, () => handler(msg));
}

// ── read helpers ────────────────────────────────────────────────────────────

interface OutboxRow {
  eventType: string;
  payload: Record<string, unknown>;
}

function outboxFor(tenantId: string): Promise<OutboxRow[]> {
  return runWithTenant(tenantId, () =>
    db.transaction((tx) =>
      tx
        .select({ eventType: outboxMessages.eventType, payload: outboxMessages.payload })
        .from(outboxMessages)
        .where(eq(outboxMessages.tenantId, tenantId)),
    ),
  );
}

/** The `outcome` values audited for one action, in insertion-independent form. */
async function auditOutcomes(tenantId: string, action: string): Promise<string[]> {
  const rows = await outboxFor(tenantId);
  return rows
    .filter((r) => r.eventType === AUDIT_TOPIC && r.payload.action === action)
    .map((r) => String(r.payload.outcome));
}

async function eventsOfType(tenantId: string, eventType: string): Promise<Array<Record<string, unknown>>> {
  const rows = await outboxFor(tenantId);
  return rows.filter((r) => r.eventType === eventType).map((r) => r.payload);
}

function readPlaybook(tenantId: string, id: string) {
  return runWithTenant(tenantId, () =>
    db.transaction((tx) =>
      tx.select().from(playbooks).where(and(eq(playbooks.id, id), eq(playbooks.tenantId, tenantId))),
    ),
  );
}

function readRuns(tenantId: string) {
  return runWithTenant(tenantId, () =>
    db.transaction((tx) => tx.select().from(playbookRuns).where(eq(playbookRuns.tenantId, tenantId))),
  );
}

function readRunSteps(tenantId: string, runId: string) {
  return runWithTenant(tenantId, () =>
    db.transaction((tx) =>
      tx
        .select()
        .from(playbookRunSteps)
        .where(and(eq(playbookRunSteps.tenantId, tenantId), eq(playbookRunSteps.runId, runId))),
    ),
  );
}

// ── fixtures ────────────────────────────────────────────────────────────────

function step(overrides: Partial<PlaybookStep> = {}): PlaybookStep {
  return {
    id: "s1",
    ordinal: 1,
    type: "task",
    title: "Trace the consignment",
    body: "Look up the consignment in the tracking system.",
    mandatory: false,
    slaOffsetMinutes: null,
    knowledgeArticleId: null,
    ...overrides,
  };
}

function createPayload(
  tenantId: string,
  overrides: Partial<PlaybookCreatePayload> = {},
): PlaybookCreatePayload {
  return {
    tenantId,
    id: randomUUID(),
    playbookKey: `pb-${randomUUID().slice(0, 8)}`,
    name: "Speed Post delay",
    description: null,
    versionNumber: 1,
    categoryId: null,
    productCode: null,
    ticketType: null,
    priority: null,
    steps: [step()],
    ...overrides,
  };
}

/** Create + publish a playbook through the real handlers. */
async function publishedPlaybook(
  tenantId: string,
  overrides: Partial<PlaybookCreatePayload> = {},
): Promise<PlaybookCreatePayload> {
  const p = createPayload(tenantId, overrides);
  await deliver(handlePlaybookCreate, envelope(COMMANDS.playbookCreate, tenantId, p));
  await deliver<PlaybookLifecyclePayload>(
    handlePlaybookPublish,
    envelope(COMMANDS.playbookPublish, tenantId, { tenantId, id: p.id }),
  );
  return p;
}

async function seedTicket(
  tenantId: string,
  opts: { productCode?: string; ticketType?: string; priority?: string } = {},
): Promise<string> {
  tenants.add(tenantId);
  const id = randomUUID();
  await runWithTenant(tenantId, () =>
    db.transaction((tx) =>
      tx.insert(tickets).values({
        id,
        tenantId,
        subject: `g13 consumer ticket ${id.slice(0, 8)}`,
        description: null,
        priority: opts.priority ?? "Medium",
        status: "open",
        ticketType: opts.ticketType ?? null,
        ...(opts.productCode ? { typeFields: { productCode: opts.productCode } } : {}),
        createdBy: ACTOR,
        updatedBy: ACTOR,
      }),
    ),
  );
  return id;
}

// ── teardown ────────────────────────────────────────────────────────────────

afterAll(async () => {
  for (const tenantId of tenants) {
    await runWithTenant(tenantId, () =>
      db.transaction(async (tx) => {
        await tx.delete(playbookRunSteps).where(eq(playbookRunSteps.tenantId, tenantId));
        await tx.delete(playbookRuns).where(eq(playbookRuns.tenantId, tenantId));
        await tx.delete(playbooks).where(eq(playbooks.tenantId, tenantId));
        await tx.delete(tickets).where(eq(tickets.tenantId, tenantId));
        await tx.delete(outboxMessages).where(eq(outboxMessages.tenantId, tenantId));
      }),
    );
  }
  if (messageIds.size > 0) {
    await db.delete(processed).where(inArray(processed.messageId, [...messageIds]));
  }
  await sqlClient.end();
});

// ── structural: markProcessed is the first statement in every transaction ────

describe("idempotency contract — markProcessed is the first transaction statement", () => {
  it("every db.transaction in consumer.ts opens with the markProcessed guard", () => {
    const src = readFileSync(
      resolvePath(__dirname, "../src/modules/playbooks/consumer.ts"),
      "utf8",
    ).split("\n");
    const opens = src
      .map((line, i) => ({ line: line.trim(), i }))
      .filter((l) => l.line.startsWith("await db.transaction(async (tx) => {"));
    expect(opens.length).toBeGreaterThanOrEqual(7);
    for (const open of opens) {
      const next = (src[open.i + 1] ?? "").trim();
      expect(next, `line ${open.i + 2} of consumer.ts`).toBe(
        "if (!(await markProcessed(tx, msg.messageId))) return;",
      );
    }
  });

  it("registers a handler for every playbook command plus the ticket.created event", () => {
    const recorded: string[] = [];
    const fake: Queue = {
      publish: <T>(_topic: string, _input: PublishInput<T>): Promise<string> =>
        Promise.resolve(randomUUID()),
      subscribe: <T>(topic: string, _handler: Handler<T>): void => {
        recorded.push(topic);
      },
      start: (): Promise<void> => Promise.resolve(),
      stop: (): Promise<void> => Promise.resolve(),
      healthCheck: () => Promise.resolve({ healthy: true, driver: "memory" as const }),
    };
    registerPlaybookConsumers(fake);
    expect(recorded).toEqual([
      COMMANDS.playbookCreate,
      COMMANDS.playbookUpdate,
      COMMANDS.playbookPublish,
      COMMANDS.playbookDeprecate,
      COMMANDS.playbookRunStart,
      COMMANDS.playbookStepComplete,
      COMMANDS.playbookRunComplete,
      EVENTS.ticketCreated,
    ]);
  });
});

// ── playbook lifecycle handlers ─────────────────────────────────────────────

describe("handlePlaybookCreate", () => {
  it("inserts a draft, normalises step ordinals and audits the creation", async () => {
    const tenantId = freshTenant();
    const p = createPayload(tenantId, {
      steps: [step({ id: "b", ordinal: 70 }), step({ id: "a", ordinal: 30, mandatory: true })],
    });
    await deliver(handlePlaybookCreate, envelope(COMMANDS.playbookCreate, tenantId, p));

    const rows = await readPlaybook(tenantId, p.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe("draft");
    expect(rows[0]!.publishedAt).toBeNull();
    expect(rows[0]!.steps.map((s) => [s.id, s.ordinal])).toEqual([
      ["a", 1],
      ["b", 2],
    ]);
    expect(await auditOutcomes(tenantId, "create_playbook")).toEqual(["success"]);
  });

  it("a redelivery of the same messageId is a complete no-op", async () => {
    const tenantId = freshTenant();
    const p = createPayload(tenantId);
    const msg = envelope(COMMANDS.playbookCreate, tenantId, p);

    await deliver(handlePlaybookCreate, msg);
    await deliver(handlePlaybookCreate, msg);

    expect(await readPlaybook(tenantId, p.id)).toHaveLength(1);
    // No second audit row: the redelivery never reached the business write.
    expect(await auditOutcomes(tenantId, "create_playbook")).toEqual(["success"]);
  });

  it("a DIFFERENT message colliding on (key, version) is audited as rejected, not retried", async () => {
    const tenantId = freshTenant();
    const key = `dup-${randomUUID().slice(0, 8)}`;
    const first = createPayload(tenantId, { playbookKey: key, versionNumber: 1 });
    await deliver(handlePlaybookCreate, envelope(COMMANDS.playbookCreate, tenantId, first));

    const clash = createPayload(tenantId, { playbookKey: key, versionNumber: 1 });
    await deliver(handlePlaybookCreate, envelope(COMMANDS.playbookCreate, tenantId, clash));

    // Only the first row exists…
    const all = await runWithTenant(tenantId, () =>
      db.transaction((tx) => tx.select().from(playbooks).where(eq(playbooks.tenantId, tenantId))),
    );
    expect(all).toHaveLength(1);
    expect(all[0]!.id).toBe(first.id);
    // …and the duplicate was recorded as a rejected command rather than thrown.
    expect((await auditOutcomes(tenantId, "create_playbook")).sort()).toEqual([
      "rejected_duplicate",
      "success",
    ]);
  });
});

describe("handlePlaybookUpdate", () => {
  it("applies the patch, bumps version and audits success", async () => {
    const tenantId = freshTenant();
    const p = createPayload(tenantId);
    await deliver(handlePlaybookCreate, envelope(COMMANDS.playbookCreate, tenantId, p));

    await deliver<PlaybookUpdatePayload>(
      handlePlaybookUpdate,
      envelope(COMMANDS.playbookUpdate, tenantId, {
        tenantId,
        id: p.id,
        name: "Speed Post delay (revised)",
        description: "revised wording",
        productCode: "SPEED_POST",
        ticketType: "incident",
        priority: "high",
        categoryId: null,
        expectedVersion: 1,
        steps: [step({ id: "z", ordinal: 9 })],
      }),
    );

    const row = (await readPlaybook(tenantId, p.id))[0]!;
    expect(row.name).toBe("Speed Post delay (revised)");
    expect(row.productCode).toBe("SPEED_POST");
    expect(row.ticketType).toBe("incident");
    expect(row.priority).toBe("high");
    expect(row.version).toBe(2);
    expect(row.steps.map((s) => s.id)).toEqual(["z"]);
    expect(await auditOutcomes(tenantId, "update_playbook")).toEqual(["success"]);
  });

  it("a stale expectedVersion matches no row and is audited as version_conflict", async () => {
    const tenantId = freshTenant();
    const p = createPayload(tenantId);
    await deliver(handlePlaybookCreate, envelope(COMMANDS.playbookCreate, tenantId, p));

    await deliver<PlaybookUpdatePayload>(
      handlePlaybookUpdate,
      envelope(COMMANDS.playbookUpdate, tenantId, {
        tenantId,
        id: p.id,
        name: "stale write",
        expectedVersion: 99,
      }),
    );

    const row = (await readPlaybook(tenantId, p.id))[0]!;
    expect(row.name).toBe("Speed Post delay");
    expect(row.version).toBe(1);
    expect(await auditOutcomes(tenantId, "update_playbook")).toEqual(["version_conflict"]);
  });

  it("is idempotent on redelivery — the version is bumped once, not twice", async () => {
    const tenantId = freshTenant();
    const p = createPayload(tenantId);
    await deliver(handlePlaybookCreate, envelope(COMMANDS.playbookCreate, tenantId, p));
    const msg = envelope<PlaybookUpdatePayload>(COMMANDS.playbookUpdate, tenantId, {
      tenantId,
      id: p.id,
      name: "once only",
    });

    await deliver(handlePlaybookUpdate, msg);
    await deliver(handlePlaybookUpdate, msg);

    expect((await readPlaybook(tenantId, p.id))[0]!.version).toBe(2);
    expect(await auditOutcomes(tenantId, "update_playbook")).toEqual(["success"]);
  });

  it("TENANT ISOLATION: a message carrying another tenant's id cannot patch the owner's row", async () => {
    const owner = freshTenant();
    const stranger = freshTenant();
    const p = createPayload(owner);
    await deliver(handlePlaybookCreate, envelope(COMMANDS.playbookCreate, owner, p));

    await deliver<PlaybookUpdatePayload>(
      handlePlaybookUpdate,
      envelope(COMMANDS.playbookUpdate, stranger, {
        tenantId: stranger,
        id: p.id,
        name: "cross-tenant write",
      }),
    );

    expect((await readPlaybook(owner, p.id))[0]!.name).toBe("Speed Post delay");
    expect(await auditOutcomes(stranger, "update_playbook")).toEqual(["version_conflict"]);
  });
});

describe("handlePlaybookPublish / handlePlaybookDeprecate", () => {
  it("publish stamps status + publishedAt from the payload and audits success", async () => {
    const tenantId = freshTenant();
    const p = createPayload(tenantId);
    await deliver(handlePlaybookCreate, envelope(COMMANDS.playbookCreate, tenantId, p));
    const publishedAt = "2026-03-01T10:00:00.000Z";

    await deliver<PlaybookLifecyclePayload>(
      handlePlaybookPublish,
      envelope(COMMANDS.playbookPublish, tenantId, { tenantId, id: p.id, publishedAt }),
    );

    const row = (await readPlaybook(tenantId, p.id))[0]!;
    expect(row.status).toBe("published");
    expect(row.publishedAt?.toISOString()).toBe(publishedAt);
    expect(await auditOutcomes(tenantId, "publish_playbook")).toEqual(["success"]);
  });

  it("publish defaults publishedAt to now when the payload omits it", async () => {
    const tenantId = freshTenant();
    const p = createPayload(tenantId);
    await deliver(handlePlaybookCreate, envelope(COMMANDS.playbookCreate, tenantId, p));
    const before = Date.now() - 1000;

    await deliver<PlaybookLifecyclePayload>(
      handlePlaybookPublish,
      envelope(COMMANDS.playbookPublish, tenantId, { tenantId, id: p.id }),
    );

    const row = (await readPlaybook(tenantId, p.id))[0]!;
    expect(row.publishedAt).not.toBeNull();
    expect(row.publishedAt!.getTime()).toBeGreaterThanOrEqual(before);
  });

  it("publish on a stale expectedVersion is audited as version_conflict and changes nothing", async () => {
    const tenantId = freshTenant();
    const p = createPayload(tenantId);
    await deliver(handlePlaybookCreate, envelope(COMMANDS.playbookCreate, tenantId, p));

    await deliver<PlaybookLifecyclePayload>(
      handlePlaybookPublish,
      envelope(COMMANDS.playbookPublish, tenantId, { tenantId, id: p.id, expectedVersion: 42 }),
    );

    expect((await readPlaybook(tenantId, p.id))[0]!.status).toBe("draft");
    expect(await auditOutcomes(tenantId, "publish_playbook")).toEqual(["version_conflict"]);
  });

  it("publish is idempotent on redelivery", async () => {
    const tenantId = freshTenant();
    const p = createPayload(tenantId);
    await deliver(handlePlaybookCreate, envelope(COMMANDS.playbookCreate, tenantId, p));
    const msg = envelope<PlaybookLifecyclePayload>(COMMANDS.playbookPublish, tenantId, {
      tenantId,
      id: p.id,
    });

    await deliver(handlePlaybookPublish, msg);
    await deliver(handlePlaybookPublish, msg);

    expect((await readPlaybook(tenantId, p.id))[0]!.version).toBe(2);
    expect(await auditOutcomes(tenantId, "publish_playbook")).toEqual(["success"]);
  });

  it("deprecate retires a published playbook and audits success", async () => {
    const tenantId = freshTenant();
    const p = await publishedPlaybook(tenantId);

    await deliver<PlaybookLifecyclePayload>(
      handlePlaybookDeprecate,
      envelope(COMMANDS.playbookDeprecate, tenantId, { tenantId, id: p.id }),
    );

    expect((await readPlaybook(tenantId, p.id))[0]!.status).toBe("deprecated");
    expect(await auditOutcomes(tenantId, "deprecate_playbook")).toEqual(["success"]);
  });

  it("deprecate on a stale expectedVersion is audited as version_conflict", async () => {
    const tenantId = freshTenant();
    const p = await publishedPlaybook(tenantId);

    await deliver<PlaybookLifecyclePayload>(
      handlePlaybookDeprecate,
      envelope(COMMANDS.playbookDeprecate, tenantId, { tenantId, id: p.id, expectedVersion: 1 }),
    );

    expect((await readPlaybook(tenantId, p.id))[0]!.status).toBe("published");
    expect(await auditOutcomes(tenantId, "deprecate_playbook")).toEqual(["version_conflict"]);
  });

  it("deprecate is idempotent on redelivery", async () => {
    const tenantId = freshTenant();
    const p = await publishedPlaybook(tenantId);
    const msg = envelope<PlaybookLifecyclePayload>(COMMANDS.playbookDeprecate, tenantId, {
      tenantId,
      id: p.id,
    });

    await deliver(handlePlaybookDeprecate, msg);
    await deliver(handlePlaybookDeprecate, msg);

    // create → publish → deprecate = 3 writes, so version 3 (not 4).
    expect((await readPlaybook(tenantId, p.id))[0]!.version).toBe(3);
    expect(await auditOutcomes(tenantId, "deprecate_playbook")).toEqual(["success"]);
  });
});

// ── run start ───────────────────────────────────────────────────────────────

describe("handleRunStart", () => {
  it("creates the run, snapshots its step rows and enqueues run_started + audit", async () => {
    const tenantId = freshTenant();
    const pb = await publishedPlaybook(tenantId, {
      steps: [
        step({ id: "a", ordinal: 1, mandatory: true, slaOffsetMinutes: 30 }),
        step({ id: "b", ordinal: 2, type: "knowledge_link", knowledgeArticleId: randomUUID() }),
      ],
    });
    const ticketId = await seedTicket(tenantId);
    const runId = randomUUID();

    await deliver<RunStartPayload>(
      handleRunStart,
      envelope(COMMANDS.playbookRunStart, tenantId, { tenantId, runId, playbookId: pb.id, ticketId }),
    );

    const runs = await readRuns(tenantId);
    expect(runs).toHaveLength(1);
    expect(runs[0]!.id).toBe(runId);
    expect(runs[0]!.status).toBe("in_progress");
    expect(runs[0]!.autoAttached).toBe(false);
    expect(runs[0]!.playbookVersionNumber).toBe(1);
    expect(runs[0]!.progressPct).toBe(0);

    const steps = await readRunSteps(tenantId, runId);
    expect(steps.map((s) => s.stepId).sort()).toEqual(["a", "b"]);
    const a = steps.find((s) => s.stepId === "a")!;
    expect(a.mandatory).toBe(true);
    expect(a.slaOffsetMinutes).toBe(30);
    expect(a.completedAt).toBeNull();
    expect(steps.find((s) => s.stepId === "b")!.stepType).toBe("knowledge_link");

    const started = await eventsOfType(tenantId, EVENTS.playbookRunStarted);
    expect(started).toHaveLength(1);
    expect(started[0]).toMatchObject({
      runId,
      playbookId: pb.id,
      playbookKey: pb.playbookKey,
      playbookVersionNumber: 1,
      ticketId,
      stepCount: 2,
      mandatoryStepCount: 1,
      autoAttached: false,
    });
    expect(await auditOutcomes(tenantId, "start_playbook_run")).toEqual(["success"]);
  });

  it("a redelivery of the same messageId creates no second run and no second event", async () => {
    const tenantId = freshTenant();
    const pb = await publishedPlaybook(tenantId);
    const ticketId = await seedTicket(tenantId);
    const msg = envelope<RunStartPayload>(COMMANDS.playbookRunStart, tenantId, {
      tenantId,
      runId: randomUUID(),
      playbookId: pb.id,
      ticketId,
    });

    await deliver(handleRunStart, msg);
    await deliver(handleRunStart, msg);

    expect(await readRuns(tenantId)).toHaveLength(1);
    expect(await eventsOfType(tenantId, EVENTS.playbookRunStarted)).toHaveLength(1);
  });

  it("a DIFFERENT message for a ticket that already has a run is audited already_attached", async () => {
    const tenantId = freshTenant();
    const pb = await publishedPlaybook(tenantId);
    const ticketId = await seedTicket(tenantId);
    await deliver<RunStartPayload>(
      handleRunStart,
      envelope(COMMANDS.playbookRunStart, tenantId, {
        tenantId,
        runId: randomUUID(),
        playbookId: pb.id,
        ticketId,
      }),
    );

    await deliver<RunStartPayload>(
      handleRunStart,
      envelope(COMMANDS.playbookRunStart, tenantId, {
        tenantId,
        runId: randomUUID(),
        playbookId: pb.id,
        ticketId,
      }),
    );

    expect(await readRuns(tenantId)).toHaveLength(1);
    expect((await auditOutcomes(tenantId, "start_playbook_run")).sort()).toEqual([
      "already_attached",
      "success",
    ]);
    expect(await eventsOfType(tenantId, EVENTS.playbookRunStarted)).toHaveLength(1);
  });

  it("a playbook that vanished between accept and processing is audited playbook_missing", async () => {
    const tenantId = freshTenant();
    const ticketId = await seedTicket(tenantId);

    await deliver<RunStartPayload>(
      handleRunStart,
      envelope(COMMANDS.playbookRunStart, tenantId, {
        tenantId,
        runId: randomUUID(),
        playbookId: randomUUID(),
        ticketId,
      }),
    );

    expect(await readRuns(tenantId)).toEqual([]);
    expect(await auditOutcomes(tenantId, "start_playbook_run")).toEqual(["playbook_missing"]);
    expect(await eventsOfType(tenantId, EVENTS.playbookRunStarted)).toEqual([]);
  });

  it("TENANT ISOLATION: tenant B cannot start a run against tenant A's playbook", async () => {
    const owner = freshTenant();
    const stranger = freshTenant();
    const pb = await publishedPlaybook(owner);
    const ticketId = await seedTicket(stranger);

    await deliver<RunStartPayload>(
      handleRunStart,
      envelope(COMMANDS.playbookRunStart, stranger, {
        tenantId: stranger,
        runId: randomUUID(),
        playbookId: pb.id,
        ticketId,
      }),
    );

    expect(await readRuns(stranger)).toEqual([]);
    expect(await readRuns(owner)).toEqual([]);
    expect(await auditOutcomes(stranger, "start_playbook_run")).toEqual(["playbook_missing"]);
  });

  it("a zero-step playbook starts its run at 100% — nothing is outstanding", async () => {
    const tenantId = freshTenant();
    // Published directly: canPublish() would refuse an empty draft at the route,
    // but the consumer must still behave if a version ends up with no steps.
    const p = createPayload(tenantId, { steps: [] });
    await deliver(handlePlaybookCreate, envelope(COMMANDS.playbookCreate, tenantId, p));
    await deliver<PlaybookLifecyclePayload>(
      handlePlaybookPublish,
      envelope(COMMANDS.playbookPublish, tenantId, { tenantId, id: p.id }),
    );
    const ticketId = await seedTicket(tenantId);
    const runId = randomUUID();

    await deliver<RunStartPayload>(
      handleRunStart,
      envelope(COMMANDS.playbookRunStart, tenantId, { tenantId, runId, playbookId: p.id, ticketId }),
    );

    const runs = await readRuns(tenantId);
    expect(runs[0]!.progressPct).toBe(100);
    expect(await readRunSteps(tenantId, runId)).toEqual([]);
  });
});

// ── step completion (run-step outcome recording) ─────────────────────────────

describe("handleStepComplete", () => {
  async function startedRun(
    tenantId: string,
    steps: PlaybookStep[],
  ): Promise<{ runId: string; ticketId: string; playbookId: string }> {
    const pb = await publishedPlaybook(tenantId, { steps });
    const ticketId = await seedTicket(tenantId);
    const runId = randomUUID();
    await deliver<RunStartPayload>(
      handleRunStart,
      envelope(COMMANDS.playbookRunStart, tenantId, { tenantId, runId, playbookId: pb.id, ticketId }),
    );
    return { runId, ticketId, playbookId: pb.id };
  }

  it("records the outcome (actor, timestamp, note), recomputes progress and emits the event", async () => {
    const tenantId = freshTenant();
    const { runId, ticketId } = await startedRun(tenantId, [
      step({ id: "a", ordinal: 1, mandatory: true }),
      step({ id: "b", ordinal: 2, mandatory: false }),
    ]);

    await deliver<StepCompletePayload>(
      handleStepComplete,
      envelope(
        COMMANDS.playbookStepComplete,
        tenantId,
        { tenantId, runId, stepId: "a", note: "traced, delivery attempted twice" },
        { actorId: OTHER_ACTOR },
      ),
    );

    const steps = await readRunSteps(tenantId, runId);
    const a = steps.find((s) => s.stepId === "a")!;
    expect(a.completedBy).toBe(OTHER_ACTOR);
    expect(a.completedAt).not.toBeNull();
    expect(a.note).toBe("traced, delivery attempted twice");
    expect(steps.find((s) => s.stepId === "b")!.completedAt).toBeNull();

    // 1 of 2 done → floor(50) and the run row is updated to match.
    expect((await readRuns(tenantId))[0]!.progressPct).toBe(50);

    const events = await eventsOfType(tenantId, EVENTS.playbookStepCompleted);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      runId,
      ticketId,
      stepId: "a",
      ordinal: 1,
      mandatory: true,
      progressPct: 50,
      completedBy: OTHER_ACTOR,
    });
    expect(await auditOutcomes(tenantId, "complete_playbook_step")).toEqual(["success"]);
  });

  it("a redelivery of the same messageId neither re-stamps the step nor re-emits the event", async () => {
    const tenantId = freshTenant();
    const { runId } = await startedRun(tenantId, [step({ id: "a", ordinal: 1, mandatory: true })]);
    const msg = envelope<StepCompletePayload>(COMMANDS.playbookStepComplete, tenantId, {
      tenantId,
      runId,
      stepId: "a",
      note: "first",
    });

    await deliver(handleStepComplete, msg);
    const firstStamp = (await readRunSteps(tenantId, runId))[0]!.completedAt;
    await deliver(handleStepComplete, msg);

    const after = (await readRunSteps(tenantId, runId))[0]!;
    expect(after.completedAt?.toISOString()).toBe(firstStamp?.toISOString());
    expect(after.note).toBe("first");
    expect(await eventsOfType(tenantId, EVENTS.playbookStepCompleted)).toHaveLength(1);
    expect(await auditOutcomes(tenantId, "complete_playbook_step")).toEqual(["success"]);
  });

  it("a DIFFERENT message for an already-complete step keeps the original actor and emits nothing", async () => {
    const tenantId = freshTenant();
    const { runId } = await startedRun(tenantId, [step({ id: "a", ordinal: 1, mandatory: true })]);
    await deliver<StepCompletePayload>(
      handleStepComplete,
      envelope(COMMANDS.playbookStepComplete, tenantId, {
        tenantId,
        runId,
        stepId: "a",
        note: "original",
      }),
    );

    await deliver<StepCompletePayload>(
      handleStepComplete,
      envelope(
        COMMANDS.playbookStepComplete,
        tenantId,
        { tenantId, runId, stepId: "a", note: "second attempt" },
        { actorId: OTHER_ACTOR },
      ),
    );

    const a = (await readRunSteps(tenantId, runId))[0]!;
    expect(a.completedBy).toBe(ACTOR);
    expect(a.note).toBe("original");
    expect(await eventsOfType(tenantId, EVENTS.playbookStepCompleted)).toHaveLength(1);
    expect((await auditOutcomes(tenantId, "complete_playbook_step")).sort()).toEqual([
      "already_complete",
      "success",
    ]);
  });

  it("an unknown stepId claims nothing and is audited already_complete", async () => {
    const tenantId = freshTenant();
    const { runId } = await startedRun(tenantId, [step({ id: "a", ordinal: 1 })]);

    await deliver<StepCompletePayload>(
      handleStepComplete,
      envelope(COMMANDS.playbookStepComplete, tenantId, { tenantId, runId, stepId: "ghost" }),
    );

    expect((await readRunSteps(tenantId, runId))[0]!.completedAt).toBeNull();
    expect(await auditOutcomes(tenantId, "complete_playbook_step")).toEqual(["already_complete"]);
    expect(await eventsOfType(tenantId, EVENTS.playbookStepCompleted)).toEqual([]);
  });

  it("a null note is stored as null", async () => {
    const tenantId = freshTenant();
    const { runId } = await startedRun(tenantId, [step({ id: "a", ordinal: 1 })]);

    await deliver<StepCompletePayload>(
      handleStepComplete,
      envelope(COMMANDS.playbookStepComplete, tenantId, { tenantId, runId, stepId: "a" }),
    );

    expect((await readRunSteps(tenantId, runId))[0]!.note).toBeNull();
  });

  it("TENANT ISOLATION: tenant B cannot complete a step on tenant A's run", async () => {
    const owner = freshTenant();
    const stranger = freshTenant();
    const { runId } = await startedRun(owner, [step({ id: "a", ordinal: 1, mandatory: true })]);

    await deliver<StepCompletePayload>(
      handleStepComplete,
      envelope(COMMANDS.playbookStepComplete, stranger, {
        tenantId: stranger,
        runId,
        stepId: "a",
        note: "cross-tenant",
      }),
    );

    const a = (await readRunSteps(owner, runId))[0]!;
    expect(a.completedAt).toBeNull();
    expect(a.note).toBeNull();
    expect(await auditOutcomes(stranger, "complete_playbook_step")).toEqual(["already_complete"]);
  });
});

// ── run completion ──────────────────────────────────────────────────────────

describe("handleRunComplete", () => {
  async function startedRun(tenantId: string, steps: PlaybookStep[]): Promise<string> {
    const pb = await publishedPlaybook(tenantId, { steps });
    const ticketId = await seedTicket(tenantId);
    const runId = randomUUID();
    await deliver<RunStartPayload>(
      handleRunStart,
      envelope(COMMANDS.playbookRunStart, tenantId, { tenantId, runId, playbookId: pb.id, ticketId }),
    );
    return runId;
  }

  it("closes the run at 100% and enqueues run_completed", async () => {
    const tenantId = freshTenant();
    const runId = await startedRun(tenantId, [step({ id: "a", ordinal: 1, mandatory: true })]);
    await deliver<StepCompletePayload>(
      handleStepComplete,
      envelope(COMMANDS.playbookStepComplete, tenantId, { tenantId, runId, stepId: "a" }),
    );

    await deliver<RunCompletePayload>(
      handleRunComplete,
      envelope(COMMANDS.playbookRunComplete, tenantId, { tenantId, runId }),
    );

    const run = (await readRuns(tenantId))[0]!;
    expect(run.status).toBe("completed");
    expect(run.progressPct).toBe(100);
    expect(run.completedAt).not.toBeNull();

    const done = await eventsOfType(tenantId, EVENTS.playbookRunCompleted);
    expect(done).toHaveLength(1);
    expect(done[0]).toMatchObject({ runId, progressPct: 100, completedBy: ACTOR });
    expect(await auditOutcomes(tenantId, "complete_playbook_run")).toEqual(["success"]);
  });

  it("DEFENCE IN DEPTH: a hand-published command cannot close a run with a mandatory step outstanding", async () => {
    const tenantId = freshTenant();
    const runId = await startedRun(tenantId, [
      step({ id: "a", ordinal: 1, mandatory: true }),
      step({ id: "b", ordinal: 2, mandatory: false }),
    ]);

    await deliver<RunCompletePayload>(
      handleRunComplete,
      envelope(COMMANDS.playbookRunComplete, tenantId, { tenantId, runId }),
    );

    expect((await readRuns(tenantId))[0]!.status).toBe("in_progress");
    expect(await auditOutcomes(tenantId, "complete_playbook_run")).toEqual(["mandatory_outstanding"]);
    expect(await eventsOfType(tenantId, EVENTS.playbookRunCompleted)).toEqual([]);
  });

  it("a stale expectedVersion is audited version_conflict and leaves the run open", async () => {
    const tenantId = freshTenant();
    const runId = await startedRun(tenantId, [step({ id: "a", ordinal: 1, mandatory: false })]);

    await deliver<RunCompletePayload>(
      handleRunComplete,
      envelope(COMMANDS.playbookRunComplete, tenantId, { tenantId, runId, expectedVersion: 99 }),
    );

    expect((await readRuns(tenantId))[0]!.status).toBe("in_progress");
    expect(await auditOutcomes(tenantId, "complete_playbook_run")).toEqual(["version_conflict"]);
  });

  it("is idempotent on redelivery — one completion event only", async () => {
    const tenantId = freshTenant();
    const runId = await startedRun(tenantId, [step({ id: "a", ordinal: 1, mandatory: false })]);
    const msg = envelope<RunCompletePayload>(COMMANDS.playbookRunComplete, tenantId, {
      tenantId,
      runId,
    });

    await deliver(handleRunComplete, msg);
    const firstCompletedAt = (await readRuns(tenantId))[0]!.completedAt;
    await deliver(handleRunComplete, msg);

    const run = (await readRuns(tenantId))[0]!;
    expect(run.completedAt?.toISOString()).toBe(firstCompletedAt?.toISOString());
    expect(await eventsOfType(tenantId, EVENTS.playbookRunCompleted)).toHaveLength(1);
  });

  it("TENANT ISOLATION: tenant B cannot close tenant A's run", async () => {
    const owner = freshTenant();
    const stranger = freshTenant();
    const runId = await startedRun(owner, [step({ id: "a", ordinal: 1, mandatory: false })]);

    await deliver<RunCompletePayload>(
      handleRunComplete,
      envelope(COMMANDS.playbookRunComplete, stranger, { tenantId: stranger, runId }),
    );

    expect((await readRuns(owner))[0]!.status).toBe("in_progress");
    // Stranger sees zero step rows, so "no mandatory step outstanding" holds and
    // the write is refused by the tenant-scoped UPDATE instead.
    expect(await auditOutcomes(stranger, "complete_playbook_run")).toEqual(["version_conflict"]);
    expect(await eventsOfType(stranger, EVENTS.playbookRunCompleted)).toEqual([]);
  });
});

// ── auto-attach on helpdesk.ticket.created ──────────────────────────────────

describe("handleTicketCreatedAutoAttach", () => {
  it("attaches the best-matching published playbook and marks the run autoAttached", async () => {
    const tenantId = freshTenant();
    const catchAll = await publishedPlaybook(tenantId, { playbookKey: "aaa-catch-all" });
    const specific = await publishedPlaybook(tenantId, {
      playbookKey: "zzz-speed-post",
      productCode: "SPEED_POST",
      ticketType: "incident",
      steps: [step({ id: "a", ordinal: 1, mandatory: true }), step({ id: "b", ordinal: 2 })],
    });
    const ticketId = await seedTicket(tenantId, { productCode: "SPEED_POST", ticketType: "incident" });

    await deliver<TicketCreatedPayload>(
      handleTicketCreatedAutoAttach,
      envelope(EVENTS.ticketCreated, tenantId, { ticketId }),
    );

    const runs = await readRuns(tenantId);
    expect(runs).toHaveLength(1);
    expect(runs[0]!.playbookId).toBe(specific.id);
    expect(runs[0]!.playbookId).not.toBe(catchAll.id);
    expect(runs[0]!.autoAttached).toBe(true);
    expect(await readRunSteps(tenantId, runs[0]!.id)).toHaveLength(2);

    const started = await eventsOfType(tenantId, EVENTS.playbookRunStarted);
    expect(started).toHaveLength(1);
    expect(started[0]).toMatchObject({ ticketId, autoAttached: true, mandatoryStepCount: 1 });
  });

  it("no published playbook matches — nothing is attached and nothing is emitted", async () => {
    const tenantId = freshTenant();
    await publishedPlaybook(tenantId, { productCode: "SCSS" });
    const ticketId = await seedTicket(tenantId, { productCode: "SPEED_POST" });

    await deliver<TicketCreatedPayload>(
      handleTicketCreatedAutoAttach,
      envelope(EVENTS.ticketCreated, tenantId, { ticketId }),
    );

    expect(await readRuns(tenantId)).toEqual([]);
    expect(await eventsOfType(tenantId, EVENTS.playbookRunStarted)).toEqual([]);
  });

  it("a draft playbook is never auto-attached", async () => {
    const tenantId = freshTenant();
    const p = createPayload(tenantId, { productCode: "SPEED_POST" });
    await deliver(handlePlaybookCreate, envelope(COMMANDS.playbookCreate, tenantId, p));
    const ticketId = await seedTicket(tenantId, { productCode: "SPEED_POST" });

    await deliver<TicketCreatedPayload>(
      handleTicketCreatedAutoAttach,
      envelope(EVENTS.ticketCreated, tenantId, { ticketId }),
    );

    expect(await readRuns(tenantId)).toEqual([]);
  });

  it("a redelivery of the same event is a no-op (markProcessed layer)", async () => {
    const tenantId = freshTenant();
    await publishedPlaybook(tenantId);
    const ticketId = await seedTicket(tenantId);
    const msg = envelope<TicketCreatedPayload>(EVENTS.ticketCreated, tenantId, { ticketId });

    await deliver(handleTicketCreatedAutoAttach, msg);
    const first = (await readRuns(tenantId))[0]!;
    await deliver(handleTicketCreatedAutoAttach, msg);

    const runs = await readRuns(tenantId);
    expect(runs).toHaveLength(1);
    expect(runs[0]!.id).toBe(first.id);
    expect(await eventsOfType(tenantId, EVENTS.playbookRunStarted)).toHaveLength(1);
  });

  it("a DIFFERENT event for a ticket that already has a run is skipped (UNIQUE (tenant, ticket) layer)", async () => {
    const tenantId = freshTenant();
    const pb = await publishedPlaybook(tenantId);
    const ticketId = await seedTicket(tenantId);
    // A manual attach wins the race first…
    await deliver<RunStartPayload>(
      handleRunStart,
      envelope(COMMANDS.playbookRunStart, tenantId, {
        tenantId,
        runId: randomUUID(),
        playbookId: pb.id,
        ticketId,
      }),
    );

    // …then the auto-attach event arrives with its own messageId.
    await deliver<TicketCreatedPayload>(
      handleTicketCreatedAutoAttach,
      envelope(EVENTS.ticketCreated, tenantId, { ticketId }),
    );

    expect(await readRuns(tenantId)).toHaveLength(1);
    expect(await eventsOfType(tenantId, EVENTS.playbookRunStarted)).toHaveLength(1);
  });

  it("an event carrying no ticketId is skipped before any transaction opens", async () => {
    const tenantId = freshTenant();
    const messageId = msgId();
    await deliver(
      handleTicketCreatedAutoAttach,
      envelope(EVENTS.ticketCreated, tenantId, {} as TicketCreatedPayload, { messageId }),
    );

    expect(await readRuns(tenantId)).toEqual([]);
    // markProcessed never ran, so the id is not in the inbox.
    const marked = await db.select().from(processed).where(eq(processed.messageId, messageId));
    expect(marked).toEqual([]);
  });

  it("TENANT ISOLATION: an event for another tenant's ticket sees no ticket at all", async () => {
    const owner = freshTenant();
    const stranger = freshTenant();
    await publishedPlaybook(stranger);
    const ticketId = await seedTicket(owner);

    await deliver<TicketCreatedPayload>(
      handleTicketCreatedAutoAttach,
      envelope(EVENTS.ticketCreated, stranger, { ticketId }),
    );

    expect(await readRuns(stranger)).toEqual([]);
    expect(await readRuns(owner)).toEqual([]);
  });

  it("ticketMatchesPlaybook exposes the same matching rule the auto-attach uses", async () => {
    const tenantId = freshTenant();
    const p = await publishedPlaybook(tenantId, { productCode: "SPEED_POST" });
    const row = (await readPlaybook(tenantId, p.id))[0]!;

    expect(
      ticketMatchesPlaybook(row, {
        categoryId: null,
        productCode: "speed_post",
        ticketType: null,
        priority: null,
      }),
    ).toBe(true);
    expect(
      ticketMatchesPlaybook(row, {
        categoryId: null,
        productCode: "SCSS",
        ticketType: null,
        priority: null,
      }),
    ).toBe(false);
  });
});

// ── VERSION PINNING ─────────────────────────────────────────────────────────

describe("version pinning — a run continues against the version it started under", () => {
  it("publishing v2 of the same key leaves the live v1 run and its steps untouched", async () => {
    const tenantId = freshTenant();
    const key = `pinned-${randomUUID().slice(0, 8)}`;

    const v1 = await publishedPlaybook(tenantId, {
      playbookKey: key,
      versionNumber: 1,
      productCode: "SPEED_POST",
      steps: [
        step({ id: "v1-trace", ordinal: 1, mandatory: true }),
        step({ id: "v1-inform", ordinal: 2, mandatory: false }),
      ],
    });
    const ticketId = await seedTicket(tenantId, { productCode: "SPEED_POST" });
    const runId = randomUUID();
    await deliver<RunStartPayload>(
      handleRunStart,
      envelope(COMMANDS.playbookRunStart, tenantId, { tenantId, runId, playbookId: v1.id, ticketId }),
    );

    // A newer curated version of the SAME key goes live mid-run.
    const v2 = await publishedPlaybook(tenantId, {
      playbookKey: key,
      versionNumber: 2,
      productCode: "SPEED_POST",
      steps: [step({ id: "v2-only", ordinal: 1, mandatory: true })],
    });

    const run = (await readRuns(tenantId)).find((r) => r.id === runId)!;
    expect(run.playbookId).toBe(v1.id);
    expect(run.playbookId).not.toBe(v2.id);
    expect(run.playbookVersionNumber).toBe(1);
    expect(run.playbookKey).toBe(key);

    const steps = await readRunSteps(tenantId, runId);
    expect(steps.map((s) => s.stepId).sort()).toEqual(["v1-inform", "v1-trace"]);
    expect(steps.some((s) => s.stepId === "v2-only")).toBe(false);
  });

  it("v2's step ids are not completable on the pinned run, and v1's still are", async () => {
    const tenantId = freshTenant();
    const key = `pinned2-${randomUUID().slice(0, 8)}`;
    const v1 = await publishedPlaybook(tenantId, {
      playbookKey: key,
      versionNumber: 1,
      steps: [
        step({ id: "v1-a", ordinal: 1, mandatory: true }),
        step({ id: "v1-b", ordinal: 2, mandatory: true }),
      ],
    });
    const ticketId = await seedTicket(tenantId);
    const runId = randomUUID();
    await deliver<RunStartPayload>(
      handleRunStart,
      envelope(COMMANDS.playbookRunStart, tenantId, { tenantId, runId, playbookId: v1.id, ticketId }),
    );
    await publishedPlaybook(tenantId, {
      playbookKey: key,
      versionNumber: 2,
      steps: [step({ id: "v2-a", ordinal: 1, mandatory: true })],
    });

    // A v2 step id claims nothing on the pinned run.
    await deliver<StepCompletePayload>(
      handleStepComplete,
      envelope(COMMANDS.playbookStepComplete, tenantId, { tenantId, runId, stepId: "v2-a" }),
    );
    expect(await eventsOfType(tenantId, EVENTS.playbookStepCompleted)).toEqual([]);

    // v1's own steps still complete, and the run closes against v1's rules.
    for (const stepId of ["v1-a", "v1-b"]) {
      await deliver<StepCompletePayload>(
        handleStepComplete,
        envelope(COMMANDS.playbookStepComplete, tenantId, { tenantId, runId, stepId }),
      );
    }
    await deliver<RunCompletePayload>(
      handleRunComplete,
      envelope(COMMANDS.playbookRunComplete, tenantId, { tenantId, runId }),
    );

    const run = (await readRuns(tenantId)).find((r) => r.id === runId)!;
    expect(run.status).toBe("completed");
    expect(run.progressPct).toBe(100);
    expect(run.playbookVersionNumber).toBe(1);
  });

  it("deprecating the version a run started under does not disturb the run", async () => {
    const tenantId = freshTenant();
    const v1 = await publishedPlaybook(tenantId, {
      steps: [step({ id: "a", ordinal: 1, mandatory: true })],
    });
    const ticketId = await seedTicket(tenantId);
    const runId = randomUUID();
    await deliver<RunStartPayload>(
      handleRunStart,
      envelope(COMMANDS.playbookRunStart, tenantId, { tenantId, runId, playbookId: v1.id, ticketId }),
    );

    await deliver<PlaybookLifecyclePayload>(
      handlePlaybookDeprecate,
      envelope(COMMANDS.playbookDeprecate, tenantId, { tenantId, id: v1.id }),
    );

    await deliver<StepCompletePayload>(
      handleStepComplete,
      envelope(COMMANDS.playbookStepComplete, tenantId, { tenantId, runId, stepId: "a" }),
    );
    await deliver<RunCompletePayload>(
      handleRunComplete,
      envelope(COMMANDS.playbookRunComplete, tenantId, { tenantId, runId }),
    );

    expect((await readPlaybook(tenantId, v1.id))[0]!.status).toBe("deprecated");
    const run = (await readRuns(tenantId)).find((r) => r.id === runId)!;
    expect(run.status).toBe("completed");
  });
});
