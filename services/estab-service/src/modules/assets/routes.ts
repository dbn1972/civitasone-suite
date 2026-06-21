import { sendAccepted, sendValidated } from "@civitasone/schemas/validate";
import { acceptedResponseSchema, listQuerySchema } from "@civitasone/schemas/common";
import { VehicleSummaryListSchema } from "@civitasone/schemas/web";
import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { idParam, createVehicleBody, bookVehicleBody, returnVehicleBody } from "./validators.js";
import * as commands from "./commands.js";
import * as queries from "./queries.js";

const ESTAB_ROLES  = ["estab_officer", "estab_admin", "super_admin"];
const READER_ROLES = [...ESTAB_ROLES, "audit_officer"];

export async function assetsRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/estab/vehicles", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ESTAB_ROLES);
    const body = createVehicleBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.createVehicle(ctx, body));
  });

  app.post("/v1/estab/vehicle-bookings", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ESTAB_ROLES);
    const body = bookVehicleBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.bookVehicle(ctx, body));
  });

  app.patch("/v1/estab/vehicle-bookings/:id/return", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ESTAB_ROLES);
    const { id } = idParam.parse(req.params);
    const body = returnVehicleBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.returnVehicle(ctx, id, body));
  });

  app.get("/v1/estab/vehicles/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const { id } = idParam.parse(req.params);
    const vehicle = await queries.getVehicle(ctx.tenantId, id);
    if (!vehicle) throw new HttpError(404, "NOT_FOUND", "vehicle not found");
    return reply.send(vehicle);
  });

  app.get("/v1/estab/vehicles", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const q = listQuerySchema.parse(req.query);
    sendValidated(reply, VehicleSummaryListSchema, await queries.listVehicleSummaries(ctx.tenantId, q.limit));
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
