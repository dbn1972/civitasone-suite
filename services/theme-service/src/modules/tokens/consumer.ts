import type { Queue, CommandEnvelope } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS, RESOURCE } from "../../topics.js";
import * as repo from "./repo.js";
import * as brandRepo from "./brand-repo.js";
import { BRAND_RESOURCE } from "./brand-defaults.js";
import type { TokenView } from "./schema.js";
import type { ApplyBrandPresetPayload, UpsertBrandConfigPayload } from "./commands.js";

const AUDIT_TOPIC = "audit.event.record";

function tokenKeyFor(tenantId: string, id: string) {
  return cache.makeKey(tenantId, RESOURCE, id);
}

function brandConfigKey(tenantId: string) {
  return cache.makeKey(tenantId, BRAND_RESOURCE, "config");
}

export function registerTokenConsumers(queue: Queue): void {
  queue.subscribe<TokenView>(COMMANDS.createToken, async (msg) => {
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const p = msg.payload;
      await repo.insert(tx, {
        id: p.id,
        tenantId: p.tenantId,
        name: p.name,
        value: p.value,
        category: p.category,
        status: p.status,
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
        version: 1,
      });
      await emit(tx, msg, EVENTS.tokenCreated, { tokenId: p.id, name: p.name }, "create", p.id, "token");
    });
    await cache.put(tokenKeyFor(msg.tenantId, msg.payload.id), msg.payload);
    await cache.invalidateResource(msg.tenantId, RESOURCE);
  });

  queue.subscribe<UpsertBrandConfigPayload>(COMMANDS.upsertBrandConfig, async (msg) => {
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const { projected, isCreate } = msg.payload;
      if (isCreate) {
        await brandRepo.insert(tx, projected);
      } else {
        const { tenantId, ...patch } = projected;
        await brandRepo.update(tx, tenantId, patch);
      }
      await emit(
        tx,
        msg,
        EVENTS.brandConfigUpserted,
        { tenantId: projected.tenantId, version: projected.version },
        "upsert",
        projected.tenantId,
        "brand",
      );
    });
    await cache.put(brandConfigKey(msg.tenantId), msg.payload.projected);
    await cache.invalidateResource(msg.tenantId, BRAND_RESOURCE);
  });

  queue.subscribe<ApplyBrandPresetPayload>(COMMANDS.applyBrandPreset, async (msg) => {
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const { projected, isCreate, presetCode } = msg.payload;
      if (isCreate) {
        await brandRepo.insert(tx, projected);
      } else {
        const { tenantId, ...patch } = projected;
        await brandRepo.update(tx, tenantId, patch);
      }
      await emit(
        tx,
        msg,
        EVENTS.brandPresetApplied,
        { tenantId: projected.tenantId, presetCode, version: projected.version },
        "apply-preset",
        projected.tenantId,
        "brand",
      );
    });
    await cache.put(brandConfigKey(msg.tenantId), msg.payload.projected);
    await cache.invalidateResource(msg.tenantId, BRAND_RESOURCE);
  });
}

async function emit(
  tx: unknown,
  msg: CommandEnvelope,
  eventType: string,
  payload: Record<string, unknown>,
  action: string,
  resourceId: string,
  resourceType: string,
): Promise<void> {
  const t = tx as Parameters<typeof enqueue>[0];
  await enqueue(t, { topic: eventType, eventType, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload });
  await enqueue(t, {
    topic: AUDIT_TOPIC,
    eventType: AUDIT_TOPIC,
    tenantId: msg.tenantId,
    actorId: msg.actorId,
    correlationId: msg.correlationId,
    payload: { service: "themes", action, resourceType, resourceId, outcome: "success" },
  });
}
