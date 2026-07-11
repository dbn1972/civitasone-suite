import { NonRetryableError, type CommandEnvelope } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed, versionedUpdate } from "../../shared/outbox.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import { configEntries } from "./schema.js";
import * as repo from "./repo.js";
import { assertValidNamespace, assertValidKey } from "./domain.js";

type SetConfigPayload = {
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
};

type DeactivateConfigPayload = {
  configId: string;
  tenantId: string;
  expectedVersion: number;
};

export function registerConfigConsumers(
  register: <T>(topic: string, handler: (msg: CommandEnvelope<T>) => Promise<void>) => void,
): void {
  // Set (create or version-guarded update) a config entry (§47).
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
        // A concurrent create with a DIFFERENT id but the same (tenant, namespace,
        // config_key) trips the uq constraint; that is a permanent conflict, not a
        // transient fault — surface it as NonRetryable so it never churns the DLQ.
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
        // expectedVersion is a conflict; absent means a blind write of the
        // current row.
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

      // Invalidate the (tenant, namespace) read cache on commit so subsequent
      // reads see the new/updated value (fires only if the tx commits).
      await cache.invalidateResourceAfterCommit(tx, p.tenantId, `config:${p.namespace}`);

      await audit(tx, msg, "set", "court_config", p.id);
    });
  });

  // Deactivate (soft-retire) a config entry (§47) — version-guarded.
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
        set: {
          active: false,
          updatedBy: msg.actorId,
          updatedAt: new Date(),
        },
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

      await cache.invalidateResourceAfterCommit(tx, p.tenantId, `config:${current.namespace}`);

      await audit(tx, msg, "deactivate", "court_config", p.configId);
    });
  });
}

async function audit(
  tx: Parameters<typeof markProcessed>[0],
  msg: { tenantId: string; actorId: string; correlationId: string },
  action: string,
  resourceType: string,
  resourceId: string,
): Promise<void> {
  await enqueue(tx, {
    topic: "audit.event.record",
    eventType: "audit.event.record",
    tenantId: msg.tenantId,
    actorId: msg.actorId,
    correlationId: msg.correlationId,
    payload: { service: "court", action, resourceType, resourceId, outcome: "success" },
  });
}
