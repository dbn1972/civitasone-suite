/**
 * events/ingest-routes.ts — CDP-003 near-real-time batch event ingestion.
 *
 * Differs from POST /v1/cdp/events/batch (which writes synchronously and caps at 100):
 * this endpoint is the high-throughput path. It validates and hands each event to the
 * bus, so a collector's request latency does not depend on database write time.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { resolveContext, requireRole } from "../../shared/context.js";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";

const CDP_ROLES = ["cdp_user", "cdp_admin", "super_admin", "tenant_admin"];

/** Ceiling on a single batch. Above this, a caller should page — one oversized request
 *  cannot be partially retried, and its failure loses everything in it. */
export const MAX_INGEST_BATCH = 500;

const eventSchema = z.object({
  profileId: z.string().uuid(),
  eventType: z.string().min(1).max(128),
  payload: z.record(z.unknown()).default({}),
  occurredAt: z.string().datetime(),
});

/**
 * The envelope is validated strictly; individual events are validated leniently
 * (`z.unknown()`) so one malformed event out of 500 is reported by index instead of
 * rejecting 499 good ones.
 */
const envelopeSchema = z.object({
  events: z.array(z.unknown()).min(1).max(MAX_INGEST_BATCH),
  source: z.string().min(1).max(64).optional(),
});

export async function eventIngestRoutes(app: FastifyInstance): Promise<void> {
  // POST /v1/cdp/events/ingest-batch — up to 500 events, per-event error reporting (CDP-003)
  app.post("/v1/cdp/events/ingest-batch", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CDP_ROLES);
    // A bad envelope is the only fatal case: without a usable `events` array there is
    // nothing to report per-event failures against.
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
        await queue.publish(COMMANDS.ingestEventBatch, {
          type: COMMANDS.ingestEventBatch,
          tenantId: ctx.tenantId,
          actorId: ctx.actorId,
          correlationId: ctx.correlationId,
          schemaVersion: "1.0",
          payload: {
            profileId: ev.profileId,
            eventType: ev.eventType,
            payload: ev.payload,
            occurredAt: ev.occurredAt,
            ...(envelope.source !== undefined ? { source: envelope.source } : {}),
          },
        });
        accepted++;
      } catch (err) {
        // A publish failure is reported against its index rather than failing the batch:
        // the caller can retry exactly the events that did not make it.
        rejected.push({ index: i, reason: err instanceof Error ? err.message : "publish failed" });
      }
    }

    return reply.code(202).send({ data: { accepted, rejected } });
  });
}
