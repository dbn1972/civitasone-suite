import { sendAccepted } from "@civitasone/schemas/validate";
import { acceptedResponseSchema, listQuerySchema } from "@civitasone/schemas/common";
import { TrainingProgramSummaryListSchema } from "@civitasone/schemas/web";
import { sendValidated } from "@civitasone/schemas/validate";
import type { FastifyInstance } from "fastify";
import { ZodError, z } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { createTrainingBody, createNominationBody, completeNominationBody, myNominationsQuery } from "./validators.js";
import * as commands from "./commands.js";
import * as queries from "./queries.js";
import * as repo from "./repo.js";
import { and, eq, inArray } from "drizzle-orm";
import { hrmsTrainings } from "./schema.js";
import { scopedRead } from "../../shared/db.js";
import { hrmsEmployees, hrmsDepartments } from "../employee/schema.js";

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

  // SVC-121/122 -- an employee's own nominations with approval state + linked
  // training/session. Tenant-scoped + RLS-safe (read runs inside scopedRead).
  app.get("/v1/hrms/nominations", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ALL_ROLES);
    const q = myNominationsQuery.parse(req.query);
    return reply.send(await queries.listMyNominations(ctx.tenantId, q.employeeId, q.limit));
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
    // exactOptionalPropertyTypes: omit score/certificateRef when absent
    return sendAccepted(reply, acceptedResponseSchema, await commands.completeNomination(ctx, id, {
      completedDate: body.completedDate,
      result: body.result,
      trainingTitle: training?.title ?? null,
      ...(body.score !== undefined ? { score: body.score } : {}),
      ...(body.certificateRef !== undefined ? { certificateRef: body.certificateRef } : {}),
    }));
  });

  // HR admin: all nominations for the tenant, joined with training programs and employees
  app.get("/v1/hrms/training/nominations", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);

    const nominations = await repo.listNominationsForAdmin(ctx.tenantId);
    if (nominations.length === 0) return reply.send({ data: [] });

    const trainingIds = [...new Set(nominations.map((n) => n.trainingId))];
    const employeeIds = [...new Set(nominations.map((n) => n.employeeId))];

    const [trainings, employees] = await Promise.all([
      scopedRead((tx) => tx
        .select({ id: hrmsTrainings.id, title: hrmsTrainings.title, fromDate: hrmsTrainings.fromDate })
        .from(hrmsTrainings)
        .where(and(eq(hrmsTrainings.tenantId, ctx.tenantId), inArray(hrmsTrainings.id, trainingIds)))),
      scopedRead((tx) => tx
        .select({ id: hrmsEmployees.id, fullName: hrmsEmployees.fullName, departmentId: hrmsEmployees.departmentId })
        .from(hrmsEmployees)
        .where(and(eq(hrmsEmployees.tenantId, ctx.tenantId), inArray(hrmsEmployees.id, employeeIds)))),
    ]);

    const deptIds = [...new Set(employees.map((e) => e.departmentId))];
    const departments = deptIds.length > 0
      ? await scopedRead((tx) => tx
          .select({ id: hrmsDepartments.id, name: hrmsDepartments.name })
          .from(hrmsDepartments)
          .where(and(eq(hrmsDepartments.tenantId, ctx.tenantId), inArray(hrmsDepartments.id, deptIds))))
      : [];

    const trainingMap = new Map(trainings.map((t) => [t.id, t]));
    const employeeMap = new Map(employees.map((e) => [e.id, e]));
    const deptMap = new Map(departments.map((d) => [d.id, d]));

    const data = nominations.map((n) => {
      const emp = employeeMap.get(n.employeeId);
      const dept = emp ? deptMap.get(emp.departmentId) : undefined;
      const training = trainingMap.get(n.trainingId);
      return {
        id: n.id,
        employee: emp?.fullName ?? "—",
        department: dept?.name ?? "—",
        program: training?.title ?? "—",
        nominatedBy: n.nominatedBy ?? "—",
        nominationDate: n.createdAt.toISOString().slice(0, 10),
        programDate: training?.fromDate ?? "—",
        status: n.status,
      };
    });

    return reply.send({ data });
  });

  // HR admin: completed nominations shaped as post-training feedback records
  app.get("/v1/hrms/training/feedback", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);

    const nominations = await repo.listCompletedNominationsForAdmin(ctx.tenantId);
    if (nominations.length === 0) return reply.send({ data: [] });

    const trainingIds = [...new Set(nominations.map((n) => n.trainingId))];
    const employeeIds = [...new Set(nominations.map((n) => n.employeeId))];

    const [trainings, employees] = await Promise.all([
      scopedRead((tx) => tx
        .select({ id: hrmsTrainings.id, title: hrmsTrainings.title })
        .from(hrmsTrainings)
        .where(and(eq(hrmsTrainings.tenantId, ctx.tenantId), inArray(hrmsTrainings.id, trainingIds)))),
      scopedRead((tx) => tx
        .select({ id: hrmsEmployees.id, fullName: hrmsEmployees.fullName })
        .from(hrmsEmployees)
        .where(and(eq(hrmsEmployees.tenantId, ctx.tenantId), inArray(hrmsEmployees.id, employeeIds)))),
    ]);

    const trainingMap = new Map(trainings.map((t) => [t.id, t]));
    const employeeMap = new Map(employees.map((e) => [e.id, e]));

    const data = nominations.map((n) => ({
      id: n.id,
      employee: employeeMap.get(n.employeeId)?.fullName ?? "—",
      program: trainingMap.get(n.trainingId)?.title ?? "—",
      rating: n.score != null ? String(n.score) : "—",
      contentRating: "—",
      trainerRating: "—",
      comments: n.certificateRef ?? "",
      submittedOn: n.completedDate ?? n.updatedAt.toISOString().slice(0, 10),
    }));

    return reply.send({ data });
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
