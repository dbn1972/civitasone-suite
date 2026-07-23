/**
 * Telemetry / IoT module — HTTP routes.
 *
 * Endpoints:
 *   POST  /v1/inspection/telemetry/devices                — register device
 *   PATCH /v1/inspection/telemetry/devices/:id            — update device
 *   GET   /v1/inspection/telemetry/devices                — list devices
 *   GET   /v1/inspection/telemetry/devices/:id            — get device
 *   POST  /v1/inspection/telemetry/readings               — ingest reading (high-throughput)
 *   GET   /v1/inspection/telemetry/readings               — list readings (deviceId, dateRange)
 *   POST  /v1/inspection/telemetry/alert-rules            — create alert rule
 *   GET   /v1/inspection/telemetry/alert-rules            — list rules
 *   GET   /v1/inspection/telemetry/alerts                 — list alerts
 *   POST  /v1/inspection/telemetry/alerts/:id/acknowledge — acknowledge alert
 *   POST  /v1/inspection/telemetry/alerts/:id/create-finding — create finding from alert
 *
 * _Requirements: SVC-110_
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import {
  publishDeviceCreate,
  publishDeviceUpdate,
  publishReadingIngest,
  publishAlertRuleCreate,
  publishAlertAcknowledge,
  publishAlertCreateFinding,
} from "./commands.js";
import {
  findDeviceById,
  findDevices,
  findReadings,
  findAlerts,
  findAlertById,
  findAlertRules,
} from "./repo.js";

// ─── RBAC ────────────────────────────────────────────────────────────────────

const WRITE_ROLES = ["inspector", "reviewing_officer", "inspection_admin",
  "tenant_admin", "super_admin"];
const READ_ROLES = ["inspector", "reviewing_officer", "inspection_admin",
  "tenant_admin", "super_admin"];

// ─── Zod schemas ─────────────────────────────────────────────────────────────

const idParam = z.object({ id: z.string().uuid() });

const createDeviceSchema = z.object({
  deviceType: z.enum(["sensor", "drone", "camera", "iot_gateway"]),
  deviceIdentifier: z.string().min(1),
  name: z.string().min(1),
  entityId: z.string().uuid().optional(),
  latitude: z.string().optional(),
  longitude: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
});

const updateDeviceSchema = z.object({
  name: z.string().min(1).optional(),
  entityId: z.string().uuid().optional(),
  latitude: z.string().optional(),
  longitude: z.string().optional(),
  status: z.enum(["active", "inactive", "maintenance"]).optional(),
  metadata: z.record(z.unknown()).optional(),
  version: z.number().int().positive(),
});

const ingestReadingSchema = z.object({
  deviceId: z.string().uuid(),
  readingType: z.string().min(1),
  value: z.string().min(1), // numeric precision as string
  unit: z.string().min(1),
  latitude: z.string().optional(),
  longitude: z.string().optional(),
  capturedAt: z.string().datetime(),
  metadata: z.record(z.unknown()).optional(),
});

const createAlertRuleSchema = z.object({
  deviceType: z.string().min(1),
  readingType: z.string().min(1),
  operator: z.enum(["gt", "lt", "gte", "lte", "eq"]),
  thresholdValue: z.string().min(1), // numeric precision as string
  severity: z.enum(["critical", "major", "minor"]),
});

const createFindingSchema = z.object({
  findingDescription: z.string().optional(),
});

const deviceListQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(200).default(15),
  deviceType: z.string().optional(),
  status: z.string().optional(),
  entityId: z.string().uuid().optional(),
});

const readingListQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(200).default(15),
  deviceId: z.string().uuid().optional(),
  dateFrom: z.string().datetime().optional(),
  dateTo: z.string().datetime().optional(),
});

const alertListQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(200).default(15),
  status: z.string().optional(),
  deviceId: z.string().uuid().optional(),
  severity: z.string().optional(),
});

const ruleListQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(200).default(15),
});

// ─── Route registration ─────────────────────────────────────────────────────

export async function registerTelemetryRoutes(app: FastifyInstance): Promise<void> {
  // ── POST /v1/inspection/telemetry/devices ──
  app.post("/v1/inspection/telemetry/devices", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const body = createDeviceSchema.parse(req.body);
    const result = await publishDeviceCreate(body, ctx);
    return reply.code(202).send({ data: result });
  });

  // ── PATCH /v1/inspection/telemetry/devices/:id ──
  app.patch("/v1/inspection/telemetry/devices/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const { id } = idParam.parse(req.params);

    const device = await findDeviceById(ctx.tenantId, id);
    if (!device) throw new HttpError(404, "NOT_FOUND", "device not found");

    const body = updateDeviceSchema.parse(req.body);
    const result = await publishDeviceUpdate({ deviceId: id, ...body }, ctx);
    return reply.code(202).send({ data: result });
  });

  // ── GET /v1/inspection/telemetry/devices ──
  app.get("/v1/inspection/telemetry/devices", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const query = deviceListQuerySchema.parse(req.query);
    const result = await findDevices(
      ctx.tenantId,
      { page: query.page, pageSize: query.pageSize },
      { deviceType: query.deviceType, status: query.status, entityId: query.entityId },
    );
    return reply.send(result);
  });

  // ── GET /v1/inspection/telemetry/devices/:id ──
  app.get("/v1/inspection/telemetry/devices/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const { id } = idParam.parse(req.params);
    const device = await findDeviceById(ctx.tenantId, id);
    if (!device) throw new HttpError(404, "NOT_FOUND", "device not found");
    return reply.send({ data: device });
  });

  // ── POST /v1/inspection/telemetry/readings ──
  app.post("/v1/inspection/telemetry/readings", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const body = ingestReadingSchema.parse(req.body);
    const result = await publishReadingIngest(body, ctx);
    return reply.code(202).send({ data: result });
  });

  // ── GET /v1/inspection/telemetry/readings ──
  app.get("/v1/inspection/telemetry/readings", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const query = readingListQuerySchema.parse(req.query);
    const result = await findReadings(
      ctx.tenantId,
      { page: query.page, pageSize: query.pageSize },
      { deviceId: query.deviceId, dateFrom: query.dateFrom, dateTo: query.dateTo },
    );
    return reply.send(result);
  });

  // ── POST /v1/inspection/telemetry/alert-rules ──
  app.post("/v1/inspection/telemetry/alert-rules", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const body = createAlertRuleSchema.parse(req.body);
    const result = await publishAlertRuleCreate(body, ctx);
    return reply.code(202).send({ data: result });
  });

  // ── GET /v1/inspection/telemetry/alert-rules ──
  app.get("/v1/inspection/telemetry/alert-rules", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const query = ruleListQuerySchema.parse(req.query);
    const result = await findAlertRules(
      ctx.tenantId,
      { page: query.page, pageSize: query.pageSize },
    );
    return reply.send(result);
  });

  // ── GET /v1/inspection/telemetry/alerts ──
  app.get("/v1/inspection/telemetry/alerts", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const query = alertListQuerySchema.parse(req.query);
    const result = await findAlerts(
      ctx.tenantId,
      { page: query.page, pageSize: query.pageSize },
      { status: query.status, deviceId: query.deviceId, severity: query.severity },
    );
    return reply.send(result);
  });

  // ── POST /v1/inspection/telemetry/alerts/:id/acknowledge ──
  app.post("/v1/inspection/telemetry/alerts/:id/acknowledge", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const { id } = idParam.parse(req.params);

    const alert = await findAlertById(ctx.tenantId, id);
    if (!alert) throw new HttpError(404, "NOT_FOUND", "alert not found");
    if (alert.status !== "open") {
      throw new HttpError(422, "INVALID_STATE", "can only acknowledge open alerts");
    }

    const result = await publishAlertAcknowledge({ alertId: id }, ctx);
    return reply.code(202).send({ data: result });
  });

  // ── POST /v1/inspection/telemetry/alerts/:id/create-finding ──
  app.post("/v1/inspection/telemetry/alerts/:id/create-finding", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const { id } = idParam.parse(req.params);

    const alert = await findAlertById(ctx.tenantId, id);
    if (!alert) throw new HttpError(404, "NOT_FOUND", "alert not found");
    if (alert.status !== "acknowledged") {
      throw new HttpError(422, "INVALID_STATE", "can only create findings from acknowledged alerts");
    }

    const body = createFindingSchema.parse(req.body);
    const result = await publishAlertCreateFinding({ alertId: id, ...body }, ctx);
    return reply.code(202).send({ data: result });
  });
}
