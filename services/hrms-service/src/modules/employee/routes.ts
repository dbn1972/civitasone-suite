import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { listQuerySchema, acceptedResponseSchema } from "@civitasone/schemas/common";
import { employeesListSchema } from "@civitasone/schemas/web";
import {sendValidated, sendAccepted } from "@civitasone/schemas/validate";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { PiiDecryptError } from "../../shared/pii-crypto.js";
import { createEmployeeBody, confirmEmployeeBody, idParam, updateEmployeeBody } from "./validators.js";
import { transferBody, separateBody } from "../lifecycle/validators.js";
import * as commands from "./commands.js";
import * as queries from "./queries.js";

const HR_ROLES    = ["hr_admin", "hr_officer", "super_admin"];
const READER_ROLES = [...HR_ROLES, "manager"];

export async function employeeRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/hrms/employees", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const q = listQuerySchema.parse(req.query);
    sendValidated(reply, employeesListSchema, await queries.listEmployees(ctx.tenantId, q.limit, q.offset));
  });

  app.post("/v1/hrms/employees", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const body = createEmployeeBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.createEmployee(ctx, body));
  });

  app.patch("/v1/hrms/employees/:id/confirm", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { id } = idParam.parse(req.params);
    const body = confirmEmployeeBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.confirmEmployee(ctx, id, body));
  });

  app.patch("/v1/hrms/employees/:id/transfer", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { id } = idParam.parse(req.params);
    const body = transferBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.transferEmployee(ctx, id, body));
  });

  app.patch("/v1/hrms/employees/:id/separate", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { id } = idParam.parse(req.params);
    const body = separateBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.separateEmployee(ctx, id, body));
  });

  app.get("/v1/hrms/employees/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const { id } = idParam.parse(req.params);
    const emp = await queries.getEmployee(id, ctx.tenantId);
    if (!emp) throw new HttpError(404, "NOT_FOUND", "employee not found");
    return reply.send(emp);
  });

  app.patch("/v1/hrms/employees/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { id } = idParam.parse(req.params);
    const body = updateEmployeeBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.updateEmployee(ctx, id, body));
  });

  app.setErrorHandler(errorHandler);
}

function errorHandler(err: unknown, req: any, reply: any): void {
  const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
  if (err instanceof ZodError) {
    void reply.code(400).send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId, retryable: false, fieldErrors: err.issues.map((i) => ({ field: i.path.join("."), message: i.message })) });
    return;
  }
  if (err instanceof HttpError) {
    void reply.code(err.status).send({ code: err.code, message: err.message, correlationId, retryable: false });
    return;
  }
  if (err instanceof PiiDecryptError) {
    // M2: a tampered / undecryptable PII field fails closed as a typed 422,
    // not a raw retryable 500.
    req.log.error({ err }, "PII decrypt failed");
    void reply.code(422).send({ code: err.code, message: "stored PII could not be decrypted", correlationId, retryable: false });
    return;
  }
  req.log.error({ err }, "unhandled error");
  void reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId, retryable: true });
}
