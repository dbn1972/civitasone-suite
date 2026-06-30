import { sendAccepted } from "@civitasone/schemas/validate";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import {
  createDfaBody, updateDfaBody, returnDfaBody, approveDfaBody, dispatchDfaBody, listDfaQuery,
} from "./validators.js";
import * as commands from "./commands.js";
import * as queries from "./queries.js";

const DRAFTER_ROLES = ["estab_officer", "estab_admin", "super_admin"];
const APPROVER_ROLES = ["estab_admin", "super_admin", "estab_deputy_secretary"];
const READER_ROLES = [...DRAFTER_ROLES, "audit_officer"];

export async function dfaRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/estab/dfa", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const q = listDfaQuery.parse(req.query);
    const data = await queries.listDfa(ctx.tenantId, { status: q.status, fileId: q.fileId }, q.limit);
    return reply.send({ data });
  });

  app.get("/v1/estab/dfa/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const { id } = req.params as { id: string };
    const dfa = await queries.getDfa(ctx.tenantId, id);
    if (!dfa) throw new HttpError(404, "NOT_FOUND", "DFA not found");
    return reply.send({ data: dfa });
  });

  app.get("/v1/estab/dfa/:id/versions", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const { id } = req.params as { id: string };
    const data = await queries.listDfaVersions(ctx.tenantId, id);
    return reply.send({ data });
  });

  app.post("/v1/estab/dfa", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, DRAFTER_ROLES);
    const body = createDfaBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.createDfa(ctx, body));
  });

  app.patch("/v1/estab/dfa/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, DRAFTER_ROLES);
    const { id } = req.params as { id: string };
    const body = updateDfaBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.updateDfa(ctx, id, body));
  });

  app.post("/v1/estab/dfa/:id/submit", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, DRAFTER_ROLES);
    const { id } = req.params as { id: string };
    return sendAccepted(reply, acceptedResponseSchema, await commands.submitDfa(ctx, id));
  });

  app.post("/v1/estab/dfa/:id/approve", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, APPROVER_ROLES);
    const { id } = req.params as { id: string };
    const body = approveDfaBody.parse(req.body ?? {});
    return sendAccepted(reply, acceptedResponseSchema, await commands.approveDfa(ctx, id, { modality: body.modality, conditions: body.conditions }));
  });

  app.post("/v1/estab/dfa/:id/return", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, APPROVER_ROLES);
    const { id } = req.params as { id: string };
    const { reason } = returnDfaBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.returnDfa(ctx, id, reason));
  });

  app.post("/v1/estab/dfa/:id/sign", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, APPROVER_ROLES);
    const { id } = req.params as { id: string };
    return sendAccepted(reply, acceptedResponseSchema, await commands.signDfa(ctx, id));
  });

  app.post("/v1/estab/dfa/:id/dispatch", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, DRAFTER_ROLES);
    const { id } = req.params as { id: string };
    const body = dispatchDfaBody.parse(req.body ?? {});
    return sendAccepted(reply, acceptedResponseSchema, await commands.dispatchDfa(ctx, id, { mode: body.mode, toAddress: body.toAddress }));
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
