import { randomUUID } from "node:crypto";
import { publishF3Write } from "../../shared/f3-publish.js";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { resolveContext, requireRole } from "../../shared/context.js";
import { scopedRead } from "../../shared/db.js";
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

/** One employee's precomputed, exact increment decision — what the route
 * decided synchronously and what the async consumer must apply VERBATIM,
 * never recompute. See the long comment on the annual-increment route below. */
interface IncrementPlanItem {
  employeeId: string;
  level: number;
  fromCell: number;
  toCell: number;
  fromMinor: string;
  toMinor: string;
  description: string;
}

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
  //
  // F3-converted (fix/hrms-paymatrix-async-conversion): the route now only
  // READS and DECIDES — it never writes to Postgres itself. The actual write
  // happens later in pay-matrix/f3-consumer.ts's `pay_matrix_routes__0` case.
  //
  // This module has TWO prior, reverted attempts at this exact conversion
  // (see f3-consumer.ts's case and this file's git history), both of which
  // would have double-applied a 7th-CPC pay increment — a real,
  // hard-to-reverse payroll bug — because the consumer re-derived the pay
  // level/cell independently instead of being told the exact decision. This
  // attempt avoids that failure mode structurally:
  //   - The route computes the EXACT plan per employee synchronously — level,
  //     current cell, next cell, current basic, next basic — and publishes
  //     that plan verbatim. The consumer applies `toMinor` exactly as given;
  //     it never re-derives a level or re-walks the pay matrix.
  //   - That closes the FIRST double-application mode (consumer guessing
  //     independently), but not a SECOND one: the `alreadyIncremented`
  //     pre-check below is a synchronous read, not a transactional guarantee.
  //     Two genuinely concurrent requests for the same effectiveDate (e.g. an
  //     admin double-clicking "Run Annual Increment") can both read
  //     "not yet incremented" before either request's consumer has written,
  //     and both would then publish a plan proposing the identical advance
  //     for the same employee.
  //   - That second race is closed at the DB layer, not in application logic:
  //     migrations/0132_pay_matrix_increment_idempotency.sql adds a partial
  //     unique index on hrms_service_book_entries
  //     (tenant_id, employee_id, effective_date) WHERE entry_type='increment'.
  //     The consumer inserts the service-book row FIRST, conflict-checked
  //     against that index, and only applies the `basicMinor` update if its
  //     insert actually won the index — so whichever of two racing plans is
  //     processed first "wins" and the second is a safe no-op, no matter how
  //     the two requests or their queued messages interleave. A
  //     queue-message-id dedupe key (`markProcessed`) is also in place and
  //     protects the ordinary case of the SAME message being redelivered
  //     after a transient consumer failure — but it cannot protect against
  //     two independently-published messages, which is why the DB-layer
  //     constraint above is the one that actually carries this guarantee.
  //
  // Response shape: `dryRun: true` is a pure, synchronous preview (nothing is
  // published, nothing is written) and still replies 200 with the predicted
  // plan. A real run publishes the plan and replies 202 — the per-employee
  // `results[].incremented` in that response reflects what the route
  // DECIDED and QUEUED, not yet a confirmed durable write; poll GET
  // /v1/hrms/employees/:id or the service book to observe the applied state.
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

    // Idempotency PRE-CHECK (fast path only — the hard guarantee is the DB
    // constraint applied by the consumer; see the comment above).
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
    const plan: IncrementPlanItem[] = [];
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
      if (currentIdx < 0) {
        // floor-cell search (compatible with TS targets below ES2023)
        for (let i = cells.length - 1; i >= 0; i--) { if ((cells[i] as number) <= currentBasicN) { currentIdx = i; break; } }
      }
      if (currentIdx < 0) currentIdx = 0; // below entry pay — treat as cell 1

      const nextIdx = Math.min(currentIdx + 1, cells.length - 1);
      const nextBasic = cells[nextIdx] ?? currentBasicN;
      const willIncrement = nextBasic > currentBasicN;

      if (!body.dryRun) {
        // Exact plan, byte-identical to what results[] below reports — the
        // consumer applies these fromMinor/toMinor values verbatim.
        plan.push({
          employeeId: emp.id,
          level,
          fromCell: currentIdx + 1,
          toCell: nextIdx + 1,
          fromMinor: currentBasicN.toString(),
          toMinor: nextBasic.toString(),
          description: `Annual increment: Level ${level} Cell ${currentIdx + 1} → Cell ${nextIdx + 1}. Basic ₹${(currentBasicN / 100).toLocaleString("en-IN")} → ₹${(nextBasic / 100).toLocaleString("en-IN")}.`,
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
        incremented: willIncrement,
      });
    }

    const incremented = results.filter((r) => r.incremented === true).length;

    if (body.dryRun) {
      req.log.info({ event: "pay.annual_increment.preview", effectiveDate, dryRun: true, employeesScanned: emps.length, incremented, skipped, actorId: ctx.actorId, tenantId: ctx.tenantId }, "annual increment dry run");
      return reply.send({
        status: "preview",
        effectiveDate, dryRun: true,
        employeesScanned: emps.length,
        incremented,
        skippedAlreadyIncremented: skipped,
        results,
      });
    }

    const batchId = randomUUID();
    await publishF3Write(ctx, "pay_matrix_routes__0", batchId, {
      body: (req.body as Record<string, unknown>) ?? {},
      params: req.params as Record<string, unknown>,
      query: req.query as Record<string, unknown>,
      effectiveDate,
      plan,
    });
    req.log.info({ event: "pay.annual_increment.queued", effectiveDate, dryRun: false, employeesScanned: emps.length, incremented, skipped, actorId: ctx.actorId, tenantId: ctx.tenantId, batchId }, "annual increment run queued");
    return reply.code(202).send({
      status: "accepted",
      id: batchId,
      effectiveDate, dryRun: false,
      employeesScanned: emps.length,
      incremented,
      skippedAlreadyIncremented: skipped,
      results,
    });
  });
}
