/**
 * Reservation roster (item 3) + sanctioned-post / vacancy control (item 4).
 *
 *  Reservation roster:
 *    POST /v1/hrms/reservation/rosters                 define a roster
 *    GET  /v1/hrms/reservation/rosters                 list rosters
 *    GET  /v1/hrms/reservation/rosters/:rid            read a roster
 *    POST /v1/hrms/reservation/rosters/:rid/vacancies  compute category-wise vacancy
 *    POST /v1/hrms/reservation/rosters/:rid/points     materialise the point chart
 *    GET  /v1/hrms/reservation/rosters/:rid/points     read the point chart
 *
 *  Sanctioned posts / vacancy control:
 *    POST /v1/hrms/sanctioned-posts                    define sanctioned strength
 *    GET  /v1/hrms/sanctioned-posts                    list with filled/vacant
 *    GET  /v1/hrms/sanctioned-posts/:pid               read with vacancy
 *
 * Filled strength is computed live against employee.hrms_employees (active,
 * matched by cadre = designation name, case-insensitive).
 */
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import { and, asc, eq, sql } from "drizzle-orm";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { db, scopedRead} from "../../shared/db.js";
import {
  hrmsRosters, hrmsRosterPoints, hrmsSanctionedPosts,
  type RosterRow, type SanctionedPostRow,
} from "./schema.js";
import { computeRoster, generateRosterPoints, type FilledByCategory } from "./engine.js";

const HR_ROLES = ["hr_admin", "super_admin", "hr_officer"];
const ADMIN_ROLES = ["hr_admin", "super_admin"];
const ridParam = z.object({ rid: z.string().uuid() });
const pidParam = z.object({ pid: z.string().uuid() });

function rosterToDef(r: RosterRow) {
  return {
    rosterSize: r.rosterSize,
    pctSc: Number(r.pctSc), pctSt: Number(r.pctSt), pctObc: Number(r.pctObc),
    pctEws: Number(r.pctEws), pctPwd: Number(r.pctPwd),
    cf: { SC: r.cfSc, ST: r.cfSt, OBC: r.cfObc, EWS: r.cfEws, UR: r.cfUr },
  };
}

/** Live filled strength for a cadre = count of active employees whose
 * designation name matches the cadre (case-insensitive). */
async function filledStrengthForCadre(tenantId: string, cadre: string): Promise<number> {
  const rows = await scopedRead((tx) => tx.execute<{ n: string }>(sql`
    SELECT COUNT(*)::text AS n
    FROM employee.hrms_employees e
    JOIN employee.hrms_designations d ON d.id = e.designation_id AND d.tenant_id = e.tenant_id
    WHERE e.tenant_id = ${tenantId}
      AND e.status <> 'separated'
      AND lower(d.name) = lower(${cadre})`));
  const arr = rows as unknown as Array<{ n: string }>;
  return Number(arr[0]?.n ?? "0");
}

