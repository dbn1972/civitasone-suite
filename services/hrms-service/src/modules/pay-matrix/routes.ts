import { randomUUID } from "node:crypto";
import { publishF3Write } from "../../shared/f3-publish.js";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { resolveContext, requireRole } from "../../shared/context.js";
import { db, scopedRead} from "../../shared/db.js";
import { hrmsDesignations, hrmsEmployees } from "../employee/schema.js";
import { hrmsServiceBookEntries } from "../service-book/schema.js";
import { eq, and } from "drizzle-orm";

/**
 * 7th CPC pay matrix — generated from the official cell-1 entry pay per level
 * using the statutory annual-increment rule: each subsequent cell = previous
 * x 1.03, rounded UP to the next Rs 100. Cell (index-point) counts per the
 * 7th CPC matrix. All values in paise (Rs x 100).
 */
const ENTRY_PAY_PAISE: Record<number, number> = {
  1: 1800000, 2: 1990000, 3: 2170000, 4: 2550000, 5: 2920000, 6: 3540000,
  7: 4490000, 8: 4760000, 9: 5310000, 10: 5610000, 11: 6770000, 12: 7880000,
  13: 12310000, 14: 14420000, 15: 18220000, 16: 20540000, 17: 22500000, 18: 25000000,
};
const CELL_COUNT: Record<number, number> = {
  1: 40, 2: 40, 3: 40, 4: 40, 5: 40, 6: 40, 7: 40, 8: 40, 9: 40, 10: 40,
  11: 40, 12: 40, 13: 19, 14: 18, 15: 13, 16: 9, 17: 1, 18: 1,
};
function buildPayMatrix(): Record<number, number[]> {
  const m: Record<number, number[]> = {};
  for (const lvlStr of Object.keys(ENTRY_PAY_PAISE)) {
    const lvl = Number(lvlStr);
    const n = CELL_COUNT[lvl] ?? 40;
    const cells: number[] = [];
    let cur = ENTRY_PAY_PAISE[lvl] ?? 0;
    for (let i = 0; i < n; i++) {
      cells.push(cur);
      cur = Math.ceil((cur * 1.03) / 10000) * 10000; // +3%, round up to next Rs 100
    }
    m[lvl] = cells;
  }
  return m;
}
const PAY_MATRIX: Record<number, number[]> = buildPayMatrix();

const READER_ROLES = ["hr_admin", "hr_officer", "super_admin", "payroll_admin", "finance_officer"];

