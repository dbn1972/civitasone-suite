import { randomUUID } from "node:crypto";
import { publishF3Write } from "../../shared/f3-publish.js";
/**
 * LTC and CEA claim modules (submit -> approve, with ceiling enforcement).
 *
 *  LTC (Leave Travel Concession)
 *   POST /v1/hrms/employees/:id/ltc-claims          submit
 *   GET  /v1/hrms/employees/:id/ltc-claims          list
 *   GET  /v1/hrms/ltc-claims/:claimId               read
 *   POST /v1/hrms/ltc-claims/:claimId/approve        approve (caps fare at entitlement)
 *   POST /v1/hrms/ltc-claims/:claimId/reject         reject
 *
 *  CEA (Children Education Allowance)
 *   POST /v1/hrms/employees/:id/cea-claims          submit (per-child annual cap)
 *   GET  /v1/hrms/employees/:id/cea-claims          list
 *   GET  /v1/hrms/cea-claims/:claimId               read
 *   POST /v1/hrms/cea-claims/:claimId/approve        approve (caps at annual ceiling)
 *   POST /v1/hrms/cea-claims/:claimId/reject         reject
 *
 * Money in paise (bigint). On approval the approved amount is the lesser of the
 * claimed amount and the applicable ceiling (entitlement / remaining annual cap).
 */
import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import { and, eq } from "drizzle-orm";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { scopedRead } from "../../shared/db.js";
import { hrmsEmployees } from "../employee/schema.js";
import * as repo from "./repo.js";
import type { LtcClaimRow, CeaClaimRow } from "./schema.js";

const HR_ROLES = ["hr_admin", "hr_officer", "super_admin", "finance_officer", "payroll_admin"];
const SUBMIT_ROLES = [...HR_ROLES, "manager", "employee"];
const idParam = z.object({ id: z.string().uuid() });
const claimParam = z.object({ claimId: z.string().uuid() });

function jsonSafe(v: unknown): unknown {
  if (typeof v === "bigint") return v.toString();
  if (Array.isArray(v)) return v.map(jsonSafe);
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v)) out[k] = jsonSafe(val);
    return out;
  }
  return v;
}

async function mustEmployee(tenantId: string, id: string) {
  const rows = await scopedRead((tx) => tx.select().from(hrmsEmployees)
    .where(and(eq(hrmsEmployees.id, id), eq(hrmsEmployees.tenantId, tenantId))).limit(1));
  const emp = rows[0];
  if (!emp) throw new HttpError(404, "NOT_FOUND", "employee not found");
  return emp;
}

function bmin(a: bigint, b: bigint): bigint { return a < b ? a : b; }

