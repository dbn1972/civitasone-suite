import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { db } from "../../shared/db.js";
import { enqueue } from "../../shared/outbox.js";
import { EVENTS } from "../../topics.js";
import * as repo from "./repo.js";
import * as profilesRepo from "../profiles/repo.js";
import { validateConsent, MAX_BATCH_SIZE } from "./domain.js";

const CDP_ROLES = ["cdp_user", "cdp_admin", "super_admin"];

const ingestBody = z.object({
  profileId: z.string().uuid(),
  eventType: z.string().min(1).max(128),
  payload: z.record(z.unknown()).default({}),
  occurredAt: z.string().datetime(),
});

const batchBody = z.object({
  events: z.array(z.object({
    profileId: z.string().uuid(),
    eventType: z.string().min(1).max(128),
    payload: z.record(z.unknown()).default({}),
    occurredAt: z.string().datetime(),
  })).min(1).max(MAX_BATCH_SIZE),
});

const profileEventsQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  eventType: z.string().optional(),
});

const idParam = z.object({ id: z.string().uuid() });

export async function eventRoutes(app: FastifyInstance): Promise<void> {
  // POST /v1/cdp/events — ingest a single event
  app.post("/v1/cdp/events", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CDP_ROLES);
    const body = ingestBody.parse(req.body);

    // Verify profile exists
    const profile = await profilesRepo.findById(body.profileId, ctx.tenantId);
    if (!profile || profile.profileType === "merged") {
      throw new HttpError(404, "NOT_FOUND", "profile not found");
    }

    // Consent validation
    const consentFlags = profile.attributes.consent as Record<string, boolean> | undefined;
    const consentResult = validateConsent(body.eventType, consentFlags);
    if (!consentResult.allowed) {
      throw new HttpError(422, "CONSENT_DENIED", consentResult.reason ?? "consent denied");
    }

    const eventId = randomUUID();
    await db.transaction(async (tx) => {
      await repo.insert(tx, {
        id: eventId,
        tenantId: ctx.tenantId,
        profileId: body.profileId,
        eventType: body.eventType,
        payload: body.payload,
        occurredAt: new Date(body.occurredAt),
        createdBy: ctx.actorId,
        updatedBy: ctx.actorId,
      });

      await enqueue(tx, {
        topic: EVENTS.eventIngested,
        eventType: EVENTS.eventIngested,
        tenantId: ctx.tenantId,
        actorId: ctx.actorId,
        correlationId: ctx.correlationId,
        payload: { eventId, profileId: body.profileId, eventType: body.eventType },
      });
    });

    return reply.code(201).send({
      data: { id: eventId, profileId: body.profileId, eventType: body.eventType, status: "ingested" },
    });
  });

  // POST /v1/cdp/events/batch — ingest batch (up to 100 events)
  app.post("/v1/cdp/events/batch", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CDP_ROLES);
    const body = batchBody.parse(req.body);

    const results: Array<{ index: number; id: string; status: "ingested" | "rejected"; reason?: string }> = [];

    await db.transaction(async (tx) => {
      const eventsToInsert: Array<{
        id: string;
        tenantId: string;
        profileId: string;
        eventType: string;
        payload: Record<string, unknown>;
        occurredAt: Date;
        createdBy: string;
        updatedBy: string;
      }> = [];

      for (let i = 0; i < body.events.length; i++) {
        const ev = body.events[i]!;

        // Verify profile
        const profile = await profilesRepo.findById(ev.profileId, ctx.tenantId);
        if (!profile || profile.profileType === "merged") {
          results.push({ index: i, id: "", status: "rejected", reason: "profile not found" });
          continue;
        }

        // Consent check
        const consentFlags = profile.attributes.consent as Record<string, boolean> | undefined;
        const consentResult = validateConsent(ev.eventType, consentFlags);
        if (!consentResult.allowed) {
          results.push({ index: i, id: "", status: "rejected", reason: consentResult.reason ?? "consent denied" });
          continue;
        }

        const eventId = randomUUID();
        eventsToInsert.push({
          id: eventId,
          tenantId: ctx.tenantId,
          profileId: ev.profileId,
          eventType: ev.eventType,
          payload: ev.payload,
          occurredAt: new Date(ev.occurredAt),
          createdBy: ctx.actorId,
          updatedBy: ctx.actorId,
        });
        results.push({ index: i, id: eventId, status: "ingested" });
      }

      if (eventsToInsert.length > 0) {
        await repo.insertBatch(tx, eventsToInsert);

        await enqueue(tx, {
          topic: EVENTS.eventIngested,
          eventType: EVENTS.eventIngested,
          tenantId: ctx.tenantId,
          actorId: ctx.actorId,
          correlationId: ctx.correlationId,
          payload: { batchSize: eventsToInsert.length, eventIds: eventsToInsert.map((e) => e.id) },
        });
      }
    });

    const ingested = results.filter((r) => r.status === "ingested").length;
    const rejected = results.filter((r) => r.status === "rejected").length;

    return reply.code(ingested > 0 ? 201 : 422).send({
      data: { ingested, rejected, results },
    });
  });

  // GET /v1/cdp/profiles/:id/events — paginated event history for a profile
  app.get("/v1/cdp/profiles/:id/events", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CDP_ROLES);
    const { id } = idParam.parse(req.params);
    const q = profileEventsQuery.parse(req.query);

    // Verify profile exists
    const profile = await profilesRepo.findById(id, ctx.tenantId);
    if (!profile || profile.profileType === "merged") {
      throw new HttpError(404, "NOT_FOUND", "profile not found");
    }

    const { rows, total } = await repo.listByProfile(id, ctx.tenantId, q.limit, q.offset, q.eventType);
    const page = Math.floor(q.offset / q.limit) + 1;

    return reply.send({
      data: rows.map(repo.toView),
      meta: { page, pageSize: q.limit, total },
    });
  });
}
