import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { eq, and, sql } from "drizzle-orm";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { sendAccepted } from "@civitasone/schemas/validate";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import { db, scopedRead} from "../../shared/db.js";
import { hrmsHolidays } from "./schema.js";
import { randomUUID } from "node:crypto";
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
    await db.insert(hrmsHolidays).values({ id, tenantId: ctx.tenantId, name: body.name, date: body.date, type: body.type, applicableTo: body.applicableTo, createdBy: ctx.actorId });
    return sendAccepted(reply, acceptedResponseSchema, { id, status: "accepted" as const, correlationId: ctx.correlationId });
  });

  app.delete("/v1/hrms/holidays/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    await db.delete(hrmsHolidays).where(and(eq(hrmsHolidays.id, id), eq(hrmsHolidays.tenantId, ctx.tenantId)));
    return reply.code(204).send();
  });
}
