import type { FastifyInstance } from "fastify";
import { ZodError, z } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { db } from "../../shared/db.js";
import { legalHearings } from "../hearings/schema.js";
import { and, eq, gte, lte } from "drizzle-orm";
import * as caseRepo from "../cases/repo.js";

const LEGAL_ROLES = ["legal_officer", "legal_admin", "super_admin"];

interface Reminder {
  id: string;
  tenantId: string;
  caseId: string;
  remindAt: string;
  message: string;
  createdBy: string;
  createdAt: string;
  sent: boolean;
}

// In-process reminder store (persisted to notification service via events in production)
const reminderStore: Reminder[] = [];

const reminderBody = z.object({
  remindAt: z.string().datetime(),
  message: z.string().min(1).max(500),
});

export async function reminderRoutes(app: FastifyInstance): Promise<void> {
  // Read upcoming hearings from DB (not an in-memory store that misses CQRS-persisted records)
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

  app.post("/v1/legal/cases/:id/reminder", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, LEGAL_ROLES);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = reminderBody.parse(req.body);

    const record: Reminder = {
      id: crypto.randomUUID(),
      tenantId: ctx.tenantId,
      caseId: id,
      remindAt: body.remindAt,
      message: body.message,
      createdBy: ctx.actorId,
      createdAt: new Date().toISOString(),
      sent: false,
    };
    reminderStore.push(record);
    return reply.code(201).send({ data: record });
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
