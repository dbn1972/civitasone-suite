import { sendAccepted } from "@civitasone/schemas/validate";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { idParam, createGuesthouseBody, bookRoomBody, checkoutBody, addBookBody, issueBookBody } from "./validators.js";
import * as commands from "./commands.js";

const ESTAB_ROLES  = ["estab_officer", "estab_admin", "super_admin"];

export async function facilitiesRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/estab/guesthouses", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ESTAB_ROLES);
    const body = createGuesthouseBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.createGuesthouse(ctx, body));
  });

  app.post("/v1/estab/room-bookings", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ESTAB_ROLES);
    const body = bookRoomBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.bookRoom(ctx, body));
  });

  app.patch("/v1/estab/room-bookings/:id/checkin", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ESTAB_ROLES);
    const { id } = idParam.parse(req.params);
    return sendAccepted(reply, acceptedResponseSchema, await commands.checkin(ctx, id));
  });

  app.patch("/v1/estab/room-bookings/:id/checkout", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ESTAB_ROLES);
    const { id } = idParam.parse(req.params);
    const body = checkoutBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.checkout(ctx, id, body));
  });

  app.post("/v1/estab/library/books", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ESTAB_ROLES);
    const body = addBookBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.addBook(ctx, body));
  });

  app.post("/v1/estab/library/issues", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ESTAB_ROLES);
    const body = issueBookBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.issueBook(ctx, body));
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