export async function reservationRoutes(app: FastifyInstance): Promise<void> {
  // ===================== Reservation rosters =====================
  app.post("/v1/hrms/reservation/rosters", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const body = z.object({
      cadre: z.string().min(1).max(120),
      rosterKind: z.enum(["point100", "point200"]).default("point100"),
      rosterSize: z.coerce.number().int().min(1).max(2000).default(100),
      pctSc: z.coerce.number().min(0).max(100).default(15),
      pctSt: z.coerce.number().min(0).max(100).default(7.5),
      pctObc: z.coerce.number().min(0).max(100).default(27),
      pctEws: z.coerce.number().min(0).max(100).default(10),
      pctPwd: z.coerce.number().min(0).max(100).default(4),
      cfSc: z.coerce.number().int().min(0).default(0),
      cfSt: z.coerce.number().int().min(0).default(0),
      cfObc: z.coerce.number().int().min(0).default(0),
      cfEws: z.coerce.number().int().min(0).default(0),
      cfUr: z.coerce.number().int().min(0).default(0),
    }).parse(req.body);
    const id = randomUUID();
    await db.transaction((tx) => tx.insert(hrmsRosters).values({
      id, tenantId: ctx.tenantId, cadre: body.cadre, rosterKind: body.rosterKind,
      rosterSize: body.rosterSize,
      pctSc: body.pctSc.toFixed(2), pctSt: body.pctSt.toFixed(2),
      pctObc: body.pctObc.toFixed(2), pctEws: body.pctEws.toFixed(2),
      pctPwd: body.pctPwd.toFixed(2),
      cfSc: body.cfSc, cfSt: body.cfSt, cfObc: body.cfObc, cfEws: body.cfEws, cfUr: body.cfUr,
      createdBy: ctx.actorId, updatedBy: ctx.actorId,
    }));
    return reply.code(201).send({ id, cadre: body.cadre, rosterSize: body.rosterSize });
  });

  app.get("/v1/hrms/reservation/rosters", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const rows = await scopedRead((tx) => tx.select().from(hrmsRosters)
      .where(eq(hrmsRosters.tenantId, ctx.tenantId)).orderBy(asc(hrmsRosters.cadre)));
    return reply.send({ data: rows });
  });

  app.get("/v1/hrms/reservation/rosters/:rid", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { rid } = ridParam.parse(req.params);
    return reply.send(await mustRoster(ctx.tenantId, rid));
  });

  app.post("/v1/hrms/reservation/rosters/:rid/vacancies", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { rid } = ridParam.parse(req.params);
    const body = z.object({
      filled: z.object({
        SC: z.coerce.number().int().min(0).default(0),
        ST: z.coerce.number().int().min(0).default(0),
        OBC: z.coerce.number().int().min(0).default(0),
        EWS: z.coerce.number().int().min(0).default(0),
        UR: z.coerce.number().int().min(0).default(0),
      }).optional(),
    }).parse(req.body ?? {});
    const r = await mustRoster(ctx.tenantId, rid);

    // If no explicit filled counts supplied, derive from materialised points.
    let filled: FilledByCategory;
    if (body.filled) {
      filled = body.filled;
    } else {
      const pts = await scopedRead((tx) => tx.select({ category: hrmsRosterPoints.category, filled: hrmsRosterPoints.filled })
        .from(hrmsRosterPoints)
        .where(and(eq(hrmsRosterPoints.tenantId, ctx.tenantId), eq(hrmsRosterPoints.rosterId, rid))));
      const f: FilledByCategory = { SC: 0, ST: 0, OBC: 0, EWS: 0, UR: 0 };
      for (const p of pts) if (p.filled && p.category in f) f[p.category as keyof FilledByCategory] += 1;
      filled = f;
    }
    const result = computeRoster(rosterToDef(r), filled);
    return reply.send({ rosterId: rid, cadre: r.cadre, ...result });
  });

  app.post("/v1/hrms/reservation/rosters/:rid/points", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { rid } = ridParam.parse(req.params);
    const r = await mustRoster(ctx.tenantId, rid);
    const points = generateRosterPoints({
      rosterSize: r.rosterSize, pctSc: Number(r.pctSc), pctSt: Number(r.pctSt),
      pctObc: Number(r.pctObc), pctEws: Number(r.pctEws),
    });
    // Idempotent: clear and re-materialise.
    await db.transaction(async (tx) => {
      await tx.delete(hrmsRosterPoints)
        .where(and(eq(hrmsRosterPoints.tenantId, ctx.tenantId), eq(hrmsRosterPoints.rosterId, rid)));
      for (const p of points) {
        await tx.insert(hrmsRosterPoints).values({
          id: randomUUID(), tenantId: ctx.tenantId, rosterId: rid,
          pointNo: p.point, category: p.category, filled: false,
        });
      }
    });
    return reply.send({ rosterId: rid, points: points.length, data: points });
  });

  app.get("/v1/hrms/reservation/rosters/:rid/points", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { rid } = ridParam.parse(req.params);
    await mustRoster(ctx.tenantId, rid);
    const rows = await scopedRead((tx) => tx.select().from(hrmsRosterPoints)
      .where(and(eq(hrmsRosterPoints.tenantId, ctx.tenantId), eq(hrmsRosterPoints.rosterId, rid)))
      .orderBy(asc(hrmsRosterPoints.pointNo)));
    return reply.send({ rosterId: rid, count: rows.length, data: rows });
  });

  // ===================== Sanctioned posts =====================
  app.post("/v1/hrms/sanctioned-posts", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const body = z.object({
      cadre: z.string().min(1).max(120),
      designationId: z.string().uuid().optional(),
      payLevel: z.string().max(24).optional(),
      sanctionedStrength: z.coerce.number().int().min(0),
      remarks: z.string().max(2000).optional(),
    }).parse(req.body);
    const id = randomUUID();
    await db.transaction((tx) => tx.insert(hrmsSanctionedPosts).values({
      id, tenantId: ctx.tenantId, cadre: body.cadre,
      sanctionedStrength: body.sanctionedStrength,
      ...(body.designationId ? { designationId: body.designationId } : {}),
      ...(body.payLevel ? { payLevel: body.payLevel } : {}),
      ...(body.remarks ? { remarks: body.remarks } : {}),
      createdBy: ctx.actorId, updatedBy: ctx.actorId,
    }));
    return reply.code(201).send({ id, cadre: body.cadre, sanctionedStrength: body.sanctionedStrength });
  });

  app.get("/v1/hrms/sanctioned-posts", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const rows = await scopedRead((tx) => tx.select().from(hrmsSanctionedPosts)
      .where(eq(hrmsSanctionedPosts.tenantId, ctx.tenantId)).orderBy(asc(hrmsSanctionedPosts.cadre)));
    const out = [];
    for (const r of rows) {
      const filled = await filledStrengthForCadre(ctx.tenantId, r.cadre);
      out.push({ ...r, filled, vacancy: Math.max(0, r.sanctionedStrength - filled) });
    }
    return reply.send({ data: out });
  });

  app.get("/v1/hrms/sanctioned-posts/:pid", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { pid } = pidParam.parse(req.params);
    const rows = await scopedRead((tx) => tx.select().from(hrmsSanctionedPosts)
      .where(and(eq(hrmsSanctionedPosts.tenantId, ctx.tenantId), eq(hrmsSanctionedPosts.id, pid))).limit(1));
    const r = rows[0];
    if (!r) throw new HttpError(404, "NOT_FOUND", "sanctioned post not found");
    const filled = await filledStrengthForCadre(ctx.tenantId, r.cadre);
    return reply.send({ ...r, filled, vacancy: Math.max(0, r.sanctionedStrength - filled) });
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

  async function mustRoster(tenantId: string, rid: string): Promise<RosterRow> {
    const rows = await scopedRead((tx) => tx.select().from(hrmsRosters)
      .where(and(eq(hrmsRosters.tenantId, tenantId), eq(hrmsRosters.id, rid))).limit(1));
    const r = rows[0];
    if (!r) throw new HttpError(404, "NOT_FOUND", "roster not found");
    return r;
  }
}
