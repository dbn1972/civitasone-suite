/**
 * Composition applier — WRITE PATH (consumer side), ST-M01-03.
 *
 * The ONLY code that writes composition entitlements for the apply-plan path.
 * In ONE transaction, scoped to the tenant (FORCE-RLS tables):
 *   markProcessed → guarded write (replace user entitlements + optional
 *   profile) → enqueue admin.composition.applied + audit.event.record.
 * (KIRO-BUILD-PROMPT §4.1: markProcessed + guarded write + audit in one tx.)
 *
 * The module set is validated against the registry BEFORE the write: an unknown
 * module id, or a set that cannot resolve (bad dep graph), aborts the whole
 * transaction (including markProcessed), so the message is retried / DLQ'd as a
 * loud failure rather than persisting a half-valid composition — the same
 * fail-loud posture as the tenant-service quota consumer.
 */
import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { runWithTenant } from "@civitasone/db";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import { notifyGatewayModuleCache } from "../../module-cache-notify.js";
import * as repo from "./repo.js";
import { buildRegistry, resolveComposition } from "./domain.js";
import { planApplyRequests, tenantEntitlement } from "./schema.js";
import { and, eq } from "drizzle-orm";

const log = pino({ name: "admin-composition-applier" });
const AUDIT_TOPIC = "audit.event.record";

interface ApplyPlanPayload {
  tenantId: string;
  moduleIds: string[];
  profileCode: string | null;
}

interface PlanApplyRequestPayload {
  requestId: string;
  tenantId: string;
  planId: string;
  planCode: string;
  moduleIds: string[];
  userModuleIds: string[];
  profileCode: string | null;
}

interface PlanApplyDecidePayload {
  tenantId: string;
  requestId: string;
  decision: "approve" | "reject";
  reason?: string;
}

interface SetEnforcementModePayload {
  tenantId: string;
  mode: "off" | "shadow" | "enforce";
}

