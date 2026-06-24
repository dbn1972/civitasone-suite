import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { ZodError, z } from "zod";
import { eq, desc } from "drizzle-orm";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { db } from "../../shared/db.js";
import { hrmsPromotions, hrmsTransfers } from "./schema.js";
import { hrmsServiceBookEntries } from "../service-book/schema.js";
import { hrmsEmployees } from "../employee/schema.js";
import { createTransferBody, issueOrderBody, relieveBody, joinBody, idParam } from "./validators.js";
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

  // Step 1: create a transfer REQUEST (no master mutation yet — order not issued).
  app.post("/v1/hrms/lifecycle/transfers", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const body = createTransferBody.parse(req.body);
    const id = randomUUID();
    await db.transaction(async (tx) => {
      await repo.insertTransfer(tx, {
        id, tenantId: ctx.tenantId, createdBy: ctx.actorId, updatedBy: ctx.actorId,
        employeeId: body.employeeId,
        fromDeptId: body.fromDeptId,
        toDeptId: body.toDeptId,
        fromDesigId: body.fromDesigId ?? null,
        toDesigId: body.toDesigId ?? null,
        effectiveDate: body.effectiveDate,
        orderRef: body.orderRef ?? null,
        fromStation: body.fromStation ?? null,
        toStation: body.toStation ?? null,
        status: "requested",
      });
    });
    return reply.code(201).send({ id, status: "requested" });
  });

  // Step 2: issue the formal transfer ORDER (requested -> ordered).
  app.post("/v1/hrms/lifecycle/transfers/:id/issue-order", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { id } = idParam.parse(req.params);
    const body = issueOrderBody.parse(req.body);
    const updated = await repo.transitionTransfer(ctx.tenantId, id, ctx.actorId, {
      from: ["requested", "pending"], to: "ordered",
      set: { orderNo: body.orderNo, orderDate: body.orderDate, orderRef: body.orderRef ?? null },
    });
    if (!updated) throw new HttpError(409, "INVALID_STATE", "transfer not in a state that can be ordered");
    return reply.send({ id, status: "ordered", orderNo: body.orderNo });
  });

  // Step 3: relieve at the old station (ordered -> relieved).
  app.post("/v1/hrms/lifecycle/transfers/:id/relieve", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { id } = idParam.parse(req.params);
    const body = relieveBody.parse(req.body);
    const updated = await repo.transitionTransfer(ctx.tenantId, id, ctx.actorId, {
      from: ["ordered"], to: "relieved",
      set: { relievedDate: body.relievedDate },
    });
    if (!updated) throw new HttpError(409, "INVALID_STATE", "transfer must be in 'ordered' state to relieve");
    return reply.send({ id, status: "relieved" });
  });

  // Step 4: join at the new station — applies to master + writes service book (relieved -> joined).
  app.post("/v1/hrms/lifecycle/transfers/:id/join", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { id } = idParam.parse(req.params);
    const body = joinBody.parse(req.body);
    const result = await db.transaction(async (tx) => {
      const row = await repo.transitionTransfer(ctx.tenantId, id, ctx.actorId, {
        from: ["relieved"], to: "joined",
        set: { joinedDate: body.joinedDate },
      }, tx);
      if (!row) return null;
      // Apply posting/station to the employee master at JOINING (not at request time).
      const masterSet: Record<string, unknown> = { departmentId: row.toDeptId, updatedBy: ctx.actorId };
      if (row.toDesigId) masterSet.designationId = row.toDesigId;
      if (row.toStation) masterSet.station = row.toStation;
      await tx.update(hrmsEmployees).set(masterSet)
        .where(eq(hrmsEmployees.id, row.employeeId));
      // NIC eHRMS: record the transfer in the service book.
      await tx.insert(hrmsServiceBookEntries).values({
        tenantId: ctx.tenantId,
        employeeId: row.employeeId,
        entryType: "transfer",
        effectiveDate: body.joinedDate,
        description: `Transferred and joined at ${row.toStation ?? "new station"} (dept ${row.toDeptId})`
          + (row.orderNo ? `, vide order ${row.orderNo}` : ""),
        recordedBy: ctx.actorId,
        documentRef: row.orderNo ?? row.orderRef ?? null,
      });
      return row;
    });
    if (!result) throw new HttpError(409, "INVALID_STATE", "transfer must be in 'relieved' state to join");
    return reply.send({ id, status: "joined" });
  });

  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) return reply.code(400).send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId });
    if (err instanceof HttpError) return reply.code(err.status).send({ code: err.code, message: err.message, correlationId });
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId });
  });
}
