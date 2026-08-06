/**
 * G13 Resolution Playbooks — SQS consumers.
 *
 * Every handler follows the service contract: markProcessed(tx, msg.messageId)
 * is the FIRST statement inside the transaction, then the business write, then
 * the outbox event + audit event, then (outside the transaction) the cache
 * invalidation.
 *
 * Handlers are exported individually so tests can invoke them twice with the
 * same messageId to prove idempotency — MemoryQueue dedupes on
 * (topic, messageId) before a handler ever runs, so a redelivery cannot be
 * simulated through publish().
 */
import { randomUUID } from "node:crypto";
import { pino } from "pino";
import type { CommandEnvelope, Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { tenantScoped } from "../../shared/tenant-queue.js";
import {
  COMMANDS,
  EVENTS,
  RESOURCE_PLAYBOOK,
  RESOURCE_PLAYBOOK_RUN,
  SERVICE,
} from "../../topics.js";
import * as repo from "./repo.js";
import {
  canCompleteRun,
  computeProgressPct,
  criteriaMatches,
  initialRunSteps,
  normaliseSteps,
  resolvePlaybook,
  type MatchCriteria,
  type PlaybookStep,
} from "./domain.js";
import { toCandidate, toRunStepState } from "./queries.js";
import type { PlaybookRow, PlaybookRunStepInsert } from "./schema.js";

const log = pino({ name: "helpdesk.playbooks.consumer" });
const AUDIT = "audit.event.record";

type Tx = Parameters<typeof enqueue>[0];
type Msg = { tenantId: string; actorId: string; correlationId: string; messageId: string };

function audit(
  tx: Tx,
  msg: Msg,
  action: string,
  resourceType: string,
  resourceId: string,
  outcome = "success",
): Promise<void> {
  return enqueue(tx, {
    topic: AUDIT,
    eventType: AUDIT,
    tenantId: msg.tenantId,
    actorId: msg.actorId,
    correlationId: msg.correlationId,
    payload: { service: SERVICE, action, resourceType, resourceId, outcome },
  });
}

function event(tx: Tx, msg: Msg, eventType: string, payload: Record<string, unknown>): Promise<void> {
  return enqueue(tx, {
    topic: eventType,
    eventType,
    tenantId: msg.tenantId,
    actorId: msg.actorId,
    correlationId: msg.correlationId,
    payload,
  });
}

async function invalidatePlaybooks(tenantId: string): Promise<void> {
  await cache.invalidateResource(tenantId, RESOURCE_PLAYBOOK);
}

async function invalidateRuns(tenantId: string): Promise<void> {
  await cache.invalidateResource(tenantId, RESOURCE_PLAYBOOK_RUN);
}

// ── Payload types ───────────────────────────────────────────────────────────

export interface PlaybookCreatePayload {
  tenantId: string;
  id: string;
  playbookKey: string;
  name: string;
  description: string | null;
  versionNumber: number;
  categoryId: string | null;
  productCode: string | null;
  ticketType: string | null;
  priority: string | null;
  steps: PlaybookStep[];
}

export interface PlaybookUpdatePayload {
  tenantId: string;
  id: string;
  expectedVersion?: number;
  name?: string;
  description?: string | null;
  categoryId?: string | null;
  productCode?: string | null;
  ticketType?: string | null;
  priority?: string | null;
  steps?: PlaybookStep[];
}

export interface PlaybookLifecyclePayload {
  tenantId: string;
  id: string;
  expectedVersion?: number;
  publishedAt?: string;
}

export interface RunStartPayload {
  tenantId: string;
  runId: string;
  playbookId: string;
  ticketId: string;
}

export interface StepCompletePayload {
  tenantId: string;
  runId: string;
  stepId: string;
  note?: string | null;
}

export interface RunCompletePayload {
  tenantId: string;
  runId: string;
  expectedVersion?: number;
}

/** helpdesk.ticket.created event payload — only `ticketId` is relied upon. */
export interface TicketCreatedPayload {
  ticketId: string;
}

/** Why an auto-attach attempt ended the way it did (drives the log line). */
export type AutoAttachOutcome =
  | "started"
  | "no_match"
  | "already_attached"
  | "ticket_missing"
  | "duplicate_message";

// ── Playbook lifecycle handlers ─────────────────────────────────────────────

export async function handlePlaybookCreate(msg: CommandEnvelope<PlaybookCreatePayload>): Promise<void> {
  const p = msg.payload;
  let created = false;
  await db.transaction(async (tx) => {
    if (!(await markProcessed(tx, msg.messageId))) return;
    try {
      await repo.insertPlaybook(tx as repo.Writer, {
        id: p.id,
        tenantId: p.tenantId,
        playbookKey: p.playbookKey,
        name: p.name,
        description: p.description,
        versionNumber: p.versionNumber,
        status: "draft",
        categoryId: p.categoryId,
        productCode: p.productCode,
        ticketType: p.ticketType,
        priority: p.priority,
        steps: normaliseSteps(p.steps),
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
      });
      created = true;
      await audit(tx as Tx, msg, "create_playbook", RESOURCE_PLAYBOOK, p.id);
    } catch (err) {
      // UNIQUE (tenant_id, playbook_key, version_number): a duplicate is a
      // rejected command, not a consumer failure — audit it and move on rather
      // than retrying into the DLQ.
      if ((err as { code?: string }).code === "23505") {
        await audit(tx as Tx, msg, "create_playbook", RESOURCE_PLAYBOOK, p.id, "rejected_duplicate");
      } else {
        throw err;
      }
    }
  });
  if (created) {
    await invalidatePlaybooks(p.tenantId);
    log.info({ playbookId: p.id, playbookKey: p.playbookKey }, "playbook draft created");
  }
}

export async function handlePlaybookUpdate(msg: CommandEnvelope<PlaybookUpdatePayload>): Promise<void> {
  const p = msg.payload;
  let applied = false;
  await db.transaction(async (tx) => {
    if (!(await markProcessed(tx, msg.messageId))) return;
    const patch: Record<string, unknown> = { updatedBy: msg.actorId };
    if (p.name !== undefined) patch.name = p.name;
    if (p.description !== undefined) patch.description = p.description;
    if (p.categoryId !== undefined) patch.categoryId = p.categoryId;
    if (p.productCode !== undefined) patch.productCode = p.productCode;
    if (p.ticketType !== undefined) patch.ticketType = p.ticketType;
    if (p.priority !== undefined) patch.priority = p.priority;
    if (p.steps !== undefined) patch.steps = normaliseSteps(p.steps);
    const updated = await repo.updatePlaybook(
      tx as repo.Writer,
      p.id,
      p.tenantId,
      patch,
      p.expectedVersion,
    );
    if (updated) {
      applied = true;
      await audit(tx as Tx, msg, "update_playbook", RESOURCE_PLAYBOOK, p.id);
    } else {
      await audit(tx as Tx, msg, "update_playbook", RESOURCE_PLAYBOOK, p.id, "version_conflict");
    }
  });
  if (applied) await invalidatePlaybooks(p.tenantId);
}

export async function handlePlaybookPublish(msg: CommandEnvelope<PlaybookLifecyclePayload>): Promise<void> {
  const p = msg.payload;
  let applied = false;
  await db.transaction(async (tx) => {
    if (!(await markProcessed(tx, msg.messageId))) return;
    const updated = await repo.updatePlaybook(
      tx as repo.Writer,
      p.id,
      p.tenantId,
      {
        status: "published",
        publishedAt: p.publishedAt ? new Date(p.publishedAt) : new Date(),
        updatedBy: msg.actorId,
      },
      p.expectedVersion,
    );
    if (updated) {
      applied = true;
      await audit(tx as Tx, msg, "publish_playbook", RESOURCE_PLAYBOOK, p.id);
    } else {
      await audit(tx as Tx, msg, "publish_playbook", RESOURCE_PLAYBOOK, p.id, "version_conflict");
    }
  });
  if (applied) {
    await invalidatePlaybooks(p.tenantId);
    log.info({ playbookId: p.id }, "playbook published");
  }
}

export async function handlePlaybookDeprecate(
  msg: CommandEnvelope<PlaybookLifecyclePayload>,
): Promise<void> {
  const p = msg.payload;
  let applied = false;
  await db.transaction(async (tx) => {
    if (!(await markProcessed(tx, msg.messageId))) return;
    const updated = await repo.updatePlaybook(
      tx as repo.Writer,
      p.id,
      p.tenantId,
      { status: "deprecated", updatedBy: msg.actorId },
      p.expectedVersion,
    );
    if (updated) {
      applied = true;
      await audit(tx as Tx, msg, "deprecate_playbook", RESOURCE_PLAYBOOK, p.id);
    } else {
      await audit(tx as Tx, msg, "deprecate_playbook", RESOURCE_PLAYBOOK, p.id, "version_conflict");
    }
  });
  if (applied) {
    await invalidatePlaybooks(p.tenantId);
    log.info({ playbookId: p.id }, "playbook deprecated");
  }
}

// ── Run handlers ────────────────────────────────────────────────────────────

function runStepRows(
  tenantId: string,
  runId: string,
  steps: readonly PlaybookStep[],
): PlaybookRunStepInsert[] {
  const byId = new Map(normaliseSteps(steps).map((s) => [s.id, s]));
  return initialRunSteps(steps).map((state) => {
    const def = byId.get(state.stepId)!;
    return {
      tenantId,
      runId,
      stepId: state.stepId,
      ordinal: state.ordinal,
      stepType: def.type,
      title: def.title,
      mandatory: def.mandatory,
      slaOffsetMinutes: def.slaOffsetMinutes,
      knowledgeArticleId: def.knowledgeArticleId,
    };
  });
}

/**
 * Insert a run plus its snapshotted step rows. Returns false when a run already
 * exists for the ticket (UNIQUE (tenant_id, ticket_id)) — the caller then emits
 * nothing, which is what keeps both the manual and the automatic attach path
 * exactly-once per ticket.
 */
async function startRunInTx(
  tx: Tx,
  msg: Msg,
  args: { runId: string; ticketId: string; playbook: PlaybookRow; autoAttached: boolean },
): Promise<boolean> {
  const inserted = await repo.insertRunIfAbsent(tx as unknown as repo.Writer, {
    id: args.runId,
    tenantId: msg.tenantId,
    playbookId: args.playbook.id,
    playbookKey: args.playbook.playbookKey,
    playbookVersionNumber: args.playbook.versionNumber,
    ticketId: args.ticketId,
    status: "in_progress",
    progressPct: 0,
    autoAttached: args.autoAttached,
    createdBy: msg.actorId,
    updatedBy: msg.actorId,
  });
  if (!inserted) return false;

  const stepRows = runStepRows(msg.tenantId, inserted.id, args.playbook.steps);
  await repo.insertRunSteps(tx as unknown as repo.Writer, stepRows);

  // A playbook with zero steps has nothing outstanding, so its run starts at
  // 100% — computeProgressPct owns that rule, we do not restate it here.
  const progressPct = computeProgressPct(
    stepRows.map((r) => ({
      stepId: r.stepId,
      ordinal: r.ordinal,
      mandatory: r.mandatory ?? false,
      completedAt: null,
      completedBy: null,
    })),
  );
  if (progressPct !== 0) {
    await repo.updateRun(tx as unknown as repo.Writer, inserted.id, msg.tenantId, { progressPct });
  }

  await event(tx, msg, EVENTS.playbookRunStarted, {
    runId: inserted.id,
    playbookId: args.playbook.id,
    playbookKey: args.playbook.playbookKey,
    playbookVersionNumber: args.playbook.versionNumber,
    ticketId: args.ticketId,
    stepCount: stepRows.length,
    mandatoryStepCount: stepRows.filter((r) => r.mandatory).length,
    autoAttached: args.autoAttached,
  });
  await audit(tx, msg, "start_playbook_run", RESOURCE_PLAYBOOK_RUN, inserted.id);
  return true;
}

export async function handleRunStart(msg: CommandEnvelope<RunStartPayload>): Promise<void> {
  const p = msg.payload;
  let started = false;
  await db.transaction(async (tx) => {
    if (!(await markProcessed(tx, msg.messageId))) return;
    const playbook = await repo.findPlaybookTx(tx as unknown as repo.Writer, p.playbookId, p.tenantId);
    if (!playbook) {
      // The route pre-checks existence; reaching here means the playbook was
      // removed between accept and processing. Not retryable.
      await audit(tx as Tx, msg, "start_playbook_run", RESOURCE_PLAYBOOK_RUN, p.runId, "playbook_missing");
      return;
    }
    started = await startRunInTx(tx as Tx, msg, {
      runId: p.runId,
      ticketId: p.ticketId,
      playbook,
      autoAttached: false,
    });
    if (!started) {
      await audit(tx as Tx, msg, "start_playbook_run", RESOURCE_PLAYBOOK_RUN, p.runId, "already_attached");
    }
  });
  if (started) {
    await invalidateRuns(p.tenantId);
    log.info({ runId: p.runId, ticketId: p.ticketId }, "playbook run started");
  }
}

export async function handleStepComplete(msg: CommandEnvelope<StepCompletePayload>): Promise<void> {
  const p = msg.payload;
  let completed = false;
  await db.transaction(async (tx) => {
    if (!(await markProcessed(tx, msg.messageId))) return;
    const now = new Date();
    const claimed = await repo.completeRunStep(
      tx as unknown as repo.Writer,
      p.tenantId,
      p.runId,
      p.stepId,
      msg.actorId,
      now,
      p.note ?? null,
    );
    if (!claimed) {
      // Already complete (or unknown step) — a redelivery must not overwrite
      // the original actor/timestamp, and must not emit a second event.
      await audit(tx as Tx, msg, "complete_playbook_step", RESOURCE_PLAYBOOK_RUN, p.runId, "already_complete");
      return;
    }
    const steps = await repo.listRunStepsTx(tx as unknown as repo.Writer, p.tenantId, p.runId);
    const progressPct = computeProgressPct(steps.map(toRunStepState));
    const run = await repo.updateRun(tx as unknown as repo.Writer, p.runId, p.tenantId, {
      progressPct,
      updatedBy: msg.actorId,
    });
    await event(tx as Tx, msg, EVENTS.playbookStepCompleted, {
      runId: p.runId,
      ticketId: run?.ticketId ?? null,
      stepId: p.stepId,
      ordinal: claimed.ordinal,
      mandatory: claimed.mandatory,
      progressPct,
      completedBy: msg.actorId,
      completedAt: now.toISOString(),
    });
    await audit(tx as Tx, msg, "complete_playbook_step", RESOURCE_PLAYBOOK_RUN, p.runId);
    completed = true;
  });
  if (completed) await invalidateRuns(p.tenantId);
}

export async function handleRunComplete(msg: CommandEnvelope<RunCompletePayload>): Promise<void> {
  const p = msg.payload;
  let completed = false;
  await db.transaction(async (tx) => {
    if (!(await markProcessed(tx, msg.messageId))) return;
    const steps = await repo.listRunStepsTx(tx as unknown as repo.Writer, p.tenantId, p.runId);
    // Defence in depth: the route already answers 422, but the invariant "no
    // run completes with a mandatory step outstanding" is enforced here too so
    // a hand-published command cannot bypass it.
    if (!canCompleteRun(steps.map(toRunStepState))) {
      await audit(tx as Tx, msg, "complete_playbook_run", RESOURCE_PLAYBOOK_RUN, p.runId, "mandatory_outstanding");
      log.warn({ runId: p.runId }, "playbook run completion rejected: mandatory step outstanding");
      return;
    }
    const now = new Date();
    const progressPct = computeProgressPct(steps.map(toRunStepState));
    const updated = await repo.updateRun(
      tx as unknown as repo.Writer,
      p.runId,
      p.tenantId,
      { status: "completed", completedAt: now, progressPct, updatedBy: msg.actorId },
      p.expectedVersion,
    );
    if (!updated) {
      await audit(tx as Tx, msg, "complete_playbook_run", RESOURCE_PLAYBOOK_RUN, p.runId, "version_conflict");
      return;
    }
    await event(tx as Tx, msg, EVENTS.playbookRunCompleted, {
      runId: p.runId,
      playbookId: updated.playbookId,
      ticketId: updated.ticketId,
      progressPct,
      completedAt: now.toISOString(),
      completedBy: msg.actorId,
    });
    await audit(tx as Tx, msg, "complete_playbook_run", RESOURCE_PLAYBOOK_RUN, p.runId);
    completed = true;
  });
  if (completed) {
    await invalidateRuns(p.tenantId);
    log.info({ runId: p.runId }, "playbook run completed");
  }
}

// ── Auto-attach on ticket creation ──────────────────────────────────────────

/**
 * On `helpdesk.ticket.created`, resolve the best-matching published playbook and
 * start a run automatically.
 *
 * Idempotency has two independent layers, because an application check alone is
 * not enough when two deliveries overlap:
 *   1. markProcessed(tx, msg.messageId) is the first statement in the tx, so a
 *      redelivery of the SAME message does nothing at all.
 *   2. UNIQUE (tenant_id, ticket_id) on helpdesk.playbook_runs, honoured through
 *      ON CONFLICT DO NOTHING, so a DIFFERENT message for the same ticket (e.g.
 *      a manual attach racing the automatic one) still yields exactly one run.
 *
 * "No playbook matches" is the common case, not an error: log at INFO and stop.
 */
export async function handleTicketCreatedAutoAttach(
  msg: CommandEnvelope<TicketCreatedPayload>,
): Promise<void> {
  const ticketId = msg.payload?.ticketId;
  if (!ticketId) {
    log.info({ messageId: msg.messageId }, "playbook auto-attach skipped: event carried no ticketId");
    return;
  }
  // Held in an object rather than a plain `let`: TypeScript's control-flow
  // analysis does not track assignments made inside the transaction callback,
  // so a `let` would be narrowed to its initialiser after the await.
  const result: { outcome: AutoAttachOutcome } = { outcome: "duplicate_message" };

  await db.transaction(async (tx) => {
    if (!(await markProcessed(tx, msg.messageId))) return;
    const ticket = await repo.findTicketCriteriaTx(tx as unknown as repo.Writer, msg.tenantId, ticketId);
    if (!ticket) {
      result.outcome = "ticket_missing";
      return;
    }
    const criteria: MatchCriteria = {
      categoryId: ticket.categoryId,
      productCode: ticket.productCode,
      ticketType: ticket.ticketType,
      priority: ticket.priority,
    };
    const rows = await repo.listPublishedPlaybooksTx(tx as unknown as repo.Writer, msg.tenantId);
    const winner = resolvePlaybook(rows.map(toCandidate), criteria);
    if (!winner) {
      result.outcome = "no_match";
      return;
    }
    const playbook = rows.find((r) => r.id === winner.id)!;
    const started = await startRunInTx(tx as Tx, msg, {
      runId: randomUUID(),
      ticketId,
      playbook,
      autoAttached: true,
    });
    result.outcome = started ? "started" : "already_attached";
  });

  switch (result.outcome) {
    case "started":
      await invalidateRuns(msg.tenantId);
      log.info({ ticketId }, "playbook auto-attached to new ticket");
      break;
    case "no_match":
      // Expected for most tickets — never an error.
      log.info({ ticketId }, "no published playbook matches ticket; nothing to attach");
      break;
    case "already_attached":
      log.info({ ticketId }, "playbook run already exists for ticket; auto-attach skipped");
      break;
    case "ticket_missing":
      log.warn({ ticketId }, "playbook auto-attach skipped: ticket not visible");
      break;
    default:
      log.debug({ messageId: msg.messageId }, "playbook auto-attach: message already processed");
  }
}

/** Exported for tests: the pure matching hook used by auto-attach. */
export function ticketMatchesPlaybook(playbook: PlaybookRow, criteria: MatchCriteria): boolean {
  return criteriaMatches(toCandidate(playbook), criteria);
}

// ── Registration ────────────────────────────────────────────────────────────

export function registerPlaybookConsumers(rawQueue: Queue): void {
  // Handlers run inside the message's tenant context so FORCE RLS accepts the
  // consumer writes (see shared/tenant-queue.ts).
  const queue = tenantScoped(rawQueue);
  queue.subscribe<PlaybookCreatePayload>(COMMANDS.playbookCreate, handlePlaybookCreate);
  queue.subscribe<PlaybookUpdatePayload>(COMMANDS.playbookUpdate, handlePlaybookUpdate);
  queue.subscribe<PlaybookLifecyclePayload>(COMMANDS.playbookPublish, handlePlaybookPublish);
  queue.subscribe<PlaybookLifecyclePayload>(COMMANDS.playbookDeprecate, handlePlaybookDeprecate);
  queue.subscribe<RunStartPayload>(COMMANDS.playbookRunStart, handleRunStart);
  queue.subscribe<StepCompletePayload>(COMMANDS.playbookStepComplete, handleStepComplete);
  queue.subscribe<RunCompletePayload>(COMMANDS.playbookRunComplete, handleRunComplete);
  queue.subscribe<TicketCreatedPayload>(EVENTS.ticketCreated, handleTicketCreatedAutoAttach);
}
