/**
 * Spaces routes — office building/floor/room/seat inventory, occupancy &
 * availability, seat/room allotment (maker-checker), release, maintenance.
 * (SVC-058 general office-space gap.)
 */
import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import * as commands from "./commands.js";
import * as queries from "./queries.js";
import {
  idParam, createBuildingBody, createFloorBody, createRoomBody, createSeatBody,
  requestAllotmentBody, allotBody, versionBody, releaseBody, cancelBody,
  createMaintenanceBody, maintenanceStatusBody,
  listQuery, floorsQuery, roomsQuery, seatsQuery, availabilityQuery,
  allotmentsQuery, maintenanceQuery,
} from "./validators.js";

const ESTAB_ROLES  = ["estab_officer", "estab_admin", "space_officer", "super_admin"];
const READER_ROLES = [...ESTAB_ROLES, "audit_officer", "employee"];

export async function spacesRoutes(app: FastifyInstance): Promise<void> {
  // ── Buildings ──────────────────────────────────────────────────────────
  app.post("/v1/estab/spaces/buildings", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, ESTAB_ROLES);
    const body = createBuildingBody.parse(req.body);
    return reply.code(201).send({ data: await commands.createBuilding(ctx, body) });
  });
  app.get("/v1/estab/spaces/buildings", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, READER_ROLES);
    const q = listQuery.parse(req.query);
    return reply.send({ data: await queries.listBuildings(ctx.tenantId, q) });
  });
  app.get("/v1/estab/spaces/buildings/:id", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, READER_ROLES);
    const { id } = idParam.parse(req.params);
    const b = await queries.getBuilding(ctx.tenantId, id);
    if (!b) throw new HttpError(404, "NOT_FOUND", "building not found");
    return reply.send({ data: b });
  });

  // ── Floors ─────────────────────────────────────────────────────────────
  app.post("/v1/estab/spaces/floors", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, ESTAB_ROLES);
    const body = createFloorBody.parse(req.body);
    return reply.code(201).send({ data: await commands.createFloor(ctx, body) });
  });
  app.get("/v1/estab/spaces/floors", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, READER_ROLES);
    const q = floorsQuery.parse(req.query);
    return reply.send({ data: await queries.listFloors(ctx.tenantId, q) });
  });

  // ── Rooms ──────────────────────────────────────────────────────────────
  app.post("/v1/estab/spaces/rooms", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, ESTAB_ROLES);
    const body = createRoomBody.parse(req.body);
    return reply.code(201).send({ data: await commands.createRoom(ctx, body) });
  });
  app.get("/v1/estab/spaces/rooms", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, READER_ROLES);
    const q = roomsQuery.parse(req.query);
    return reply.send({ data: await queries.listRooms(ctx.tenantId, q) });
  });

  // ── Seats ──────────────────────────────────────────────────────────────
  app.post("/v1/estab/spaces/seats", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, ESTAB_ROLES);
    const body = createSeatBody.parse(req.body);
    return reply.code(201).send({ data: await commands.createSeat(ctx, body) });
  });
  app.get("/v1/estab/spaces/seats", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, READER_ROLES);
    const q = seatsQuery.parse(req.query);
    return reply.send({ data: await queries.listSeats(ctx.tenantId, q) });
  });

  // ── Availability & occupancy ───────────────────────────────────────────
  app.get("/v1/estab/spaces/availability", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, READER_ROLES);
    const q = availabilityQuery.parse(req.query);
    return reply.send({ data: await queries.availability(ctx.tenantId, q) });
  });

  // ── Allotment workflow (maker-checker) ─────────────────────────────────
  app.post("/v1/estab/spaces/allotments", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, READER_ROLES); // requester may be an employee
    const body = requestAllotmentBody.parse(req.body);
    return reply.code(201).send({ data: await commands.requestAllotment(ctx, body) });
  });
  app.patch("/v1/estab/spaces/allotments/:id/allot", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, ESTAB_ROLES);
    const { id } = idParam.parse(req.params);
    const body = allotBody.parse(req.body);
    return reply.send({ data: await commands.allot(ctx, id, body) });
  });
  app.patch("/v1/estab/spaces/allotments/:id/occupy", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, ESTAB_ROLES);
    const { id } = idParam.parse(req.params);
    const body = versionBody.parse(req.body);
    return reply.send({ data: await commands.occupy(ctx, id, body) });
  });
  app.patch("/v1/estab/spaces/allotments/:id/release", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, ESTAB_ROLES);
    const { id } = idParam.parse(req.params);
    const body = releaseBody.parse(req.body);
    return reply.send({ data: await commands.release(ctx, id, body) });
  });
  app.patch("/v1/estab/spaces/allotments/:id/cancel", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, ESTAB_ROLES);
    const { id } = idParam.parse(req.params);
    const body = cancelBody.parse(req.body);
    return reply.send({ data: await commands.cancelAllotment(ctx, id, body) });
  });
  app.get("/v1/estab/spaces/allotments", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, READER_ROLES);
    const q = allotmentsQuery.parse(req.query);
    return reply.send({ data: await queries.listAllotments(ctx.tenantId, q) });
  });

  // ── Maintenance ────────────────────────────────────────────────────────
  app.post("/v1/estab/spaces/maintenance", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, READER_ROLES); // anyone can report
    const body = createMaintenanceBody.parse(req.body);
    return reply.code(201).send({ data: await commands.createMaintenance(ctx, body) });
  });
  app.patch("/v1/estab/spaces/maintenance/:id/status", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, ESTAB_ROLES);
    const { id } = idParam.parse(req.params);
    const body = maintenanceStatusBody.parse(req.body);
    return reply.send({ data: await commands.updateMaintenanceStatus(ctx, id, body) });
  });
  app.get("/v1/estab/spaces/maintenance", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, READER_ROLES);
    const q = maintenanceQuery.parse(req.query);
    return reply.send({ data: await queries.listMaintenance(ctx.tenantId, q) });
  });

  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) {
      return reply.code(400).send({
        code: "VALIDATION_FAILED", message: "invalid request", correlationId, retryable: false,
        fieldErrors: err.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
      });
    }
    if (err instanceof HttpError) {
      return reply.code(err.status).send({ code: err.code, message: err.message, correlationId, retryable: false });
    }
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId, retryable: true });
  });
}
