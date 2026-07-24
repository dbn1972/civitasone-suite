import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import {
  idParam, fileAppealBody, assignBody, transferRecordsBody,
  scheduleHearingBody, recordHearingBody, prepareOrderBody, issueOrderBody,
} from "./validators.js";
import * as commands from "./commands.js";
import * as queries from "./queries.js";

const CITIZEN_ROLES = ["citizen", "citizen_officer", "citizen_admin", "super_admin"];
const OFFICER_ROLES = ["citizen_officer", "citizen_admin", "super_admin"];

export async function appealRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/citizen/appeals", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CITIZEN_ROLES);
    const body = fileAppealBody.parse(req.body);
    return reply.code(201).send(await commands.fileAppeal(ctx, body));
  });

  app.get("/v1/citizen/appeals", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, OFFICER_ROLES);
    return reply.send({ data: await queries.listAppeals(ctx.tenantId) });
  });

  app.get("/v1/citizen/appeals/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CITIZEN_ROLES);
    const { id } = idParam.parse(req.params);
    const appeal = await queries.getAppeal(ctx.tenantId, id);
    if (!appeal) throw new HttpError(404, "NOT_FOUND", "appeal not found");
    return reply.send(appeal);
  });

  app.post("/v1/citizen/appeals/:id/assign", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, OFFICER_ROLES);
    const { id } = idParam.parse(req.params);
    const body = assignBody.parse(req.body);
    return reply.send(await commands.assign(ctx, id, body));
  });

  app.post("/v1/citizen/appeals/:id/transfer-records", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, OFFICER_ROLES);
    const { id } = idParam.parse(req.params);
    transferRecordsBody.parse(req.body ?? {});
    return reply.send(await commands.transferRecords(ctx, id));
  });

  app.post("/v1/citizen/appeals/:id/hearings", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, OFFICER_ROLES);
    const { id } = idParam.parse(req.params);
    const body = scheduleHearingBody.parse(req.body ?? {});
    return reply.code(201).send(await commands.scheduleHearing(ctx, id, body));
  });

  app.post("/v1/citizen/appeals/:id/hearings/record", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, OFFICER_ROLES);
    const { id } = idParam.parse(req.params);
    const body = recordHearingBody.parse(req.body);
    return reply.send(await commands.recordHearing(ctx, id, body));
  });

  // --- Order maker-checker -----------------------------------------------------
  app.post("/v1/citizen/appeals/:id/order/prepare", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, OFFICER_ROLES);
    const { id } = idParam.parse(req.params);
    const body = prepareOrderBody.parse(req.body);
    return reply.send(await commands.prepareOrder(ctx, id, body));
  });

  app.post("/v1/citizen/appeals/:id/order/issue", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, OFFICER_ROLES);
    const { id } = idParam.parse(req.params);
    issueOrderBody.parse(req.body ?? {});
    return reply.send(await commands.issueOrder(ctx, id));
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
