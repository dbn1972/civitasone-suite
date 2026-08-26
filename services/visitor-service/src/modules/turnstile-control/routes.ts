/**
 * visitor-service: turnstile-control HTTP routes (Fastify plugin).
 *
 * Device routes use deviceAuth preHandler (mTLS for turnstiles/barriers).
 * Admin/security routes use standard JWT auth (resolveContext/requireRole).
 *
 * CQRS pattern: route → zod validate → queue.publish → 202 Accepted.
 *
 * Routes:
 *   POST /v1/visitor/turnstiles/passage          (mTLS device auth)
 *   POST /v1/visitor/turnstiles/tailgating       (mTLS device auth)
 *   GET  /v1/visitor/turnstiles/commands/poll    (mTLS device auth)
 *   POST /v1/visitor/turnstiles/commands/:commandId/ack (mTLS device auth)
 *   POST /v1/visitor/turnstiles/emergency-unlock (admin auth)
 *   POST /v1/visitor/turnstiles/emergency-restore (admin auth)
 *   POST /v1/visitor/turnstiles/anti-passback/reset (admin auth)
 *   POST /v1/visitor/devices/sync               (device auth)
 *
 * Requirements validated: 7.1–7.10, 9.1–9.8
 */
import type { FastifyInstance } from "fastify";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { deviceAuth } from "../device-registry/device-auth.js";
import {
  passageEventBody,
  tailgatingBody,
  emergencyUnlockBody,
  emergencyRestoreBody,
  commandIdParams,
  antiPassbackResetBody,
  batchSyncBody,
} from "./validators.js";
import {
  publishPassageRecord,
  publishEmergencyUnlock,
  publishEmergencyRestore,
  publishOfflineSync,
} from "./commands.js";
import { dequeueCommand } from "./command-queue.js";
import { clearAntiPassbackState, updateCommandStatus } from "./repo.js";

// Roles permitted for admin/security turnstile management endpoints.
const ADMIN_ROLES = ["facility_admin", "security_admin", "tenant_admin", "super_admin"];

