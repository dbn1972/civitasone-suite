/**
 * Fleet routes — fuel logs, trips, vehicle documents, driver roster (SVC-059).
 */
import { sendAccepted } from "@civitasone/schemas/validate";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import type { FastifyInstance } from "fastify";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import {
  idParam, createFuelLogBody, createTripLogBody, completeTripBody,
  createVehicleDocBody, createDriverRosterBody, fleetQueryParams,
} from "./validators.js";
import * as commands from "./commands.js";
import * as queries from "./queries.js";

const FLEET_ROLES  = ["estab_officer", "estab_admin", "fleet_officer", "super_admin"];
const READER_ROLES = [...FLEET_ROLES, "audit_officer"];

export async function fleetRoutes(app: FastifyInstance): Promise<void> {
  // ── Fuel Logs ──────────────────────────────────────────────────────────
  app.post("/v1/estab/fuel-logs", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, FLEET_ROLES);
    const body = createFuelLogBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.createFuelLog(ctx, body));
  });

  app.get("/v1/estab/fuel-logs", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const q = fleetQueryParams.parse(req.query);
    return reply.send({ data: await queries.listFuelLogs(ctx.tenantId, q) });
  });

  // ── Trip Logs ──────────────────────────────────────────────────────────
  app.post("/v1/estab/trip-logs", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, FLEET_ROLES);
    const body = createTripLogBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.createTripLog(ctx, body));
  });

  app.patch("/v1/estab/trip-logs/:id/complete", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, FLEET_ROLES);
    const { id } = idParam.parse(req.params);
    const body = completeTripBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.completeTrip(ctx, id, body));
  });

  app.get("/v1/estab/trip-logs", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const q = fleetQueryParams.parse(req.query);
    return reply.send({ data: await queries.listTripLogs(ctx.tenantId, q) });
  });

  // ── Vehicle Documents ──────────────────────────────────────────────────
  app.post("/v1/estab/vehicle-documents", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, FLEET_ROLES);
    const body = createVehicleDocBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.createVehicleDoc(ctx, body));
  });

  app.get("/v1/estab/vehicle-documents", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const q = fleetQueryParams.parse(req.query);
    return reply.send({ data: await queries.listVehicleDocuments(ctx.tenantId, q.vehicleId) });
  });

  // ── Driver Roster ──────────────────────────────────────────────────────
  app.post("/v1/estab/driver-roster", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, FLEET_ROLES);
    const body = createDriverRosterBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.createDriverRoster(ctx, body));
  });

  app.get("/v1/estab/driver-roster", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const q = fleetQueryParams.parse(req.query);
    return reply.send({ data: await queries.listDriverRoster(ctx.tenantId, q) });
  });
}
