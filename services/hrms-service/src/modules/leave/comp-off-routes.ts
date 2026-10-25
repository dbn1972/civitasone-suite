/**
 * P2-003: Comp-Off API
 * - POST /v1/hrms/comp-off (HR grants comp-off; CQRS 202, persisted by comp-off-consumer.ts)
 * - GET /v1/hrms/comp-off (list available comp-offs)
 * - POST /v1/hrms/comp-off/:id/redeem (use comp-off as leave; CQRS 202)
 */
import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { and, eq } from "drizzle-orm";
import { sendAccepted } from "@civitasone/schemas/validate";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import { scopedRead } from "../../shared/db.js";
import { hrmsCompOff } from "./schema.js";
import * as commands from "./comp-off-commands.js";
import { resolveEmployeeForActor } from "../employee/actor-link.js";

const HR_ROLES = ["hr_admin", "hr_officer", "super_admin"];
const ALL_ROLES = [...HR_ROLES, "manager", "employee"];

// V4-B-01: comp-off is an entitlement grant. Only HR may grant it (the
// approval step); every other role may only read/redeem its OWN entries.
function isHr(ctx: { roles: readonly string[] }): boolean {
  return ctx.roles.some((r) => HR_ROLES.includes(r));
}

async function ownEmployeeId(ctx: { tenantId: string; actorId: string }): Promise<string> {
  const emp = await resolveEmployeeForActor(ctx.tenantId, ctx.actorId);
  if (!emp) throw new HttpError(403, "FORBIDDEN", "no employee record is linked to this account");
  return emp.id;
}

const earnCompOffBody = z.object({
  employeeId: z.string().uuid(),
  // ISO date (YYYY-MM-DD) of when they worked on holiday; validated here so a
  // malformed value can never reach the consumer as an un-retryable poison message.
  workedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((d) => new Date(`${d}T00:00:00Z`).toISOString().startsWith(d), "invalid calendar date"),
  holidayName: z.string().min(1),
  hours: z.number().int().min(1).max(24).default(8),
  reason: z.string().optional(),
});

const querySchema = z.object({
  employeeId: z.string().uuid().optional(),
  status: z.enum(["available", "redeemed", "expired", "all"]).default("available"),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export async function compOffRoutes(app: FastifyInstance): Promise<void> {
  // Earn comp-off for working on holiday
  app.post("/v1/hrms/comp-off", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const body = earnCompOffBody.parse(req.body);

    const dup = await scopedRead((tx) => tx.select({ id: hrmsCompOff.id }).from(hrmsCompOff)
      .where(and(
        eq(hrmsCompOff.tenantId, ctx.tenantId), eq(hrmsCompOff.employeeId, body.employeeId),
        eq(hrmsCompOff.workedDate, body.workedDate),
      )).limit(1));
    if (dup[0]) throw new HttpError(409, "ALREADY_GRANTED", "comp-off already granted for this employee and day");

    return sendAccepted(reply, acceptedResponseSchema, await commands.earnCompOff(ctx, {
      employeeId: body.employeeId, workedDate: body.workedDate, holidayName: body.holidayName,
      hours: body.hours, reason: body.reason ?? "",
    }));
  });

  // List available comp-offs
  app.get("/v1/hrms/comp-off", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ALL_ROLES);
    const q = querySchema.parse(req.query);

    let scopeTo = q.employeeId;
    if (!isHr(ctx)) {
      const own = await ownEmployeeId(ctx);
      if (q.employeeId && q.employeeId !== own) {
        throw new HttpError(403, "FORBIDDEN", "cannot view another employee's comp-off");
      }
      scopeTo = own;
    }
    const conds = [eq(hrmsCompOff.tenantId, ctx.tenantId)];
    if (scopeTo) conds.push(eq(hrmsCompOff.employeeId, scopeTo));
    if (q.status !== "all") conds.push(eq(hrmsCompOff.status, q.status));
    const results = await scopedRead((tx) => tx.select().from(hrmsCompOff)
      .where(and(...conds)).orderBy(hrmsCompOff.workedDate, hrmsCompOff.id).limit(q.limit));

    return reply.send({ data: results });
  });

  // Redeem comp-off as leave
  app.post("/v1/hrms/comp-off/:id/redeem", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ALL_ROLES);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);

    const callerEmployeeId = isHr(ctx) ? undefined : await ownEmployeeId(ctx);
    const [compOff] = await scopedRead((tx) => tx.select().from(hrmsCompOff)
      .where(and(
        eq(hrmsCompOff.id, id), eq(hrmsCompOff.tenantId, ctx.tenantId),
        ...(callerEmployeeId ? [eq(hrmsCompOff.employeeId, callerEmployeeId)] : []),
      )).limit(1));
    if (!compOff) throw new HttpError(404, "NOT_FOUND", "comp-off not found");
    if (compOff.status === "redeemed") {
      throw new HttpError(409, "ALREADY_REDEEMED", "comp-off has already been redeemed");
    }
    if (compOff.status === "expired") {
      throw new HttpError(422, "EXPIRED", "comp-off has expired and cannot be redeemed");
    }

    return sendAccepted(reply, acceptedResponseSchema, await commands.redeemCompOff(ctx, id, callerEmployeeId ?? null));
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
