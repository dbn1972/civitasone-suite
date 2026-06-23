import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { resolveContext, requireRole } from "../../shared/context.js";
import { sendAccepted } from "@civitasone/schemas/validate";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import { queue } from "../../shared/infra.js";
import { randomUUID } from "node:crypto";

const HR_ROLES = ["hr_admin", "super_admin", "admin"];

const bulkImportBody = z.object({
  employees: z.array(z.object({
    employeeNo: z.string().min(1).max(32),
    fullName: z.string().min(1).max(256),
    departmentId: z.string().uuid(),
    designationId: z.string().uuid(),
    dateOfJoining: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    email: z.string().email().optional(),
    mobile: z.string().max(20).optional(),
    gender: z.enum(["male", "female", "other"]).optional(),
    basicMinor: z.number().int().nonnegative().default(0),
  })).min(1).max(500),
});

export async function bulkImportRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/hrms/employees/bulk", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const body = bulkImportBody.parse(req.body);
    const batchId = randomUUID();

    // Validate all rows before queueing
    const errors: Array<{ row: number; field: string; message: string }> = [];
    const seen = new Set<string>();
    body.employees.forEach((emp, idx) => {
      if (seen.has(emp.employeeNo)) errors.push({ row: idx + 1, field: "employeeNo", message: `Duplicate: ${emp.employeeNo}` });
      seen.add(emp.employeeNo);
    });

    if (errors.length > 0) {
      return reply.code(400).send({ code: "VALIDATION_FAILED", message: "Bulk import has errors", errors, correlationId: ctx.correlationId });
    }

    // Queue each employee creation
    for (const emp of body.employees) {
      const id = randomUUID();
      await queue.publish("hrms.employee.create", {
        messageId: id, type: "hrms.employee.create",
        tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
        payload: { id, tenantId: ctx.tenantId, ...emp, currency: "INR" },
      });
    }

    return sendAccepted(reply, acceptedResponseSchema, { id: batchId, status: "accepted" as const, correlationId: ctx.correlationId });
  });

  app.get("/v1/hrms/employees/bulk/status/:batchId", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    // In production this would check the import_batches table
    return reply.send({ batchId: (req.params as any).batchId, status: "completed", message: "Batch processed via CQRS" });
  });
}
