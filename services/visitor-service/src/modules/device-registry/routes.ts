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
import { randomUUID } from "node:crypto";
import { runWithTenant } from "@civitasone/db";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { cache } from "../../shared/infra.js";
import { deviceAuth } from "./device-auth.js";
import { deviceRouteRateLimit } from "./device-route-rate-limit.js";
import { assertLocationExists, assertGateExists } from "../location/references.js";
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
  publishDeviceHeartbeat,
} from "./commands.js";
import {
  getDeviceById,
  listDevices,
  toPublicDevice,
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

    // UAT FQ9 #8: reject an unknown location / gate now, not as a silent dead-letter after the 202.
    await assertLocationExists(ctx.tenantId, body.locationId);
    if (body.gateId) await assertGateExists(ctx.tenantId, body.gateId, body.locationId);

    const accepted = await publishDeviceRegister(ctx, {
      deviceType: body.deviceType,
      name: body.name,
      serialNumber: body.serialNumber,
      locationId: body.locationId,
      gateId: body.gateId ?? null,
      capabilities: body.capabilities,
    });
    // UAT FQ9 #31: `data.deviceToken` (bearer-token devices only) is the ONLY copy of the raw device
    // credential — it is not persisted or emitted anywhere. Never cache this response.
    return reply.code(202).header("cache-control", "no-store").send({ data: accepted });
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
    return reply.send({ data: result.data.map(toPublicDevice), meta: result.meta });
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
   * Updates Redis status key with TTL 90s (sync — online TTL telemetry).
   * Durable lastSeenAt/firmwareVersion write goes via CQRS command.
   * If device has pending_config → include in response body.
   * Returns 200 with config payload or 204 if no config.
   *
   * Requirements: 3.1, 3.2, 3.8, 8.3
   */
  app.post("/v1/visitor/devices/heartbeat", { preHandler: [deviceAuth], config: { public: true, rateLimit: deviceRouteRateLimit } }, async (req, reply) => {
    const deviceCtx = req.deviceContext!;
    const body = heartbeatBody.parse(req.body);

    const now = new Date();
    const correlationId = (req.headers["x-correlation-id"] as string | undefined) ?? randomUUID();

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

    // 2. Durable DB update via CQRS (consumer markProcessed → update devices).
    await publishDeviceHeartbeat({
      deviceId: deviceCtx.deviceId,
      tenantId: deviceCtx.tenantId,
      firmwareVersion: body.firmwareVersion,
      lastSeenAt: now.toISOString(),
    }, { actorId: deviceCtx.deviceId, correlationId });

    // 3. Check for pending config and return it in the response.
    // UAT FQ9 #37: this route is config:{public:true} (device-authenticated), so no user JWT populated
    // the request's tenant context and getDeviceById's scopedRead ran with an EMPTY app.tenant_id GUC —
    // the RLS policy's `current_setting('app.tenant_id', true)::uuid` then failed with
    // `invalid input syntax for type uuid: ""` (500). The tenant is the one deviceAuth resolved from
    // the device record, so scope the read to it explicitly.
    const device = await runWithTenant(deviceCtx.tenantId, () => getDeviceById(deviceCtx.tenantId, deviceCtx.deviceId));
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
    return reply.send({ data: toPublicDevice(device) });
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
    // UAT W8-B: tenant-scoped existence read before publishing; the consumer stays the race-safe check.
    if (!(await getDeviceById(ctx.tenantId, deviceId))) throw new HttpError(404, "DEVICE_NOT_FOUND", "device not found");
    // UAT FQ9 #8: an unknown gate is a 422 now rather than a dead-letter later.
    if (body.gateId) await assertGateExists(ctx.tenantId, body.gateId);

    // Metadata update rides the config-push command, flagged `_metadataUpdate`; the consumer applies
    // name / capabilities / gateId to the device row itself (UAT FQ9 #27) instead of pending_config.
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

    // UAT W8-B: tenant-scoped existence read before publishing; the consumer stays the race-safe check.
    if (!(await getDeviceById(ctx.tenantId, deviceId))) throw new HttpError(404, "DEVICE_NOT_FOUND", "device not found");
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

    // UAT W8-B: tenant-scoped existence read before publishing; the consumer stays the race-safe check.
    if (!(await getDeviceById(ctx.tenantId, deviceId))) throw new HttpError(404, "DEVICE_NOT_FOUND", "device not found");
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

    // UAT W8-B: tenant-scoped existence read before publishing; the consumer stays the race-safe check.
    if (!(await getDeviceById(ctx.tenantId, deviceId))) throw new HttpError(404, "DEVICE_NOT_FOUND", "device not found");
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

    // UAT W8-B: tenant-scoped existence read before publishing; the consumer stays the race-safe check.
    if (!(await getDeviceById(ctx.tenantId, deviceId))) throw new HttpError(404, "DEVICE_NOT_FOUND", "device not found");
    const accepted = await publishDeviceRotateCredential(ctx, { deviceId });
    // UAT FQ9 #31: `data.deviceToken` is the only copy of the new credential. Never cache it.
    return reply.code(202).header("cache-control", "no-store").send({ data: accepted });
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
    // UAT W8-B: tenant-scoped existence read before publishing; the consumer stays the race-safe check.
    if (!(await getDeviceById(ctx.tenantId, deviceId))) throw new HttpError(404, "DEVICE_NOT_FOUND", "device not found");

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
    // UAT W8-B: tenant-scoped existence read before publishing; the consumer stays the race-safe check.
    if (!(await getDeviceById(ctx.tenantId, deviceId))) throw new HttpError(404, "DEVICE_NOT_FOUND", "device not found");

    const accepted = await publishDeviceFirmwareSchedule(ctx, {
      deviceId,
      firmwareUrl: body.firmwareUrl,
      firmwareChecksum: body.firmwareChecksum,
    });
    return reply.code(202).send({ data: accepted });
  });
}
