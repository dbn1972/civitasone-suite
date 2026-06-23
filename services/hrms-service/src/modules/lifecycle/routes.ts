import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { ZodError, z } from "zod";
import { eq, desc } from "drizzle-orm";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { db } from "../../shared/db.js";
import { hrmsPromotions, hrmsTransfers } from "./schema.js";
import { hrmsServiceBookEntries } from "../service-book/schema.js";
import { hrmsEmployees } from "../employee/schema.js";
import * as repo from "./repo.js";

const HR_ROLES = ["hr_admin", "hr_officer", "super_admin"];

export async function lifecycleRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/hrms/lifecycle/promotions", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const rows = await db.select().from(hrmsPromotions)
      .where(eq(hrmsPromotions.tenantId, ctx.tenantId))
      .orderBy(desc(hrmsPromotions.effectiveDate));
    return reply.send({ data: rows });
  });

  app.post("/v1/hrms/lifecycle/promotions", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const body = req.body as Record<string, unknown>;
    const id = randomUUID();
    await db.transaction(async (tx) => {
      await repo.insertPromotion(tx, {
        id, tenantId: ctx.tenantId, createdBy: ctx.actorId, updatedBy: ctx.actorId,
        employeeId: body.employeeId as string,
        fromDesigId: body.fromDesigId as string,
        toDesigId: body.toDesigId as string,
        effectiveDate: body.effectiveDate as string,
        orderRef: (body.orderRef as string) ?? null,
        newBasicMinor: body.newBasicMinor ? BigInt(body.newBasicMinor as number) : null,
      });
      // Apply the promotion to the employee master (designation + basic pay)
      const promoSet: Record<string, unknown> = { designationId: body.toDesigId as string, updatedBy: ctx.actorId };
      if (body.newBasicMinor) promoSet.basicMinor = BigInt(body.newBasicMinor as number);
      await tx.update(hrmsEmployees).set(promoSet)
        .where(eq(hrmsEmployees.id, body.employeeId as string));
      // NIC eHRMS: record the event in the service book
      await tx.insert(hrmsServiceBookEntries).values({
        tenantId: ctx.tenantId,
        employeeId: body.employeeId as string,
        entryType: "promotion",
        effectiveDate: body.effectiveDate as string,
        description: `Promotion to designation ${body.toDesigId as string}` + (body.newBasicMinor ? ` at basic Rs ${(Number(body.newBasicMinor) / 100).toLocaleString("en-IN")}` : ""),
        recordedBy: ctx.actorId,
        documentRef: (body.orderRef as string) ?? null,
      });
    });
    return reply.code(202).send({ id });
  });

  app.get("/v1/hrms/lifecycle/transfers", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const rows = await db.select().from(hrmsTransfers)
      .where(eq(hrmsTransfers.tenantId, ctx.tenantId))
      .orderBy(desc(hrmsTransfers.effectiveDate));
    return reply.send({ data: rows });
  });

  app.post("/v1/hrms/lifecycle/transfers", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const body = req.body as Record<string, unknown>;
    const id = randomUUID();
    await db.transaction(async (tx) => {
      await repo.insertTransfer(tx, {
        id, tenantId: ctx.tenantId, createdBy: ctx.actorId, updatedBy: ctx.actorId,
        employeeId: body.employeeId as string,
        fromDeptId: body.fromDeptId as string,
        toDeptId: body.toDeptId as string,
        fromDesigId: (body.fromDesigId as string) ?? null,
        toDesigId: (body.toDesigId as string) ?? null,
        effectiveDate: body.effectiveDate as string,
        orderRef: (body.orderRef as string) ?? null,
      });
      // Apply the transfer to the employee master (department)
      await tx.update(hrmsEmployees)
        .set({ departmentId: body.toDeptId as string, updatedBy: ctx.actorId })
        .where(eq(hrmsEmployees.id, body.employeeId as string));
      // NIC eHRMS: record the event in the service book
      await tx.insert(hrmsServiceBookEntries).values({
        tenantId: ctx.tenantId,
        employeeId: body.employeeId as string,
        entryType: "transfer",
        effectiveDate: body.effectiveDate as string,
        description: `Transfer to department ${body.toDeptId as string}`,
        recordedBy: ctx.actorId,
        documentRef: (body.orderRef as string) ?? null,
      });
    });
    return reply.code(202).send({ id });
  });

  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) return reply.code(400).send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId });
    if (err instanceof HttpError) return reply.code(err.status).send({ code: err.code, message: err.message, correlationId });
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId });
  });
}