export function registerCompositionConsumers(queue: Queue): void {
  queue.subscribe<SetEnforcementModePayload>(COMMANDS.compositionSetEnforcementMode, async (msg) => {
    const { tenantId, mode } = msg.payload;
    try {
      // Re-check readiness (the route checked too; this closes the race where the
      // composition was cleared between 202 and consume): `enforce` on an
      // un-composed tenant would lock it out of every module.
      const ready = mode !== "enforce" || (await repo.isCompositionConfigured(tenantId));
      let applied = false;
      // Read before the tx (informational for audit/event only) - a nested
      // scopedRead inside db.transaction is the nested-tx anti-pattern.
      const previousMode = await repo.getEffectiveEnforcementMode(tenantId);
      await runWithTenant(tenantId, () =>
        db.transaction(async (tx) => {
          if (!(await markProcessed(tx, msg.messageId))) return;
          const t = tx as Parameters<typeof enqueue>[0];
          if (!ready) {
            await enqueue(t, {
              topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
              tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
              payload: {
                service: "admin", action: "composition_set_enforcement_mode",
                resourceType: "tenant_composition", resourceId: tenantId, outcome: "denied",
                mode, reason: "composition_not_configured",
              },
            });
            return;
          }
          await repo.setEnforcementModeTx(
            tx as unknown as Parameters<typeof repo.setEnforcementModeTx>[0],
            tenantId, mode, msg.actorId,
          );
          await enqueue(t, {
            topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
            tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
            payload: {
              service: "admin", action: "composition_set_enforcement_mode",
              resourceType: "tenant_composition", resourceId: tenantId, outcome: "success",
              mode, previousMode,
            },
          });
          await enqueue(t, {
            topic: EVENTS.compositionEnforcementModeChanged, eventType: EVENTS.compositionEnforcementModeChanged,
            tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
            payload: { tenantId, mode, previousMode },
          });
          applied = true;
        }),
      );
      if (!ready) log.warn({ tenantId, mode, messageId: msg.messageId }, "enforcement-mode change refused: tenant not composed");
      if (applied) await cache.invalidate(cache.makeKey(tenantId, "composition", tenantId));
    } catch (err) {
      log.error({ err, messageId: msg.messageId, type: COMMANDS.compositionSetEnforcementMode }, "Consumer processing failed");
      throw err;
    }
  });

  queue.subscribe<ApplyPlanPayload>(COMMANDS.compositionApplyPlan, async (msg) => {
    const { tenantId, moduleIds, profileCode } = msg.payload;
    try {
      // Validate the requested module set against the registry BEFORE writing.
      // registryFor reads the GLOBAL reference catalogue (no RLS); the resolver
      // throws on an unknown module id or an unresolvable graph.
      const mods = await repo.loadRegistry(tenantId);
      if (mods.length === 0) {
        throw new Error("module registry not seeded (run migration 0025)");
      }
      const reg = buildRegistry(mods);
      // resolveComposition throws CompositionError (UNKNOWN_MODULE) if any id is
      // bogus; it also normalises the set (dedupe, drop core ids). We persist
      // exactly the non-core user picks the resolver kept.
      const comp = resolveComposition(reg, moduleIds);
      const userModules = comp.entries.filter((e) => e.source === "user").map((e) => e.id).sort();

      await runWithTenant(tenantId, () =>
        db.transaction(async (tx) => {
          if (!(await markProcessed(tx, msg.messageId))) return;
          await repo.applyPlanTx(
            tx as unknown as Parameters<typeof repo.applyPlanTx>[0],
            tenantId,
            userModules,
            profileCode,
            msg.actorId,
          );
          const t = tx as Parameters<typeof enqueue>[0];
          await enqueue(t, {
            topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
            tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
            payload: {
              service: "admin", action: "composition_apply_plan",
              resourceType: "tenant_composition", resourceId: tenantId, outcome: "success",
              profileCode, userModules,
            },
          });
        }),
      );
      // Entitlements changed -> drop any cached projection for this tenant. Done
      // AFTER the commit (a pre-commit invalidate lets a concurrent read re-cache
      // the old composition); also runs on an inbox-deduped replay, harmlessly.
      await cache.invalidate(cache.makeKey(tenantId, "composition", tenantId));
      await notifyGatewayModuleCache(tenantId);
    } catch (err) {
      log.error({ err, messageId: msg.messageId, type: COMMANDS.compositionApplyPlan }, "Consumer processing failed");
      throw err; // fail loud: retried / DLQ'd, never a silent half-write
    }
  });

  // M6 — maker-checker: record a plan-application request. Nothing is applied here.
  queue.subscribe<PlanApplyRequestPayload>(COMMANDS.compositionPlanApplyRequest, async (msg) => {
    const p = msg.payload;
    try {
      const reg = buildRegistry(await repo.loadRegistry(p.tenantId));
      const userModules = resolveComposition(reg, p.moduleIds).entries.filter((e) => e.source === "user").map((e) => e.id).sort();
      await runWithTenant(p.tenantId, () =>
        db.transaction(async (tx) => {
          if (!(await markProcessed(tx, msg.messageId))) return;
          await tx.insert(planApplyRequests).values({
            id: p.requestId, tenantId: p.tenantId, planId: p.planId, planCode: p.planCode, moduleIds: p.moduleIds, userModuleIds: userModules,
            profileCode: p.profileCode, requestedBy: msg.actorId,
          });
          await enqueue(tx as Parameters<typeof enqueue>[0], {
            topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
            payload: {
              service: "admin", action: "composition_plan_apply_requested", resourceType: "plan_apply_request", resourceId: p.requestId,
              outcome: "success", targetTenantId: p.tenantId, planCode: p.planCode, userModules, profileCode: p.profileCode,
            },
          });
        }),
      );
    } catch (err) {
      log.error({ err, messageId: msg.messageId, type: COMMANDS.compositionPlanApplyRequest }, "Consumer processing failed");
      throw err;
    }
  });

  // M6 — maker-checker: the checker's decision. Approve = the same write as apply-plan, in the same transaction as the
  // status change and the audit event. The consumer is authoritative: the request must be pending and the decider must
  // not be the requester (the DB CHECK is the last line).
  queue.subscribe<PlanApplyDecidePayload>(COMMANDS.compositionPlanApplyDecide, async (msg) => {
    const p = msg.payload;
    let applied = false;
    try {
      await runWithTenant(p.tenantId, () =>
        db.transaction(async (tx) => {
          if (!(await markProcessed(tx, msg.messageId))) return;
          const rows = await tx.select().from(planApplyRequests)
            .where(and(eq(planApplyRequests.id, p.requestId), eq(planApplyRequests.tenantId, p.tenantId))).for("update");
          const req = rows[0];
          if (!req) throw new Error(`plan application ${p.requestId} not found`);
          if (req.status !== "pending") throw new Error(`plan application ${p.requestId} is already ${req.status}`);
          if (req.requestedBy === msg.actorId) throw new Error("MAKER_CHECKER_VIOLATION: the requester cannot decide their own plan application");
          const audit = (action: string, extra: Record<string, unknown>) =>
            enqueue(tx as Parameters<typeof enqueue>[0], {
              topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
              payload: { service: "admin", action, resourceType: "plan_apply_request", resourceId: p.requestId, outcome: "success", targetTenantId: p.tenantId, planCode: req.planCode, requestedBy: req.requestedBy, ...extra },
            });
          if (p.decision === "reject") {
            await tx.update(planApplyRequests).set({ status: "rejected", decidedBy: msg.actorId, decidedAt: new Date(), decisionReason: p.reason ?? null })
              .where(eq(planApplyRequests.id, p.requestId));
            await audit("composition_plan_apply_rejected", { reason: p.reason ?? null });
            return;
          }
          // re-validate against the registry as it is NOW (it may have changed since the request)
          const reg = buildRegistry(await repo.loadRegistry(p.tenantId));
          const userModules = resolveComposition(reg, req.moduleIds).entries.filter((e) => e.source === "user").map((e) => e.id).sort();
          const before = (await tx.select({ id: tenantEntitlement.moduleId }).from(tenantEntitlement)
            .where(and(eq(tenantEntitlement.tenantId, p.tenantId), eq(tenantEntitlement.source, "user")))).map((r) => r.id).sort();
          await repo.applyPlanTx(tx as unknown as Parameters<typeof repo.applyPlanTx>[0], p.tenantId, userModules, req.profileCode, msg.actorId);
          await tx.update(planApplyRequests).set({ status: "applied", decidedBy: msg.actorId, decidedAt: new Date(), userModuleIds: userModules, previousUserModules: before })
            .where(eq(planApplyRequests.id, p.requestId));
          await audit("composition_plan_apply_approved", { userModules, previousUserModules: before, profileCode: req.profileCode });
          // the same audit action the direct applier writes, so the existing trail queries still see every entitlement change
          await enqueue(tx as Parameters<typeof enqueue>[0], {
            topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
            payload: { service: "admin", action: "composition_apply_plan", resourceType: "tenant_composition", resourceId: p.tenantId, outcome: "success", profileCode: req.profileCode, userModules },
          });
          applied = true;
        }),
      );
      if (applied) {
        await cache.invalidate(cache.makeKey(p.tenantId, "composition", p.tenantId));
        await notifyGatewayModuleCache(p.tenantId);
      }
    } catch (err) {
      log.error({ err, messageId: msg.messageId, type: COMMANDS.compositionPlanApplyDecide }, "Consumer processing failed");
      throw err;
    }
  });
}