export async function payMatrixRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/hrms/pay-matrix", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const q = z.object({ level: z.coerce.number().int().min(1).max(18).optional() }).parse(req.query);

    const designations = await scopedRead((tx) => tx.select().from(hrmsDesignations)
      .where(eq(hrmsDesignations.tenantId, ctx.tenantId)));

    const levels = q.level
      ? [q.level]
      : Object.keys(PAY_MATRIX).map(Number).sort((a, b) => a - b);

    const matrix = levels.map((level) => ({
      level,
      payGrade: `Level-${level}`,
      cells: (PAY_MATRIX[level] ?? []).map((basicMinor, idx) => ({
        cell: idx + 1,
        basicMinor: basicMinor.toString(),
        basicDisplay: `₹ ${(basicMinor / 100).toLocaleString("en-IN")}`,
      })),
      designations: designations.filter((d) => d.level === level).map((d) => ({ id: d.id, code: d.code, name: d.name })),
    }));

    return reply.send({ data: matrix, cpc: "7th", currency: "INR" });
  });

  app.get("/v1/hrms/pay-matrix/lookup", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const parsed = z.object({ level: z.coerce.number().int().min(1).max(18), cell: z.coerce.number().int().min(1).max(40).default(1) }).safeParse(req.query);
    if (!parsed.success) {
      return reply.code(400).send({ code: "VALIDATION_FAILED", message: "level is required (1-18); cell optional (1-40)" });
    }
    const q = parsed.data;
    const cells = PAY_MATRIX[q.level] ?? [];
    const basicMinor = cells[q.cell - 1] ?? cells[cells.length - 1] ?? 0;
    return reply.send({ level: q.level, cell: q.cell, basicMinor: basicMinor.toString(), basicDisplay: `Rs ${(basicMinor / 100).toLocaleString("en-IN")}` });
  });

  // 7th CPC annual increment run (statutory 1 July). Advances each active
  // employee one cell within their pay level and records it in the service book.
  // Level is derived from the employee's designation; basic from hrmsEmployees.basicMinor.
  const HR_WRITE_ROLES = ["hr_admin", "super_admin"];
  app.post("/v1/hrms/pay-matrix/annual-increment", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_WRITE_ROLES);
    const body = z.object({
      effectiveDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      dryRun: z.boolean().default(false),
    }).parse(req.body ?? {});
    const effectiveDate = body.effectiveDate ?? `${new Date().getFullYear()}-07-01`;

    const emps = await scopedRead((tx) => tx.select().from(hrmsEmployees).where(and(
      eq(hrmsEmployees.tenantId, ctx.tenantId),
      eq(hrmsEmployees.status, "confirmed"),
    )));

    // Idempotency guard: skip employees already incremented on this effectiveDate.
    const priorRows = await scopedRead((tx) => tx.select({ employeeId: hrmsServiceBookEntries.employeeId })
      .from(hrmsServiceBookEntries)
      .where(and(
        eq(hrmsServiceBookEntries.tenantId, ctx.tenantId),
        eq(hrmsServiceBookEntries.entryType, "increment"),
        eq(hrmsServiceBookEntries.effectiveDate, effectiveDate),
      )));
    const alreadyIncremented = new Set(priorRows.map((r) => r.employeeId));

    // Build designation → level map for this tenant.
    const designations = await scopedRead((tx) => tx.select({ id: hrmsDesignations.id, level: hrmsDesignations.level })
      .from(hrmsDesignations).where(eq(hrmsDesignations.tenantId, ctx.tenantId)));
    const designationLevelMap = new Map<string, number>(designations.map((d) => [d.id, d.level]));

    const results: Array<Record<string, unknown>> = [];
    let skipped = 0;

    for (const emp of emps) {
      if (alreadyIncremented.has(emp.id)) { skipped++; continue; }

      const level = designationLevelMap.get(emp.designationId) ?? 0;
      const cells = level > 0 ? (PAY_MATRIX[level] ?? []) : [];
      if (cells.length === 0) {
        results.push({ employeeId: emp.id, skipped: true, reason: "no valid pay level for designation" });
        continue;
      }

      const currentBasicN = Number(emp.basicMinor);
      // Find current cell: exact match preferred, then nearest-upper-bound for imported data.
      let currentIdx = cells.indexOf(currentBasicN);
      if (currentIdx < 0) currentIdx = cells.findIndex((c) => c >= currentBasicN);
      if (currentIdx < 0) currentIdx = cells.length - 1; // above matrix max — already at ceiling

      const nextIdx = Math.min(currentIdx + 1, cells.length - 1);
      const nextBasic = cells[nextIdx] ?? currentBasicN;

      if (!body.dryRun) {
        if (nextBasic !== currentBasicN) {
          await db.update(hrmsEmployees)
            .set({ basicMinor: BigInt(nextBasic), updatedBy: ctx.actorId, updatedAt: new Date() })
            .where(and(eq(hrmsEmployees.tenantId, ctx.tenantId), eq(hrmsEmployees.id, emp.id)));
        }
        await db.insert(hrmsServiceBookEntries).values({
          id: randomUUID(),
          tenantId: ctx.tenantId,
          employeeId: emp.id,
          entryType: "increment",
          effectiveDate,
          description: `Annual increment: Level ${level} Cell ${currentIdx + 1} → Cell ${nextIdx + 1}. Basic ₹${(currentBasicN / 100).toLocaleString("en-IN")} → ₹${(nextBasic / 100).toLocaleString("en-IN")}.`,
          recordedBy: ctx.actorId,
          attested: false,
        });
      }

      results.push({
        employeeId: emp.id,
        level,
        fromCell: currentIdx + 1,
        toCell: nextIdx + 1,
        fromMinor: currentBasicN.toString(),
        toMinor: nextBasic.toString(),
        fromDisplay: `₹${(currentBasicN / 100).toLocaleString("en-IN")}`,
        toDisplay: `₹${(nextBasic / 100).toLocaleString("en-IN")}`,
        incremented: nextBasic !== currentBasicN,
      });
    }

    await publishF3Write(ctx, "pay_matrix_routes__0", randomUUID(), { body: (req.body as Record<string, unknown>) ?? {}, params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> });
    const incremented = results.filter((r) => r.incremented === true).length;
    req.log.info({ event: "pay.annual_increment.run", effectiveDate, dryRun: body.dryRun, employeesScanned: emps.length, incremented, skipped, actorId: ctx.actorId, tenantId: ctx.tenantId }, "annual increment run");
    return reply.send({
      effectiveDate, dryRun: body.dryRun,
      employeesScanned: emps.length,
      incremented,
      skippedAlreadyIncremented: skipped,
      results,
    });
  });
}
