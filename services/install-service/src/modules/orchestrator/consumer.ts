import { randomUUID } from "node:crypto";
import type { Queue, CommandEnvelope } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache, queue as sharedQueue } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import * as repo from "./repo.js";
import { resolveReadySteps, isWizardComplete } from "./domain.js";
import type { StepDef, StepExec } from "./domain.js";
import {
  CITIZEN_PACK_DOMAIN_ACTIVATE,
  MUNICIPAL_ONBOARDING_PACK_KEYS,
} from "./domain-pack-constants.js";
import { DOMAIN_PACK_ACTIVATE_HANDLER } from "./onboarding.js";

const AUDIT_TOPIC = "audit.event.record";
const RESOURCE = "wizard";

function progressKey(tenantId: string, wizardId: string) {
  return cache.makeKey(tenantId, RESOURCE, `${wizardId}:progress`);
}

interface WizardCreatePayload {
  id: string;
  tenantId: string;
  name: string;
  description: string | null;
  status: string;
  steps: Array<{
    stepKey: string;
    title: string;
    description: string | null;
    isRequired: boolean;
    dependsOn: string[];
    handlerType: string;
    config: Record<string, unknown>;
    sortOrder: number;
  }>;
  executions: Array<{ stepKey: string; status: string }>;
  version: number;
}

interface StepActionPayload {
  wizardId: string;
  stepKey: string;
  output?: Record<string, unknown>;
  reason?: string;
}

export function registerOrchestratorConsumers(queue: Queue): void {
  // --- install.wizard.create ---
  queue.subscribe<WizardCreatePayload>(COMMANDS.wizardCreate, async (msg) => {
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const p = msg.payload;

      await repo.insertWizard(tx, {
        id: p.id,
        tenantId: p.tenantId,
        name: p.name,
        description: p.description,
        status: p.status,
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
        version: 1,
      });

      const stepDefs = p.steps.map((s) => ({
        tenantId: p.tenantId,
        wizardId: p.id,
        stepKey: s.stepKey,
        title: s.title,
        description: s.description,
        isRequired: s.isRequired,
        dependsOn: s.dependsOn,
        handlerType: s.handlerType,
        config: s.config,
        sortOrder: s.sortOrder,
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
      }));
      await repo.insertStepDefinitions(tx, stepDefs);

      const execRows = p.executions.map((e) => ({
        tenantId: p.tenantId,
        wizardId: p.id,
        stepKey: e.stepKey,
        status: e.status,
        output: {},
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
      }));
      await repo.insertStepExecutions(tx, execRows);

      await emit(tx, msg, EVENTS.wizardCreated, { wizardId: p.id, name: p.name }, "wizard_created", p.id);
    });

    await cache.invalidateResource(msg.tenantId, RESOURCE);
  });

  // --- install.step.start ---
  queue.subscribe<StepActionPayload>(COMMANDS.stepStart, async (msg) => {
    const { wizardId, stepKey } = msg.payload;
    let domainPackKey: string | undefined;
    let packKeys: string[] | undefined;

    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;

      await repo.upsertStepExecution(tx, msg.tenantId, wizardId, stepKey, "in_progress", {
        startedAt: new Date(),
      });

      const defs = await repo.getStepDefinitions(wizardId, msg.tenantId);
      const def = defs.find((d) => d.stepKey === stepKey);
      if (def?.handlerType === DOMAIN_PACK_ACTIVATE_HANDLER) {
        const cfg = (def.config ?? {}) as { domainPackKey?: string; packKeys?: string[] };
        domainPackKey = cfg.domainPackKey ?? "municipal-in-v1";
        packKeys = Array.isArray(cfg.packKeys) && cfg.packKeys.length > 0
          ? cfg.packKeys
          : [...MUNICIPAL_ONBOARDING_PACK_KEYS];
        await repo.upsertStepExecution(tx, msg.tenantId, wizardId, stepKey, "in_progress", {
          output: {
            handlerType: DOMAIN_PACK_ACTIVATE_HANDLER,
            domainPackKey,
            packKeys,
          },
        });
      }

      await emitAudit(tx, msg, "step_started", wizardId);
    });

    // FN-17: Stage 3 handler — publish Domain Pack activation to citizen-service (out of TX).
    if (domainPackKey && packKeys) {
      const activationId = randomUUID();
      await sharedQueue.publish(CITIZEN_PACK_DOMAIN_ACTIVATE, {
        messageId: activationId,
        type: CITIZEN_PACK_DOMAIN_ACTIVATE,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        schemaVersion: "1.0",
        payload: {
          id: activationId,
          tenantId: msg.tenantId,
          domainPackKey,
          packKeys,
          stageNumber: 3,
          source: "install_wizard_step",
          wizardId,
          stepKey,
        },
      });
    }

    await cache.invalidate(progressKey(msg.tenantId, wizardId));
    await cache.invalidateResource(msg.tenantId, RESOURCE);
  });

  // --- install.step.complete ---
  queue.subscribe<StepActionPayload>(COMMANDS.stepComplete, async (msg) => {
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const { wizardId, stepKey, output } = msg.payload;

      await repo.upsertStepExecution(tx, msg.tenantId, wizardId, stepKey, "completed", {
        output: output ?? {},
        completedAt: new Date(),
      });

      // Resolve DAG — unblock downstream steps
      await resolveDag(tx, msg.tenantId, wizardId, msg.actorId);

      await emit(tx, msg, EVENTS.stepCompleted, { wizardId, stepKey }, "step_completed", wizardId);

      // Check if wizard is now complete
      const defs = await repo.getStepDefinitions(wizardId, msg.tenantId);
      const execs = await repo.getStepExecutions(wizardId, msg.tenantId);
      const stepDefs: StepDef[] = defs.map((d) => ({ stepKey: d.stepKey, isRequired: d.isRequired, dependsOn: d.dependsOn ?? [] }));
      const stepExecs: StepExec[] = execs.map((e) => ({ stepKey: e.stepKey, status: e.status as StepExec["status"] }));

      if (isWizardComplete(stepDefs, stepExecs)) {
        await emit(tx, msg, EVENTS.wizardCompleted, { wizardId }, "wizard_completed", wizardId);
      }
    });

    await cache.invalidate(progressKey(msg.tenantId, msg.payload.wizardId));
    await cache.invalidateResource(msg.tenantId, RESOURCE);
  });

  // --- install.step.skip ---
  queue.subscribe<StepActionPayload>(COMMANDS.stepSkip, async (msg) => {
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const { wizardId, stepKey } = msg.payload;

      await repo.upsertStepExecution(tx, msg.tenantId, wizardId, stepKey, "skipped", {
        completedAt: new Date(),
      });

      // Resolve DAG — unblock downstream steps
      await resolveDag(tx, msg.tenantId, wizardId, msg.actorId);

      await emit(tx, msg, EVENTS.stepSkipped, { wizardId, stepKey }, "step_skipped", wizardId);

      // Check if wizard is now complete
      const defs = await repo.getStepDefinitions(wizardId, msg.tenantId);
      const execs = await repo.getStepExecutions(wizardId, msg.tenantId);
      const stepDefs: StepDef[] = defs.map((d) => ({ stepKey: d.stepKey, isRequired: d.isRequired, dependsOn: d.dependsOn ?? [] }));
      const stepExecs: StepExec[] = execs.map((e) => ({ stepKey: e.stepKey, status: e.status as StepExec["status"] }));

      if (isWizardComplete(stepDefs, stepExecs)) {
        await emit(tx, msg, EVENTS.wizardCompleted, { wizardId }, "wizard_completed", wizardId);
      }
    });

    await cache.invalidate(progressKey(msg.tenantId, msg.payload.wizardId));
    await cache.invalidateResource(msg.tenantId, RESOURCE);
  });
}

