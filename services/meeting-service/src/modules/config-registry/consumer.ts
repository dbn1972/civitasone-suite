/**
 * meeting-service: config-registry consumer.
 *
 * Handles `COMMANDS.setConfig` / `COMMANDS.deactivateConfig` (CQRS write path):
 *   markProcessed(tx, msg.messageId) -> validate namespace/key -> insert (v1) or
 *   version-guarded update of `meeting.config_entries` -> enqueue the
 *   configSet/configDeactivated outbox event -> invalidate the (tenant, namespace)
 *   read cache after commit. All writes run on the tenant-GUC-scoped `db` (the
 *   worker's router enters runWithTenant(msg.tenantId, …) before invoking the
 *   handler), so the FORCE-RLS policy on config_entries re-checks every mutation.
 *
 * `commands.ts` mints the entry's deterministic `id` BEFORE publishing (stable per
 * (tenant, namespace, key)); this consumer inserts with that exact id so a
 * redelivery is an idempotent no-op and re-setting the same key is an upsert.
 *
 * Registration follows the meeting-service module convention: a
 * `registerConfigRegistryConsumers(register)` that maps each COMMANDS topic to its
 * handler via the worker's `registerConsumer` (mirrors registerAgendaConsumers etc.).
 * Mirrors court/visitor config-registry consumer behavior.
 */
import { NonRetryableError } from "@civitasone/queue";
import type { CommandEnvelope } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed, versionedUpdate } from "../../shared/outbox.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import { configEntries } from "./schema.js";
import * as repo from "./repo.js";
import { assertValidNamespace, assertValidKey } from "./domain.js";

const AUDIT_TOPIC = "audit.event.record";

interface SetConfigPayload {
  id: string;
  tenantId: string;
  namespace: string;
  configKey: string;
  value: unknown;
  label?: string;
  description?: string;
  sortOrder?: number;
  effectiveFrom?: string; // YYYY-MM-DD
  effectiveTo?: string; // YYYY-MM-DD
  expectedVersion?: number;
}

interface DeactivateConfigPayload {
  configId: string;
  tenantId: string;
  expectedVersion: number;
}

/** A single-topic consumer registrar, matching the meeting worker's `registerConsumer`. */
export type RegisterConsumer = <T>(
  topic: string,
  handler: (msg: CommandEnvelope<T>) => Promise<void>,
) => void;

export function registerConfigRegistryConsumers(register: RegisterConsumer): void {
  // ─── setConfig (create or version-guarded update) ────────────────────────
  register<SetConfigPayload>(COMMANDS.setConfig, async (msg) => {
    const p = msg.payload;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;

      // Bad namespace/key is a permanent (poison) message — never retried.
      try {
        assertValidNamespace(p.namespace);
        assertValidKey(p.configKey);
      } catch (e) {
        throw new NonRetryableError((e as Error).message);
      }

      const current = await repo.getConfigForUpdate(tx, p.tenantId, p.id);

      if (!current) {
        // First write for this (tenant, namespace, key) → create at version 1.
        try {
          await repo.insertConfig(tx, {
            id: p.id,
            tenantId: p.tenantId,
            namespace: p.namespace,
            configKey: p.configKey,
            value: p.value,
            label: p.label ?? null,
            description: p.description ?? null,
            active: true,
            sortOrder: p.sortOrder ?? 0,
            effectiveFrom: p.effectiveFrom ?? null,
            effectiveTo: p.effectiveTo ?? null,
            createdBy: msg.actorId,
            updatedBy: msg.actorId,
          });
        } catch (e) {
          if (repo.isUniqueViolation(e)) {
            throw new NonRetryableError(
              `CONFIG_ALREADY_EXISTS: ${p.namespace}/${p.configKey} already exists for this tenant`,
            );
          }
          throw e;
        }
      } else {
        // Existing entry → version-guarded update. A provided-but-mismatched
        // expectedVersion is a conflict; absent means a blind write of the row.
        if (p.expectedVersion !== undefined && p.expectedVersion !== current.version) {
          throw new NonRetryableError(
            `VERSION_CONFLICT: config ${p.id} expected v${p.expectedVersion}, found v${current.version}`,
          );
        }
        await versionedUpdate(tx, configEntries, {
          id: p.id,
          tenantId: p.tenantId,
          expectedVersion: p.expectedVersion ?? current.version,
          set: {
            value: p.value,
            label: p.label ?? null,
            description: p.description ?? null,
            sortOrder: p.sortOrder ?? 0,
            effectiveFrom: p.effectiveFrom ?? null,
            effectiveTo: p.effectiveTo ?? null,
            active: true,
            updatedBy: msg.actorId,
            updatedAt: new Date(),
          },
          entity: "config",
        });
      }

      await enqueue(tx, {
        topic: EVENTS.configSet,
        eventType: EVENTS.configSet,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { id: p.id, namespace: p.namespace, configKey: p.configKey },
      });

      await enqueue(tx, {
        topic: AUDIT_TOPIC,
        eventType: AUDIT_TOPIC,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { service: "meeting", action: "set_config", resourceType: "config_entry", resourceId: p.id, outcome: "success" },
      });

      // Invalidate the (tenant, namespace) read cache on commit so subsequent
      // reads see the new/updated value (fires only if the tx commits).
      await cache.invalidateResourceAfterCommit(tx, p.tenantId, `config:${p.namespace}`);
    });
  });

  // ─── deactivateConfig (soft-retire) — version-guarded ────────────────────
  register<DeactivateConfigPayload>(COMMANDS.deactivateConfig, async (msg) => {
    const p = msg.payload;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;

      const current = await repo.getConfigForUpdate(tx, p.tenantId, p.configId);
      if (!current) throw new NonRetryableError(`CONFIG_NOT_FOUND: ${p.configId}`);
      if (!current.active) return; // already inactive; no-op

      if (current.version !== p.expectedVersion) {
        throw new NonRetryableError(
          `VERSION_CONFLICT: config ${p.configId} expected v${p.expectedVersion}, found v${current.version}`,
        );
      }

      await versionedUpdate(tx, configEntries, {
        id: p.configId,
        tenantId: p.tenantId,
        expectedVersion: p.expectedVersion,
        set: { active: false, updatedBy: msg.actorId, updatedAt: new Date() },
        entity: "config",
      });

      await enqueue(tx, {
        topic: EVENTS.configDeactivated,
        eventType: EVENTS.configDeactivated,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { id: p.configId, namespace: current.namespace },
      });

      await enqueue(tx, {
        topic: AUDIT_TOPIC,
        eventType: AUDIT_TOPIC,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { service: "meeting", action: "deactivate_config", resourceType: "config_entry", resourceId: p.configId, outcome: "success" },
      });

      await cache.invalidateResourceAfterCommit(tx, p.tenantId, `config:${current.namespace}`);
    });
  });
}
