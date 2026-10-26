import { sendAccepted } from "@civitasone/schemas/validate";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { recordFilingBody, idParam, listFilingsQuery } from "./validators.js";
import * as commands from "./commands.js";
import * as queries from "./queries.js";
import { assertCaseAccess, hiddenCaseIds } from "../cases/access.js";

const LEGAL_ROLES  = ["legal_officer", "legal_admin", "super_admin"];
const READER_ROLES = [...LEGAL_ROLES, "audit_officer"];

export async function filingRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/legal/filings", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, LEGAL_ROLES);
    const body = recordFilingBody.parse(req.body);
    await assertCaseAccess(ctx, body.caseId);
    return sendAccepted(reply, acceptedResponseSchema, await commands.recordFiling(ctx, body));
  });

  app.get("/v1/legal/filings/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const { id } = idParam.parse(req.params);
    const filing = await queries.getFiling(id, ctx.tenantId);
    if (!filing) throw new HttpError(404, "NOT_FOUND", "filing not found");
    await assertCaseAccess(ctx, filing.caseId);
    return reply.send(filing);
  });

  app.get("/v1/legal/filings", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const q = listFilingsQuery.parse(req.query);
    if (q.caseId) await assertCaseAccess(ctx, q.caseId);
    const hidden = new Set(await hiddenCaseIds(ctx));
    const items = await queries.listFilings(ctx.tenantId, q.caseId, q.filingType, q.status);
    return reply.send({ items: (items ?? []).filter((f) => !hidden.has(f.caseId)) });
  });

  app.setErrorHandler(errorHandler);
}

function errorHandler(err: unknown, req: any, reply: any): void {
  const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
  if (err instanceof ZodError) {
    void reply.code(400).send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId, retryable: false });
    return;
  }
  if (err instanceof HttpError) {
    void reply.code(err.status).send({ code: err.code, message: err.message, correlationId, retryable: false });
    return;
  }
  req.log.error({ err }, "unhandled error");
  void reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId, retryable: true });
}
