import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { listQuerySchema } from "@civitasone/schemas/common";
import { AuditComplianceListSchema } from "@civitasone/schemas/web";
import { sendValidated } from "@civitasone/schemas/validate";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { pendingQuery } from "./validators.js";
import * as queries from "./queries.js";

const READER_ROLES = ["audit_officer", "audit_admin", "finance_admin", "super_admin"];

export async function complianceRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/audit/compliance/pending", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const q = pendingQuery.parse(req.query);
    return reply.send({ items: await queries.listPending(ctx.tenantId, q.status) });
  });

  app.get("/v1/audit/compliance", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const q = listQuerySchema.parse(req.query);
    const pending = (await queries.listPending(ctx.tenantId, "pending")) ?? [];
    sendValidated(reply, AuditComplianceListSchema, pending.slice(0, q.limit).map((row) => ({
      id: row.id,
      lawOrRule: `Para ${row.paraId.slice(0, 8)}`,
      requirement: `Compliance follow-up for department ${row.deptRef}`,
      frequency: "annual",
      dueDate: row.dueDate?.toString() ?? new Date().toISOString().slice(0, 10),
      department: row.deptRef,
      status: (row.status === "complied" ? "complied" : row.status === "overdue" ? "overdue" : row.status === "na" ? "na" : "pending") as "complied" | "pending" | "overdue" | "na",
    })));
  });

  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) return reply.code(400).send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId, retryable: false });
    if (err instanceof HttpError) return reply.code(err.status).send({ code: err.code, message: err.message, correlationId, retryable: false });
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId, retryable: true });
  });
}
