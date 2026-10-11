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
import { COMMANDS } from "../../topics.js";
import * as repo from "./repo.js";
import { buildRegistry, resolveComposition } from "./domain.js";

const log = pino({ name: "admin-composition-applier" });
const AUDIT_TOPIC = "audit.event.record";

interface ApplyPlanPayload {
  tenantId: string;
  moduleIds: string[];
  profileCode: string | null;
}

export function registerCompositionConsumers(queue: Queue): void {
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
    } catch (err) {
      log.error({ err, messageId: msg.messageId, type: COMMANDS.compositionApplyPlan }, "Consumer processing failed");
      throw err; // fail loud: retried / DLQ'd, never a silent half-write
    }
  });
}
