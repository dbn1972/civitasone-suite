import type { Queue } from "@civitasone/queue";
import { pino } from "pino";
import { and, eq, desc, asc, sql, inArray, isNull, isNotNull, ne, or, gt, lt, gte, lte } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS } from "../../topics.js";
import { hrmsEmployees } from "../employee/schema.js";
import * as serviceBookRepo from "../service-book/repo.js";
import * as repo from "./repo.js";
const log = pino({ name: "hrms-f3-pension" });
export function registerF3_pension_Consumers(queue: Queue): void {
  queue.subscribe(COMMANDS.f3RouteWrite, async (msg) => {
    const p = msg.payload as Record<string, any>;
    const op = String(p.op ?? "");
    const ops = new Set([
      "pension_routes__0",
    ]);
    if (!ops.has(op)) return;
    const body = p.body ?? {};
    const params = p.params ?? {};
    const id = (p.id as string) || (params.id as string);
    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        switch (op) {
          case "pension_routes__0": {
            await repo.insertPensionRecord(tx, {
                      id: recordId!,
                      tenantId: p.tenantId,
                      employeeId: id,
                      pensionScheme: result.pensionScheme,
                      retirementDate: q.retirementDate,
                      dateOfJoining: emp.dateOfJoining,
                      lastBasicMinor: emp.basicMinor,
                      daRatePct: String(q.daRatePct),
                      avgEmolumentsMinor: result.avgEmolumentsMinor,
                      qualifyingHalfYears: result.qualifying.halfYears,
                      qualifyingYears: String(result.qualifying.years),
                      monthlyPensionMinor: result.monthlyPensionMinor,
                      commutedPct: String(result.commutation.commutePct),
                      commutedValueMinor: result.commutation.commutedValueMinor,
                      residualPensionMinor: result.commutation.residualMonthlyPensionMinor,
                      dcrgMinor: result.dcrg.payableMinor,
                      familyPensionNormalMinor: result.familyPension.normalMinor,
                      familyPensionEnhancedMinor: result.familyPension.enhancedMinor,
                      breakdown: jsonSafe(result) as Record<string, unknown>,
                      createdBy: msg.actorId,
                      updatedBy: msg.actorId,
                    });
            break;
          }
        }
      });
    } catch (err) {
      log.error({ err, op, messageId: msg.messageId }, "f3RouteWrite failed");
      throw err;
    }
  });
}