export async function claimsRoutes(app: FastifyInstance): Promise<void> {
  // ======================= LTC =======================
  app.post("/v1/hrms/employees/:id/ltc-claims", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, SUBMIT_ROLES);
    const { id } = idParam.parse(req.params);
    const body = z.object({
      blockYear: z.string().min(4).max(16),
      ltcType: z.enum(["hometown", "all_india"]),
      journeyFrom: z.string().min(1).max(120),
      journeyTo: z.string().min(1).max(120),
      travelDate: z.string(),
      familyMembers: z.coerce.number().int().min(1).max(20).default(1),
      claimedFareMinor: z.coerce.number().int().min(0),
      entitlementMinor: z.coerce.number().int().min(0),
      remarks: z.string().max(2000).optional(),
    }).parse(req.body);
    await mustEmployee(ctx.tenantId, id);

    const claimId = randomUUID();
    await publishF3Write(ctx, "claims_routes__4", claimId, {
      body: { ...body, claimedFareMinor: body.claimedFareMinor, entitlementMinor: body.entitlementMinor },
      params: req.params as Record<string, unknown>,
      query: req.query as Record<string, unknown>,
    });
    return reply.code(202).send(jsonSafe({
      id: claimId, employeeId: id, status: "accepted",
      claimedFareMinor: BigInt(body.claimedFareMinor), entitlementMinor: BigInt(body.entitlementMinor),
    }));
  });

  app.get("/v1/hrms/employees/:id/ltc-claims", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, SUBMIT_ROLES);
    const { id } = idParam.parse(req.params);
    return reply.send(jsonSafe({ data: await repo.listLtcByEmployee(ctx.tenantId, id) }));
  });

  app.get("/v1/hrms/ltc-claims/:claimId", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, SUBMIT_ROLES);
    const { claimId } = claimParam.parse(req.params);
    const c = await mustLtc(ctx.tenantId, claimId);
    return reply.send(jsonSafe(c));
  });

  app.post("/v1/hrms/ltc-claims/:claimId/approve", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { claimId } = claimParam.parse(req.params);
    const body = z.object({ approverRemarks: z.string().max(2000).optional() }).parse(req.body ?? {});
    const c = await mustLtc(ctx.tenantId, claimId);
    if (c.status !== "submitted") throw new HttpError(409, "WRONG_STATE", `claim is '${c.status}', not submitted`);
    // Ceiling enforcement: approved fare cannot exceed the entitlement.
    const approved = bmin(c.claimedFareMinor, c.entitlementMinor);
    await publishF3Write(ctx, "claims_routes__0", randomUUID(), { body: (req.body as Record<string, unknown>) ?? {}, params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> })
    return reply.send(jsonSafe({
      id: claimId, status: "approved", claimedFareMinor: c.claimedFareMinor,
      entitlementMinor: c.entitlementMinor, approvedFareMinor: approved,
      cappedToEntitlement: c.claimedFareMinor > c.entitlementMinor,
    })) as any;
  });

  app.post("/v1/hrms/ltc-claims/:claimId/reject", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { claimId } = claimParam.parse(req.params);
    const body = z.object({ approverRemarks: z.string().max(2000).optional() }).parse(req.body ?? {});
    const c = await mustLtc(ctx.tenantId, claimId);
    if (c.status !== "submitted") throw new HttpError(409, "WRONG_STATE", `claim is '${c.status}', not submitted`);
    await publishF3Write(ctx, "claims_routes__1", randomUUID(), { body: (req.body as Record<string, unknown>) ?? {}, params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> })
    return reply.send(jsonSafe({ id: claimId, status: "rejected" })) as any;
  });

  // ======================= CEA =======================
  app.post("/v1/hrms/employees/:id/cea-claims", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, SUBMIT_ROLES);
    const { id } = idParam.parse(req.params);
    const body = z.object({
      academicYear: z.string().min(4).max(16),
      childName: z.string().min(1).max(120),
      childRef: z.string().min(1).max(64),
      claimKind: z.enum(["tuition", "hostel"]),
      claimedAmountMinor: z.coerce.number().int().min(0),
      annualCapMinor: z.coerce.number().int().min(0),
      remarks: z.string().max(2000).optional(),
    }).parse(req.body);
    await mustEmployee(ctx.tenantId, id);

    // Per-child annual cap enforcement at submit: committed (submitted+approved)
    // for this child+kind+year plus this claim must not exceed the annual cap.
    const committed = await repo.ceaCommittedForChild(
      ctx.tenantId, id, body.academicYear, body.childRef, body.claimKind);
    const claimed = BigInt(body.claimedAmountMinor);
    const cap = BigInt(body.annualCapMinor);
    if (committed + claimed > cap) {
      throw new HttpError(409, "CEA_CAP_EXCEEDED",
        `per-child annual cap exceeded: already committed ${committed} + claimed ${claimed} > cap ${cap}`);
    }

    const claimId = randomUUID();
    await publishF3Write(ctx, "claims_routes__5", claimId, {
      body: {
        ...body,
        claimedAmountMinor: body.claimedAmountMinor,
        annualCapMinor: body.annualCapMinor,
      },
      params: req.params as Record<string, unknown>,
      query: req.query as Record<string, unknown>,
    });
    return reply.code(202).send(jsonSafe({
      id: claimId, employeeId: id, status: "accepted",
      claimedAmountMinor: claimed, annualCapMinor: cap,
      remainingCapMinor: cap - committed - claimed,
    }));
  });

  app.get("/v1/hrms/employees/:id/cea-claims", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, SUBMIT_ROLES);
    const { id } = idParam.parse(req.params);
    return reply.send(jsonSafe({ data: await repo.listCeaByEmployee(ctx.tenantId, id) }));
  });

  app.get("/v1/hrms/cea-claims/:claimId", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, SUBMIT_ROLES);
    const { claimId } = claimParam.parse(req.params);
    const c = await mustCea(ctx.tenantId, claimId);
    return reply.send(jsonSafe(c));
  });

  app.post("/v1/hrms/cea-claims/:claimId/approve", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { claimId } = claimParam.parse(req.params);
    const body = z.object({ approverRemarks: z.string().max(2000).optional() }).parse(req.body ?? {});
    const c = await mustCea(ctx.tenantId, claimId);
    if (c.status !== "submitted") throw new HttpError(409, "WRONG_STATE", `claim is '${c.status}', not submitted`);
    // Remaining cap = annual cap - committed by OTHER (submitted+approved) claims
    // for the same child+kind+year. Approved amount is min(claimed, remaining).
    const otherCommitted = await repo.ceaCommittedForChild(
      ctx.tenantId, c.employeeId, c.academicYear, c.childRef, c.claimKind, c.id);
    const remaining = c.annualCapMinor - otherCommitted;
    const approved = remaining <= 0n ? 0n : bmin(c.claimedAmountMinor, remaining);
    await publishF3Write(ctx, "claims_routes__2", randomUUID(), { body: (req.body as Record<string, unknown>) ?? {}, params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> })
    return reply.send(jsonSafe({
      id: claimId, status: "approved", claimedAmountMinor: c.claimedAmountMinor,
      annualCapMinor: c.annualCapMinor, approvedAmountMinor: approved,
      cappedToAnnualCap: c.claimedAmountMinor > remaining,
    })) as any;
  });

  app.post("/v1/hrms/cea-claims/:claimId/reject", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { claimId } = claimParam.parse(req.params);
    const body = z.object({ approverRemarks: z.string().max(2000).optional() }).parse(req.body ?? {});
    const c = await mustCea(ctx.tenantId, claimId);
    if (c.status !== "submitted") throw new HttpError(409, "WRONG_STATE", `claim is '${c.status}', not submitted`);
    await publishF3Write(ctx, "claims_routes__3", randomUUID(), { body: (req.body as Record<string, unknown>) ?? {}, params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> })
    return reply.send(jsonSafe({ id: claimId, status: "rejected" })) as any;
  });

  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) {
      return reply.code(400).send({
        code: "VALIDATION_FAILED", message: "invalid request", correlationId,
        fieldErrors: err.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
      });
    }
    if (err instanceof HttpError) return reply.code(err.status).send({ code: err.code, message: err.message, correlationId });
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId });
  });

  async function mustLtc(tenantId: string, claimId: string): Promise<LtcClaimRow> {
    const c = await repo.findLtc(tenantId, claimId);
    if (!c) throw new HttpError(404, "NOT_FOUND", "LTC claim not found");
    return c;
  }
  async function mustCea(tenantId: string, claimId: string): Promise<CeaClaimRow> {
    const c = await repo.findCea(tenantId, claimId);
    if (!c) throw new HttpError(404, "NOT_FOUND", "CEA claim not found");
    return c;
  }
}