/**
 * After a step completes/skips, resolve the DAG and unblock ready steps.
 */
async function resolveDag(tx: repo.Writer, tenantId: string, wizardId: string, _actorId: string): Promise<void> {
  const defs = await repo.getStepDefinitions(wizardId, tenantId);
  const execs = await repo.getStepExecutions(wizardId, tenantId);

  const stepDefs: StepDef[] = defs.map((d) => ({
    stepKey: d.stepKey,
    isRequired: d.isRequired,
    dependsOn: d.dependsOn ?? [],
  }));

  const stepExecs: StepExec[] = execs.map((e) => ({
    stepKey: e.stepKey,
    status: e.status as StepExec["status"],
  }));

  const readySteps = resolveReadySteps(stepDefs, stepExecs);

  for (const stepKey of readySteps) {
    await repo.updateStepExecutionStatus(tx, tenantId, wizardId, stepKey, "ready");
  }
}

async function emit(
  tx: unknown,
  msg: CommandEnvelope,
  eventType: string,
  payload: Record<string, unknown>,
  action: string,
  resourceId: string,
): Promise<void> {
  const t = tx as Parameters<typeof enqueue>[0];
  await enqueue(t, {
    topic: eventType,
    eventType,
    tenantId: msg.tenantId,
    actorId: msg.actorId,
    correlationId: msg.correlationId,
    payload,
  });
  await enqueue(t, {
    topic: AUDIT_TOPIC,
    eventType: AUDIT_TOPIC,
    tenantId: msg.tenantId,
    actorId: msg.actorId,
    correlationId: msg.correlationId,
    payload: {
      service: "install",
      action,
      resourceType: "wizard",
      resourceId,
      outcome: "success",
    },
  });
}

async function emitAudit(
  tx: unknown,
  msg: CommandEnvelope,
  action: string,
  resourceId: string,
): Promise<void> {
  const t = tx as Parameters<typeof enqueue>[0];
  await enqueue(t, {
    topic: AUDIT_TOPIC,
    eventType: AUDIT_TOPIC,
    tenantId: msg.tenantId,
    actorId: msg.actorId,
    correlationId: msg.correlationId,
    payload: {
      service: "install",
      action,
      resourceType: "wizard",
      resourceId,
      outcome: "success",
    },
  });
}
