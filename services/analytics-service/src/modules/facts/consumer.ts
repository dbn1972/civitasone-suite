/**
 * facts ingestion consumer — the bridge that brings cross-domain data into
 * analytics WITHOUT reading another service's database. It subscribes to domain
 * events and projects them into analytics.fact_events.
 *
 * Idempotent on two levels:
 *   1. inbox markProcessed(messageId) — a redelivered envelope is a no-op.
 *   2. fact_events (tenant_id, dedupe_key) unique + ON CONFLICT DO NOTHING.
 */
import type { Queue, CommandEnvelope } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { markProcessed } from "../../shared/outbox.js";
import { INBOUND, FACT_RESOURCE } from "../../topics.js";
import * as repo from "./repo.js";
import { normalizeFact } from "./normalize.js";

async function ingestEvent(eventType: string, msg: CommandEnvelope): Promise<void> {
  await db.transaction(async (tx) => {
    if (!(await markProcessed(tx, msg.messageId))) return; // already processed
    const row = normalizeFact(eventType, {
      messageId: msg.messageId,
      tenantId: msg.tenantId,
      payload: msg.payload as Record<string, unknown>,
    });
    await repo.ingest(tx, row);
  });
  await cache.invalidateResource(msg.tenantId, FACT_RESOURCE);
}

export function registerFactsConsumers(queue: Queue): void {
  for (const eventType of Object.values(INBOUND)) {
    queue.subscribe<Record<string, unknown>>(eventType, (msg) => ingestEvent(eventType, msg));
  }
}
