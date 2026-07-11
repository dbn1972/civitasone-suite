/**
 * visitor-service: device-registry HTTP routes (Fastify plugin).
 *
 * Admin routes use standard JWT auth (resolveContext/requireRole).
 * The heartbeat route uses device-auth middleware (deviceAuth preHandler).
 *
 * CQRS pattern: route → zod validate → queue.publish → 202 Accepted.
 * Read endpoints go through repo (cache.getOrLoad).
 *
 * Requirements validated: 1.1–1.10, 2.4, 3.1–3.8, 8.1–8.8, 10.2, 10.5, 10.6
 */
import type { FastifyInstance } from "fastify";
import { eq, and } from "drizzle-orm";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { deviceAuth } from "./device-auth.js";
import { devices } from "./schema.js";
import {
  registerDeviceBody,
  updateDeviceBody,
  heartbeatBody,
  configPushBody,
  bulkConfigBody,
  listDevicesQuery,
  firmwareScheduleBody,
  deviceIdParams,
  locationIdParams,
  auditLogQuery,
} from "./validators.js";
import {
  publishDeviceRegister,
  publishDeviceActivate,
  publishDeviceSuspend,
  publishDeviceDeregister,
  publishDeviceRotateCredential,
  publishDeviceConfigPush,
  publishDeviceBulkConfigPush,
  publishDeviceFirmwareSchedule,
} from "./commands.js";
import {
  getDeviceById,
  listDevices,
  getAllLocationHealthSummaries,
  getLocationHealthSummary,
  getDeviceAuditLog,
  getFirmwareInventory,
} from "./repo.js";

// Roles permitted for admin device-management endpoints.
const ADMIN_ROLES = ["facility_admin", "security_admin", "tenant_admin", "super_admin"];

/** Redis status key for device online tracking (TTL 90s). */
function deviceStatusKey(tenantId: string, deviceId: string): string {
  return `visitor:${tenantId}:device:${deviceId}:status`;
}

