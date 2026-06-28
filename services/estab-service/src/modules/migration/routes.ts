import { sendAccepted } from "@civitasone/schemas/validate";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { registerMigrationBody, linkMigrationBody, listMigrationQuery } from "./validators.js";
import * as commands from "./commands.js";
import * as queries from "./queries.js";

const WRITER_ROLES = ["estab_officer", "estab_admin", "estab_division_admin", "super_admin"];
const READER_ROLES = [...WRITER_ROLES, "audit_officer"];

export async function migrationRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/estab/migration", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const q = listMigrationQuery.parse(req.query);
    const data = await queries.listMigrations(ctx.tenantId, { status: q.status }, q.limit);
    return reply.send({ data });
  });

  app.post("/v1/estab/migration", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITER_ROLES);
    const body = registerMigrationBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.registerMigration(ctx, body));
  });

  app.post("/v1/estab/migration/:id/link", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITER_ROLES);
    const { id } = req.params as { id: string };
    const { efileId } = linkMigrationBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.linkMigration(ctx, id, efileId));
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
