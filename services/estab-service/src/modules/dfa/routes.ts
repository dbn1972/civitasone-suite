import { sendAccepted } from "@civitasone/schemas/validate";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import {
  createDfaBody, updateDfaBody, returnDfaBody, approveDfaBody, dispatchDfaBody, listDfaQuery,
} from "./validators.js";
import * as commands from "./commands.js";
import * as queries from "./queries.js";
import { findDfaById } from "./repo.js";
import { findFileById } from "../files/repo.js";
import { isAccessAllowed } from "../operators/eligibility.js";

const DRAFTER_ROLES = ["estab_officer", "estab_admin", "super_admin"];
const APPROVER_ROLES = ["estab_admin", "super_admin", "estab_deputy_secretary"];
const READER_ROLES = [...DRAFTER_ROLES, "audit_officer"];

// UAT W8-A: a malformed :id reached the uuid column and 500ed (22P02); it is a 400 now.
const idParam = z.object({ id: z.string().uuid() });

/**
 * UAT W8-A: tenant-scoped existence read (straight from the table, not the read-through
 * cache) before a DFA command is published, so an unknown DFA answers 404 instead of a
 * 202 for a command the consumer silently drops.
 */
async function assertDfaExists(tenantId: string, id: string): Promise<void> {
  if (!(await findDfaById(id, tenantId))) throw new HttpError(404, "NOT_FOUND", "DFA not found");
}

/**
 * GAP-ESTAB-DFA-02: segregation of duties enforced at the route, synchronously,
 * so a drafter gets a 403 (and no command is enqueued) instead of a message that
 * dead-letters in the consumer. The consumer keeps its own K3 check as defence
 * in depth. A missing DFA falls through to the consumer's no-op as before.
 */
async function assertNotDrafter(ctx: { tenantId: string; actorId: string }, id: string, verb: string): Promise<void> {
  const dfa = await queries.getDfa(ctx.tenantId, id);
  if (dfa && dfa.createdBy === ctx.actorId) {
    throw new HttpError(403, "MAKER_CHECKER_VIOLATION", `A DFA cannot be ${verb} by its drafter`);
  }
}

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
    const { id } = idParam.parse(req.params);
    const dfa = await queries.getDfa(ctx.tenantId, id, { withNames: true });
    if (!dfa) throw new HttpError(404, "NOT_FOUND", "DFA not found");
    return reply.send({ data: dfa });
  });

  app.get("/v1/estab/dfa/:id/versions", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const { id } = idParam.parse(req.params);
    const data = await queries.listDfaVersions(ctx.tenantId, id);
    return reply.send({ data });
  });

  app.get("/v1/estab/dfa-templates", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const { listDfaTemplates } = await import("./repo.js");
    const data = await listDfaTemplates(ctx.tenantId);
    return reply.send({ data });
  });

  app.post("/v1/estab/dfa", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, DRAFTER_ROLES);
    const body = createDfaBody.parse(req.body);
    // GAP-ESTAB-DFA-04: a DFA may only be linked to a file of this tenant that the drafter is
    // cleared to see; otherwise the link would leak the file number to anyone reading the DFA.
    if (body.fileId) {
      const file = await findFileById(body.fileId, ctx.tenantId);
      if (!file) throw new HttpError(422, "FILE_NOT_FOUND", "the linked file does not exist");
      if (!(await isAccessAllowed(ctx.tenantId, ctx.actorId, file.classification))) {
        throw new HttpError(403, "FORBIDDEN", "insufficient security clearance for the linked file");
      }
    }
    return sendAccepted(reply, acceptedResponseSchema, await commands.createDfa(ctx, body));
  });

  app.patch("/v1/estab/dfa/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, DRAFTER_ROLES);
    const { id } = idParam.parse(req.params);
    const body = updateDfaBody.parse(req.body);
    await assertDfaExists(ctx.tenantId, id);
    return sendAccepted(reply, acceptedResponseSchema, await commands.updateDfa(ctx, id, body));
  });

  app.post("/v1/estab/dfa/:id/submit", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, DRAFTER_ROLES);
    const { id } = idParam.parse(req.params);
    await assertDfaExists(ctx.tenantId, id);
    return sendAccepted(reply, acceptedResponseSchema, await commands.submitDfa(ctx, id));
  });

  app.post("/v1/estab/dfa/:id/approve", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, APPROVER_ROLES);
    const { id } = idParam.parse(req.params);
    const body = approveDfaBody.parse(req.body ?? {});
    await assertDfaExists(ctx.tenantId, id);
    await assertNotDrafter(ctx, id, "approved");
    return sendAccepted(reply, acceptedResponseSchema, await commands.approveDfa(ctx, id, {
      modality: body.modality, conditions: body.conditions, reason: body.reason,
    }));
  });

  app.post("/v1/estab/dfa/:id/return", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, APPROVER_ROLES);
    const { id } = idParam.parse(req.params);
    const { reason } = returnDfaBody.parse(req.body);
    await assertDfaExists(ctx.tenantId, id);
    return sendAccepted(reply, acceptedResponseSchema, await commands.returnDfa(ctx, id, reason));
  });

  app.post("/v1/estab/dfa/:id/sign", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, APPROVER_ROLES);
    const { id } = idParam.parse(req.params);
    await assertDfaExists(ctx.tenantId, id);
    await assertNotDrafter(ctx, id, "signed");
    return sendAccepted(reply, acceptedResponseSchema, await commands.signDfa(ctx, id));
  });

  app.post("/v1/estab/dfa/:id/dispatch", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, DRAFTER_ROLES);
    const { id } = idParam.parse(req.params);
    const body = dispatchDfaBody.parse(req.body ?? {});
    await assertDfaExists(ctx.tenantId, id);
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