export default async function deviceRegistryRoutes(app: FastifyInstance): Promise<void> {
  // ─────────────────────────────────────────────────────────────────────────
  // Admin routes (JWT auth via resolveContext/requireRole)
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * POST /v1/visitor/devices — Register a new device.
   * Route → zod validate → publishDeviceRegister → 202.
   */
  app.post("/v1/visitor/devices", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const body = registerDeviceBody.parse(req.body);

    const accepted = await publishDeviceRegister(ctx, {
      deviceType: body.deviceType,
      name: body.name,
      serialNumber: body.serialNumber,
      locationId: body.locationId,
      gateId: body.gateId ?? null,
      capabilities: body.capabilities,
    });
    return reply.code(202).send({ data: accepted });
  });

  /**
   * GET /v1/visitor/devices — List devices (paginated, filterable).
   */
  app.get("/v1/visitor/devices", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const query = listDevicesQuery.parse(req.query);

    const result = await listDevices(
      ctx.tenantId,
      {
        ...(query.locationId ? { locationId: query.locationId } : {}),
        ...(query.deviceType ? { deviceType: query.deviceType } : {}),
        ...(query.status ? { status: query.status } : {}),
      },
      query.page,
      query.pageSize,
    );
    return reply.send({ data: result.data, meta: result.meta });
  });

  /**
   * GET /v1/visitor/devices/health/summary — All locations health summary.
   * NOTE: Registered before /:deviceId to avoid path collision.
   */
  app.get("/v1/visitor/devices/health/summary", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);

    const summaries = await getAllLocationHealthSummaries(ctx.tenantId);
    return reply.send({ data: summaries });
  });

  /**
   * GET /v1/visitor/devices/health/:locationId — Single location health.
   */
  app.get("/v1/visitor/devices/health/:locationId", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { locationId } = locationIdParams.parse(req.params);

    const summary = await getLocationHealthSummary(ctx.tenantId, locationId);
    if (!summary) {
      throw new HttpError(404, "LOCATION_NOT_FOUND", "no devices found for this location");
    }
    return reply.send({ data: summary });
  });

  /**
   * GET /v1/visitor/devices/firmware/inventory — Firmware version inventory.
   */
  app.get("/v1/visitor/devices/firmware/inventory", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);

    const inventory = await getFirmwareInventory(ctx.tenantId);
    return reply.send({ data: inventory });
  });

  /**
   * POST /v1/visitor/devices/config/bulk — Bulk config push.
   */
  app.post("/v1/visitor/devices/config/bulk", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const body = bulkConfigBody.parse(req.body);

    const accepted = await publishDeviceBulkConfigPush(ctx, {
      deviceType: body.deviceType,
      locationId: body.locationId,
      config: body.config,
    });
    return reply.code(202).send({ data: accepted });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Device route (device-auth middleware)
  // NOTE: Registered before /:deviceId to avoid path collision.
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * POST /v1/visitor/devices/heartbeat — Device heartbeat.
   *
   * Uses deviceAuth preHandler hook for authentication.
   * Updates Redis status key with TTL 90s.
   * Updates device.lastSeenAt and device.firmwareVersion in DB.
   * If device has pending_config → include in response body.
   * Returns 200 with config payload or 204 if no config.
   *
   * Requirements: 3.1, 3.2, 3.8, 8.3
   */
  app.post("/v1/visitor/devices/heartbeat", { preHandler: [deviceAuth] }, async (req, reply) => {
    const deviceCtx = req.deviceContext!;
    const body = heartbeatBody.parse(req.body);

    const now = new Date();

    // 1. Update Redis status key with TTL 90s (device online tracking).
    const statusKey = deviceStatusKey(deviceCtx.tenantId, deviceCtx.deviceId);
    await cache.put(statusKey, {
      deviceId: deviceCtx.deviceId,
      online: true,
      lastSeenAt: now.toISOString(),
      firmwareVersion: body.firmwareVersion,
      cpuUtilization: body.cpuUtilization,
      memoryUtilization: body.memoryUtilization,
      peripheralStatus: body.peripheralStatus,
    }, 90);

    // 2. Update device lastSeenAt and firmwareVersion in DB.
    await db
      .update(devices)
      .set({
        lastSeenAt: now,
        firmwareVersion: body.firmwareVersion,
        online: true,
        updatedAt: now,
      })
      .where(
        and(
          eq(devices.id, deviceCtx.deviceId),
          eq(devices.tenantId, deviceCtx.tenantId),
        ),
      );

    // 3. Check for pending config and return it in the response.
    const device = await getDeviceById(deviceCtx.tenantId, deviceCtx.deviceId);
    if (device?.pendingConfig) {
      return reply.code(200).send({
        data: {
          config: device.pendingConfig,
          configVersion: device.configVersion,
        },
      });
    }

    // No pending config — return 204 No Content.
    return reply.code(204).send();
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Parameterized admin routes (/:deviceId)
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * GET /v1/visitor/devices/:deviceId — Get device by ID.
   */
  app.get("/v1/visitor/devices/:deviceId", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { deviceId } = deviceIdParams.parse(req.params);

    const device = await getDeviceById(ctx.tenantId, deviceId);
    if (!device) {
      throw new HttpError(404, "DEVICE_NOT_FOUND", "device not found");
    }
    return reply.send({ data: device });
  });

  /**
   * PATCH /v1/visitor/devices/:deviceId — Update device metadata.
   * Route → zod → publish → 202 (update handled by consumer).
   */
  app.patch("/v1/visitor/devices/:deviceId", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { deviceId } = deviceIdParams.parse(req.params);
    const body = updateDeviceBody.parse(req.body);

    // Publish a config/metadata update command via the register command
    // reusing the config push mechanism for metadata updates.
    const accepted = await publishDeviceConfigPush(ctx, {
      deviceId,
      config: { _metadataUpdate: true, ...body } as unknown as Record<string, unknown>,
    });
    return reply.code(202).send({ data: accepted });
  });

  /**
   * POST /v1/visitor/devices/:deviceId/activate — Activate a device.
   */
  app.post("/v1/visitor/devices/:deviceId/activate", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { deviceId } = deviceIdParams.parse(req.params);

    const accepted = await publishDeviceActivate(ctx, { deviceId });
    return reply.code(202).send({ data: accepted });
  });

  /**
   * POST /v1/visitor/devices/:deviceId/suspend — Suspend a device.
   */
  app.post("/v1/visitor/devices/:deviceId/suspend", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { deviceId } = deviceIdParams.parse(req.params);

    const accepted = await publishDeviceSuspend(ctx, { deviceId });
    return reply.code(202).send({ data: accepted });
  });

  /**
   * POST /v1/visitor/devices/:deviceId/deregister — Deregister a device.
   */
  app.post("/v1/visitor/devices/:deviceId/deregister", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { deviceId } = deviceIdParams.parse(req.params);

    const accepted = await publishDeviceDeregister(ctx, { deviceId });
    return reply.code(202).send({ data: accepted });
  });

  /**
   * POST /v1/visitor/devices/:deviceId/rotate-credential — Rotate credential.
   */
  app.post("/v1/visitor/devices/:deviceId/rotate-credential", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { deviceId } = deviceIdParams.parse(req.params);

    const accepted = await publishDeviceRotateCredential(ctx, { deviceId });
    return reply.code(202).send({ data: accepted });
  });

  /**
   * GET /v1/visitor/devices/:deviceId/config — Get current device config.
   */
  app.get("/v1/visitor/devices/:deviceId/config", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { deviceId } = deviceIdParams.parse(req.params);

    const device = await getDeviceById(ctx.tenantId, deviceId);
    if (!device) {
      throw new HttpError(404, "DEVICE_NOT_FOUND", "device not found");
    }
    return reply.send({
      data: {
        deviceId: device.id,
        configVersion: device.configVersion,
        pendingConfig: device.pendingConfig,
      },
    });
  });

  /**
   * PUT /v1/visitor/devices/:deviceId/config — Push config to device.
   */
  app.put("/v1/visitor/devices/:deviceId/config", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { deviceId } = deviceIdParams.parse(req.params);
    const body = configPushBody.parse(req.body);

    const accepted = await publishDeviceConfigPush(ctx, {
      deviceId,
      config: body as unknown as Record<string, unknown>,
    });
    return reply.code(202).send({ data: accepted });
  });

  /**
   * GET /v1/visitor/devices/:deviceId/audit — Device audit log.
   */
  app.get("/v1/visitor/devices/:deviceId/audit", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { deviceId } = deviceIdParams.parse(req.params);
    const query = auditLogQuery.parse(req.query);

    const result = await getDeviceAuditLog(ctx.tenantId, deviceId, query.page, query.pageSize);
    return reply.send({ data: result.data, meta: result.meta });
  });

  /**
   * POST /v1/visitor/devices/:deviceId/firmware/schedule — Schedule firmware update.
   */
  app.post("/v1/visitor/devices/:deviceId/firmware/schedule", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { deviceId } = deviceIdParams.parse(req.params);
    const body = firmwareScheduleBody.parse(req.body);

    const accepted = await publishDeviceFirmwareSchedule(ctx, {
      deviceId,
      firmwareUrl: body.firmwareUrl,
      firmwareChecksum: body.firmwareChecksum,
    });
    return reply.code(202).send({ data: accepted });
  });
}
