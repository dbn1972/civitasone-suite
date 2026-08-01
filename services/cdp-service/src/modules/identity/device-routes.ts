/**
 * identity/device-routes.ts — CDP-007 cross-device identity graph (tokenised).
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { db } from "../../shared/db.js";
import { enqueue } from "../../shared/outbox.js";
import { queue, cache } from "../../shared/infra.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import * as deviceRepo from "./device-repo.js";
import * as profilesRepo from "../profiles/repo.js";

const CDP_ROLES = ["cdp_user", "cdp_admin", "super_admin", "tenant_admin"];
const WRITE_ROLES = ["cdp_user", "cdp_admin", "super_admin", "tenant_admin"];

const DEVICE_TYPES = ["ios", "android", "web", "kiosk", "unknown"] as const;

const linkBody = z.object({
  profileId: z.string().uuid(),
  // A token, never a fingerprint. Minimum length keeps a caller from passing a short
  // guessable value that would collide across users.
  deviceToken: z.string().min(16).max(256),
  deviceType: z.enum(DEVICE_TYPES).default("unknown"),
});

const idParam = z.object({ id: z.string().uuid() });

const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export async function identityDeviceRoutes(app: FastifyInstance): Promise<void> {
  // POST /v1/cdp/identity/devices — link a device token to a profile (CDP-007)
  app.post("/v1/cdp/identity/devices", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const body = linkBody.parse(req.body);

    const profile = await profilesRepo.findById(body.profileId, ctx.tenantId);
    if (!profile || profile.profileType === "merged") {
      throw new HttpError(404, "NOT_FOUND", "profile not found");
    }

    const existing = await deviceRepo.findByToken(body.deviceToken, ctx.tenantId);
    const seenAt = new Date();
    const id = existing?.id ?? randomUUID();

    await db.transaction(async (tx) => {
      if (existing) {
        // A device that changes hands moves to the new profile rather than duplicating
        // the edge — a token identifies one device, and a device has one owner.
        const ok = await deviceRepo.relink(tx, existing.id, ctx.tenantId, existing.version, {
          profileId: body.profileId,
          deviceType: body.deviceType,
          lastSeenAt: seenAt,
        });
        if (!ok) {
          throw new HttpError(409, "VERSION_CONFLICT", "device link has been modified; retry");
        }
      } else {
        await deviceRepo.insert(tx, {
          id,
          tenantId: ctx.tenantId,
          profileId: body.profileId,
          deviceToken: body.deviceToken,
          deviceType: body.deviceType,
          lastSeenAt: seenAt,
        });
      }

      await enqueue(tx, {
        topic: EVENTS.deviceLinked,
        eventType: EVENTS.deviceLinked,
        tenantId: ctx.tenantId,
        actorId: ctx.actorId,
        correlationId: ctx.correlationId,
        // The token is deliberately absent from the event payload: an event fans out to
        // services that have no business holding a device credential.
        payload: { deviceId: id, profileId: body.profileId, deviceType: body.deviceType, relinked: existing !== null },
      });

      await enqueue(tx, {
        topic: "audit.event.record",
        eventType: "audit.event.record",
        tenantId: ctx.tenantId,
        actorId: ctx.actorId,
        correlationId: ctx.correlationId,
        payload: {
          service: "cdp",
          action: existing ? "device_relinked" : "device_linked",
          resourceType: "device_token",
          resourceId: id,
          outcome: "success",
          metadata: { profileId: body.profileId, deviceType: body.deviceType },
        },
      });
    });

    await queue.publish(COMMANDS.linkDevice, {
      type: COMMANDS.linkDevice,
      tenantId: ctx.tenantId,
      actorId: ctx.actorId,
      correlationId: ctx.correlationId,
      schemaVersion: "1.0",
      payload: { deviceId: id, profileId: body.profileId, deviceType: body.deviceType },
    });

    await cache.invalidate(cache.makeKey(ctx.tenantId, "profile_summary", body.profileId));

    return reply.code(202).send({
      data: {
        id,
        profileId: body.profileId,
        deviceType: body.deviceType,
        relinked: existing !== null,
        status: "accepted",
      },
    });
  });

  // GET /v1/cdp/profiles/:id/devices — linked devices for a profile (CDP-007)
  app.get("/v1/cdp/profiles/:id/devices", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CDP_ROLES);
    const { id } = idParam.parse(req.params);
    const q = listQuery.parse(req.query);

    const profile = await profilesRepo.findById(id, ctx.tenantId);
    if (!profile || profile.profileType === "merged") {
      throw new HttpError(404, "NOT_FOUND", "profile not found");
    }

    const { rows, total } = await deviceRepo.listByProfile(id, ctx.tenantId, q.limit, q.offset);

    return reply.send({
      data: rows.map(deviceRepo.toView),
      meta: { page: Math.floor(q.offset / q.limit) + 1, pageSize: q.limit, total },
    });
  });
}
