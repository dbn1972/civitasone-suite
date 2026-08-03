/**
 * P2-002: Leave Cancellation — CQRS
 * PATCH /v1/hrms/leave-applications/:id/cancel
 */
import type { FastifyInstance } from "fastify";
import { ZodError, z } from "zod";
import { sendAccepted } from "@civitasone/schemas/validate";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { scopedRead } from "../../shared/db.js";
import { eq, and } from "drizzle-orm";
import { hrmsLeaveApps } from "./schema.js";
import * as commands from "./cancel-commands.js";

const ALL_ROLES = ["hr_admin", "hr_officer", "super_admin", "manager", "employee"];
const idParam = z.object({ id: z.string().uuid() });

export async function leaveCancelRoutes(app: FastifyInstance): Promise<void> {
  app.patch("/v1/hrms/leave-applications/:id/cancel", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ALL_ROLES);
    const { id } = idParam.parse(req.params);

    const rows = await scopedRead((tx) => tx.select().from(hrmsLeaveApps)
      .where(and(eq(hrmsLeaveApps.id, id), eq(hrmsLeaveApps.tenantId, ctx.tenantId)))
      .limit(1));
    const application = rows[0];
    if (!application) throw new HttpError(404, "NOT_FOUND", "leave application not found");
    if (application.status === "cancelled") {
      throw new HttpError(409, "ALREADY_CANCELLED", "leave application is already cancelled");
    }
    if (application.status !== "approved" && application.status !== "pending" && application.status !== "draft") {
      throw new HttpError(422, "CANNOT_CANCEL", `cannot cancel a leave application in status: ${application.status}`);
    }

    return sendAccepted(reply, acceptedResponseSchema, await commands.cancelLeave(ctx, id));
  });

  app.setErrorHandler(errorHandler);
}

function errorHandler(err: unknown, req: any, reply: any): void {
  const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
  if (err instanceof ZodError) {
    void reply.code(400).send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId, retryable: false, fieldErrors: err.issues.map((i: any) => ({ field: i.path.join("."), message: i.message })) });
    return;
  }
  if (err instanceof HttpError) {
    void reply.code(err.status).send({ code: err.code, message: err.message, correlationId, retryable: false });
    return;
  }
  req.log.error({ err }, "unhandled error");
  void reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId, retryable: true });
}
