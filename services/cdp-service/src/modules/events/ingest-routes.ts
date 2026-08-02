/**
 * events/ingest-routes.ts — CDP-003 near-real-time batch event ingestion.
 * Validates and publishes one command per event via commands.ts (no DB writes).
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { resolveContext, requireRole } from "../../shared/context.js";
import * as commands from "./commands.js";

const CDP_ROLES = ["cdp_user", "cdp_admin", "super_admin", "tenant_admin"];

export const MAX_INGEST_BATCH = 500;

const eventSchema = z.object({
  profileId: z.string().uuid(),
  eventType: z.string().min(1).max(128),
  payload: z.record(z.unknown()).default({}),
  occurredAt: z.string().datetime(),
});

const envelopeSchema = z.object({
  events: z.array(z.unknown()).min(1).max(MAX_INGEST_BATCH),
  source: z.string().min(1).max(64).optional(),
});

export async function eventIngestRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/cdp/events/ingest-batch", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CDP_ROLES);
    const envelope = envelopeSchema.parse(req.body);

    const rejected: Array<{ index: number; reason: string }> = [];
    let accepted = 0;

    for (let i = 0; i < envelope.events.length; i++) {
      const parsed = eventSchema.safeParse(envelope.events[i]);
      if (!parsed.success) {
        const first = parsed.error.issues[0];
        rejected.push({
          index: i,
          reason: first === undefined ? "invalid event" : `${first.path.join(".") || "event"}: ${first.message}`,
        });
        continue;
      }
      const ev = parsed.data;
      try {
        await commands.ingestEvent(ctx, {
          profileId: ev.profileId,
          eventType: ev.eventType,
          payload: ev.payload,
          occurredAt: ev.occurredAt,
          ...(envelope.source !== undefined ? { source: envelope.source } : {}),
        });
        accepted++;
      } catch (err) {
        rejected.push({ index: i, reason: err instanceof Error ? err.message : "publish failed" });
      }
    }

    return reply.code(202).send({ data: { accepted, rejected } });
  });
}