export default async function turnstileControlRoutes(app: FastifyInstance): Promise<void> {
  // ─────────────────────────────────────────────────────────────────────────
  // Device routes (mTLS device auth via deviceAuth preHandler)
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * POST /v1/visitor/turnstiles/passage — Report a passage event.
   * Route → zod validate → publishPassageRecord → 202.
   *
   * Fix 5 (gate binding): deviceAuth binds `deviceContext.gateId` from the
   * device's own registered gate (device-registry). The event's `gateId` is
   * client-supplied — a device authenticated for one gate must not be able
   * to report passage for a different one, so the two are compared before
   * anything is published.
   */
  app.post("/v1/visitor/turnstiles/passage", { preHandler: [deviceAuth], config: { public: true } }, async (req, reply) => {
    const deviceCtx = req.deviceContext!;
    const body = passageEventBody.parse(req.body);

    if (body.gateId !== deviceCtx.gateId) {
      throw new HttpError(403, "GATE_BINDING_MISMATCH", "device is not bound to the claimed gate");
    }

    const ctx = {
      tenantId: deviceCtx.tenantId,
      actorId: deviceCtx.deviceId,
      actorType: "user" as const,
      correlationId: crypto.randomUUID(),
      roles: [],
      sessionId: "",
    };

    const accepted = await publishPassageRecord(ctx, {
      passId: body.passId,
      gateId: body.gateId,
      direction: body.direction,
      passageCount: body.passageCount,
      eventTimestamp: body.eventTimestamp,
      offlineRecorded: body.offlineRecorded,
    });

    return reply.code(202).send({ data: accepted });
  });

  /**
   * POST /v1/visitor/turnstiles/tailgating — Report tailgating detection.
   * Route → zod validate → create security incident → 202.
   *
   * Fix 5 (gate binding): same enforcement as the passage handler above —
   * a device may only report tailgating for the gate it is actually bound to.
   */
  app.post("/v1/visitor/turnstiles/tailgating", { preHandler: [deviceAuth], config: { public: true } }, async (req, reply) => {
    const deviceCtx = req.deviceContext!;
    const body = tailgatingBody.parse(req.body);

    if (body.gateId !== deviceCtx.gateId) {
      throw new HttpError(403, "GATE_BINDING_MISMATCH", "device is not bound to the claimed gate");
    }

    const ctx = {
      tenantId: deviceCtx.tenantId,
      actorId: deviceCtx.deviceId,
      actorType: "user" as const,
      correlationId: crypto.randomUUID(),
      roles: [],
      sessionId: "",
    };

    // Tailgating events are recorded as passage events with eventType 'tailgating'
    const accepted = await publishPassageRecord(ctx, {
      passId: body.passId,
      gateId: body.gateId,
      direction: "in", // Tailgating is entry-direction
      passageCount: body.passageCount,
      eventTimestamp: new Date().toISOString(),
      offlineRecorded: false,
    });

    return reply.code(202).send({ data: accepted });
  });

  /**
   * GET /v1/visitor/turnstiles/commands/poll — Poll for pending commands.
   * Dequeues the next non-expired command from the device's command queue.
   * Returns 200 with command or 204 if no commands pending.
   */
  app.get("/v1/visitor/turnstiles/commands/poll", { preHandler: [deviceAuth], config: { public: true } }, async (req, reply) => {
    const deviceCtx = req.deviceContext!;

    const command = await dequeueCommand(deviceCtx.tenantId, deviceCtx.deviceId);

    if (command) {
      // Mark as delivered in DB (best-effort)
      try {
        await updateCommandStatus(deviceCtx.tenantId, command.id, "delivered", new Date());
      } catch {
        // Non-critical — device will still receive the command
      }
      return reply.code(200).send({ data: command });
    }

    return reply.code(204).send();
  });

  /**
   * POST /v1/visitor/turnstiles/commands/:commandId/ack — Acknowledge command.
   * Device confirms it has executed the command.
   */
  app.post("/v1/visitor/turnstiles/commands/:commandId/ack", { preHandler: [deviceAuth], config: { public: true } }, async (req, reply) => {
    const deviceCtx = req.deviceContext!;
    const { commandId } = commandIdParams.parse(req.params);

    await updateCommandStatus(deviceCtx.tenantId, commandId, "acknowledged", new Date());

    return reply.code(202).send({ data: { id: commandId, status: "acknowledged" } });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Admin/Security routes (JWT auth via resolveContext/requireRole)
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * POST /v1/visitor/turnstiles/emergency-unlock — Emergency unlock all turnstiles at location.
   */
  app.post("/v1/visitor/turnstiles/emergency-unlock", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const body = emergencyUnlockBody.parse(req.body);

    const accepted = await publishEmergencyUnlock(ctx, {
      locationId: body.locationId,
      reason: body.reason,
    });

    return reply.code(202).send({ data: accepted });
  });

  /**
   * POST /v1/visitor/turnstiles/emergency-restore — Restore normal operation.
   */
  app.post("/v1/visitor/turnstiles/emergency-restore", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const body = emergencyRestoreBody.parse(req.body);

    const accepted = await publishEmergencyRestore(ctx, {
      locationId: body.locationId,
    });

    return reply.code(202).send({ data: accepted });
  });

  /**
   * POST /v1/visitor/turnstiles/anti-passback/reset — Reset anti-passback for a visitor.
   * Clears the Redis anti-passback key immediately (synchronous operation).
   */
  app.post("/v1/visitor/turnstiles/anti-passback/reset", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const body = antiPassbackResetBody.parse(req.body);

    await clearAntiPassbackState(ctx.tenantId, body.passId);

    return reply.code(200).send({ data: { passId: body.passId, status: "reset" } });
  });

  /**
   * POST /v1/visitor/devices/sync — Batch sync offline-queued events.
   * Device auth (bearer or mTLS).
   */
  app.post("/v1/visitor/devices/sync", { preHandler: [deviceAuth], config: { public: true } }, async (req, reply) => {
    const deviceCtx = req.deviceContext!;
    const body = batchSyncBody.parse(req.body);

    const ctx = {
      tenantId: deviceCtx.tenantId,
      actorId: deviceCtx.deviceId,
      actorType: "user" as const,
      correlationId: crypto.randomUUID(),
      roles: [],
      sessionId: "",
    };

    const accepted = await publishOfflineSync(ctx, {
      deviceId: deviceCtx.deviceId,
      events: body.events,
    });

    return reply.code(202).send({ data: accepted });
  });
}
