import { randomUUID } from "node:crypto";
import { publishF3Write } from "../../shared/f3-publish.js";
import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import { eq, and, sql } from "drizzle-orm";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { sendAccepted } from "@civitasone/schemas/validate";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import { db, scopedRead} from "../../shared/db.js";
import { hrmsHolidays } from "./schema.js";
import { queue } from "../../shared/infra.js";

const HR_ROLES = ["hr_admin", "super_admin", "admin"];
const ALL_ROLES = [...HR_ROLES, "hr_officer", "officer", "employee"];

const createHolidayBody = z.object({
  name: z.string().min(1).max(256),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  type: z.enum(["gazetted", "restricted", "optional", "weekly_off"]).default("gazetted"),
  applicableTo: z.string().default("all"),
});

export async function holidayRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/hrms/holidays", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ALL_ROLES);
    const q = z.object({ year: z.string().regex(/^\d{4}$/).default(String(new Date().getFullYear())) }).parse(req.query);
    const rows = await scopedRead((tx) => tx.select().from(hrmsHolidays)
      .where(and(
        eq(hrmsHolidays.tenantId, ctx.tenantId),
        sql`${hrmsHolidays.date} >= ${q.year + '-01-01'}`,
        sql`${hrmsHolidays.date} <= ${q.year + '-12-31'}`
      )));
    return reply.send({ data: rows.map(r => ({ id: r.id, name: r.name, date: r.date, type: r.type, applicableTo: r.applicableTo })) });
  });

  app.post("/v1/hrms/holidays", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const body = createHolidayBody.parse(req.body);
    const id = randomUUID();
    await publishF3Write(ctx, "holidays_routes__0", (typeof id === "string" ? id : randomUUID()), { body: (typeof body !== "undefined" ? body : (req.body as Record<string, unknown>)), params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> })
    return sendAccepted(reply, acceptedResponseSchema, { id, status: "accepted" as const, correlationId: ctx.correlationId });
  });

  app.delete("/v1/hrms/holidays/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    await publishF3Write(ctx, "holidays_routes__1", (typeof id === "string" ? id : randomUUID()), { body: (typeof body !== "undefined" ? body : (req.body as Record<string, unknown>)), params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> })
    return reply.code(204).send();
  });

  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) {
      return reply.code(400).send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId, fieldErrors: err.issues.map((i) => ({ field: i.path.join("."), message: i.message })) });
    }
    if (err instanceof HttpError) return reply.code(err.status).send({ code: err.code, message: err.message, correlationId });
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId });
  });
}
