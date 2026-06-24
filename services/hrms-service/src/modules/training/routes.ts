import { sendAccepted } from "@civitasone/schemas/validate";
import { acceptedResponseSchema, listQuerySchema } from "@civitasone/schemas/common";
import { TrainingProgramSummaryListSchema } from "@civitasone/schemas/web";
import { sendValidated } from "@civitasone/schemas/validate";
import type { FastifyInstance } from "fastify";
import { ZodError, z } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { db } from "../../shared/db.js";
import { hrmsServiceBookEntries } from "../service-book/schema.js";
import { createTrainingBody, createNominationBody, completeNominationBody } from "./validators.js";
import * as commands from "./commands.js";
import * as queries from "./queries.js";
import * as repo from "./repo.js";

const HR_ROLES  = ["hr_admin", "hr_officer", "super_admin"];
const ALL_ROLES = [...HR_ROLES, "manager", "employee"];

export async function trainingRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/hrms/training-programs", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ALL_ROLES);
    const q = listQuerySchema.parse(req.query);
    sendValidated(reply, TrainingProgramSummaryListSchema, await queries.listTrainingPrograms(ctx.tenantId, q.limit));
  });

  app.post("/v1/hrms/trainings", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const body = createTrainingBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.createTraining(ctx, body));
  });

  app.post("/v1/hrms/nominations", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ALL_ROLES);
    const body = createNominationBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.createNomination(ctx, body));
  });

  // LMS completion: record completion + feed the service book / competency record.
  app.post("/v1/hrms/nominations/:id/complete", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = completeNominationBody.parse(req.body);
    const nom = await repo.getNomination(ctx.tenantId, id);
    if (!nom) throw new HttpError(404, "NOT_FOUND", "nomination not found");
    if (nom.status === "completed") throw new HttpError(409, "ALREADY_COMPLETED", "nomination already completed");
    const training = await repo.getTraining(ctx.tenantId, nom.trainingId);
    const result = await db.transaction(async (tx) => {
      const row = await repo.completeNomination(tx, ctx.tenantId, id, ctx.actorId, {
        completedDate: body.completedDate,
        result: body.result,
        score: body.score ?? null,
        certificateRef: body.certificateRef ?? null,
      });
      if (!row) return null;
      // Feed the service book so completed training appears in the competency record.
      await tx.insert(hrmsServiceBookEntries).values({
        tenantId: ctx.tenantId,
        employeeId: row.employeeId,
        entryType: "training",
        effectiveDate: body.completedDate,
        description: `Completed training "${training?.title ?? row.trainingId}" — result ${body.result}`
          + (body.score != null ? ` (score ${body.score})` : ""),
        recordedBy: ctx.actorId,
        documentRef: body.certificateRef ?? null,
      });
      return row;
    });
    if (!result) throw new HttpError(409, "INVALID_STATE", "nomination cannot be completed from its current state");
    return reply.send({ id, status: "completed", result: body.result });
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
  req.log.error({ err }, "unhandled error");
  void reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId, retryable: true });
}
