import type { FastifyInstance } from "fastify";
import { ZodError, z } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { db } from "../../shared/db.js";
import { legalHearings } from "../hearings/schema.js";
import { legalReminders } from "./schema.js";
import { and, eq, gte, lte } from "drizzle-orm";
import * as caseRepo from "../cases/repo.js";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import { randomUUID } from "node:crypto";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import { sendAccepted } from "@civitasone/schemas/validate";

const LEGAL_ROLES = ["legal_officer", "legal_admin", "super_admin"];

const reminderBody = z.object({
  remindAt: z.string().datetime(),
  message: z.string().min(1).max(500),
});

export async function reminderRoutes(app: FastifyInstance): Promise<void> {
  // Read upcoming hearings from DB
  app.get("/v1/legal/hearings/upcoming", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, LEGAL_ROLES);
    const now = new Date();
    const thirtyDays = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    const nowDate = now.toISOString().slice(0, 10);
    const thirtyDaysDate = thirtyDays.toISOString().slice(0, 10);

    const rows = await db.select().from(legalHearings).where(and(
      eq(legalHearings.tenantId, ctx.tenantId),
      gte(legalHearings.hearingDate, nowDate),
      lte(legalHearings.hearingDate, thirtyDaysDate),
      eq(legalHearings.status, "scheduled"),
    )).limit(100);

    const data = await Promise.all(rows.map(async (h) => {
      const legalCase = await caseRepo.findCaseById(h.caseId);
      return {
        id: h.id,
        caseId: h.caseId,
        caseNo: legalCase?.caseNo ?? h.caseId,
        caseTitle: legalCase?.title ?? "Case",
        date: h.hearingDate.toString(),
        court: h.court,
        purpose: h.purpose ?? null,
        nextDate: h.nextDate?.toString() ?? null,
        status: h.status,
        daysUntilHearing: Math.ceil((new Date(h.hearingDate.toString()).getTime() - now.getTime()) / 86400000),
      };
    }));

    return reply.send({ data, total: data.length });
  });

  // List reminders for a case (read from DB)
  app.get("/v1/legal/cases/:id/reminders", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, LEGAL_ROLES);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const rows = await db.select().from(legalReminders).where(
      and(eq(legalReminders.tenantId, ctx.tenantId), eq(legalReminders.caseId, id))
    ).limit(100);
    return reply.send({ data: rows, total: rows.length });
  });

  // Create reminder via CQRS (validate → queue → 202)
  app.post("/v1/legal/cases/:id/reminder", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, LEGAL_ROLES);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = reminderBody.parse(req.body);

    const reminderId = randomUUID();
    await queue.publish(COMMANDS.reminderCreate, {
      messageId: reminderId,
      type: COMMANDS.reminderCreate,
      tenantId: ctx.tenantId,
      actorId: ctx.actorId,
      correlationId: ctx.correlationId,
      schemaVersion: "1.0",
      payload: {
        id: reminderId,
        tenantId: ctx.tenantId,
        caseId: id,
        remindAt: body.remindAt,
        message: body.message,
      },
    });
    return sendAccepted(reply, acceptedResponseSchema, {
      id: reminderId,
      status: "accepted",
      correlationId: ctx.correlationId,
    });
  });

  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) {
      return reply.code(400).send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId, retryable: false });
    }
    if (err instanceof HttpError) {
      return reply.code(err.status).send({ code: err.code, message: err.message, correlationId, retryable: false });
    }
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId, retryable: true });
  });
}
