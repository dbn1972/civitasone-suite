import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import * as repo from "./repo.js";
import * as profilesRepo from "../profiles/repo.js";
import { validateConsent, MAX_BATCH_SIZE } from "./domain.js";
import * as commands from "./commands.js";

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
  app.post("/v1/cdp/events", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CDP_ROLES);
    const body = ingestBody.parse(req.body);

    const profile = await profilesRepo.findById(body.profileId, ctx.tenantId);
    if (!profile || profile.profileType === "merged") {
      throw new HttpError(404, "NOT_FOUND", "profile not found");
    }

    const consentFlags = profile.attributes.consent as Record<string, boolean> | undefined;
    const consentResult = validateConsent(body.eventType, consentFlags);
    if (!consentResult.allowed) {
      throw new HttpError(422, "CONSENT_DENIED", consentResult.reason ?? "consent denied");
    }

    return reply.code(202).send(await commands.ingestEvent(ctx, body));
  });

  app.post("/v1/cdp/events/batch", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CDP_ROLES);
    const body = batchBody.parse(req.body);

    const results: Array<{ index: number; id: string; status: "accepted" | "rejected"; reason?: string }> = [];
    let accepted = 0;

    for (let i = 0; i < body.events.length; i++) {
      const ev = body.events[i]!;
      const profile = await profilesRepo.findById(ev.profileId, ctx.tenantId);
      if (!profile || profile.profileType === "merged") {
        results.push({ index: i, id: "", status: "rejected", reason: "profile not found" });
        continue;
      }
      const consentFlags = profile.attributes.consent as Record<string, boolean> | undefined;
      const consentResult = validateConsent(ev.eventType, consentFlags);
      if (!consentResult.allowed) {
        results.push({ index: i, id: "", status: "rejected", reason: consentResult.reason ?? "consent denied" });
        continue;
      }
      const ack = await commands.ingestEvent(ctx, ev);
      accepted++;
      results.push({ index: i, id: ack.id, status: "accepted" });
    }

    const rejected = results.filter((r) => r.status === "rejected").length;
    return reply.code(accepted > 0 ? 202 : 422).send({
      data: { accepted, rejected, results },
    });
  });

  app.get("/v1/cdp/profiles/:id/events", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CDP_ROLES);
    const { id } = idParam.parse(req.params);
    const q = profileEventsQuery.parse(req.query);

    const profile = await profilesRepo.findById(id, ctx.tenantId);
    if (!profile || profile.profileType === "merged") {
      throw new HttpError(404, "NOT_FOUND", "profile not found");
    }

    const { rows, total } = await repo.listByProfile(id, ctx.tenantId, q.limit, q.offset, q.eventType);
    const page = Math.floor(q.offset / q.limit) + 1;
    return reply.send({ data: rows.map(repo.toView), meta: { page, pageSize: q.limit, total } });
  });
}
