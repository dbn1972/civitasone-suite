import type { Queue } from "@civitasone/queue";
import { pino } from "pino";
import { and, eq, desc, asc, sql, inArray, isNull, isNotNull, ne, or, gt, lt, gte, lte } from "drizzle-orm";
import { db, scopedRead } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS } from "../../topics.js";
import { hrmsEmployees } from "../employee/schema.js";
import { computePension, summariseNonQualifying, type PensionResult, type ServiceBookEvent } from "./engine.js";
import * as serviceBookRepo from "../service-book/repo.js";
import * as repo from "./repo.js";
const log = pino({ name: "hrms-f3-pension" });

/** Recursively convert bigint -> string for JSON. Mirrors the helper in pension/routes.ts. */
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
            // F3 codegen repair (same bug class as leave/f3-consumer.ts
            // `leave_policy_admin_routes__0`): the generator kept the
            // repo.insertPensionRecord(...) call but dropped the whole
            // "fetch employee + service book, then compute the pension"
            // preamble the route ran before it was stubbed down to
            // publishF3Write(...). `result`, `q`, `emp`, `recordId` and
            // `jsonSafe` were referenced but never defined, so this case threw
            // a ReferenceError on EVERY invocation. The route answers 200 with
            // the full computed breakup as soon as the message is queued, so a
            // `?persist=true` request reported success and returned a
            // `persistedRecordId` while nothing was ever written to
            // pension.hrms_pension_records.
            //
            // Everything below re-derives, from the queued payload, exactly
            // what pension/routes.ts computed before publishing. computePension
            // is a pure function over (employee row, service-book events, query
            // params), so recomputing here reproduces the same numbers the
            // caller was shown — no external calls, no non-determinism.
            const employeeId = String(params.id ?? "");

            // `query` (the Zod schema in pension/routes.ts) is module-private,
            // so its coercions/defaults are mirrored field-for-field here. The
            // HTTP layer already rejected anything that fails validation, so
            // only the coercion + .default(...) behaviour needs reproducing.
            const rawQuery = (p.query ?? {}) as Record<string, unknown>;
            const q = {
              retirementDate: String(rawQuery.retirementDate ?? ""),
              daRatePct: rawQuery.daRatePct !== undefined ? Number(rawQuery.daRatePct) : 50,
              commutePct: rawQuery.commutePct !== undefined ? Number(rawQuery.commutePct) : 40,
              ageNextBirthday: rawQuery.ageNextBirthday !== undefined ? Number(rawQuery.ageNextBirthday) : undefined,
              avgEmolumentsMinor: rawQuery.avgEmolumentsMinor !== undefined ? Number(rawQuery.avgEmolumentsMinor) : undefined,
            };

            const empRows = await scopedRead((rtx) => rtx.select().from(hrmsEmployees)
              .where(and(eq(hrmsEmployees.id, employeeId), eq(hrmsEmployees.tenantId, p.tenantId)))
              .limit(1));
            const emp = empRows[0];
            // The route already 404'd on a missing employee; if the row is gone
            // by the time this async write runs there is nothing to persist.
            if (!emp) return;

            const sbEntries = await serviceBookRepo.listServiceBookEntries(p.tenantId, employeeId);
            const sbEvents: ServiceBookEvent[] = sbEntries.map((e) => ({
              entryType: e.entryType,
              effectiveDate: e.effectiveDate,
              description: e.description,
            }));
            const nonQualifying = summariseNonQualifying(sbEvents);

            const input: Parameters<typeof computePension>[0] = {
              pensionScheme: emp.pensionScheme,
              dateOfJoining: emp.dateOfJoining,
              retirementDate: q.retirementDate,
              lastBasicMinor: emp.basicMinor,
              daRatePct: q.daRatePct,
              commutePct: q.commutePct,
              nonQualifyingDays: nonQualifying.totalDays,
            };
            if (emp.dateOfBirth) input.dateOfBirth = emp.dateOfBirth;
            if (q.ageNextBirthday !== undefined) input.ageNextBirthday = q.ageNextBirthday;
            if (q.avgEmolumentsMinor !== undefined) input.avgEmolumentsMinor = BigInt(q.avgEmolumentsMinor);

            const result: PensionResult = computePension(input);
            // The route only publishes when `persist && result.definedBenefit`;
            // re-assert the scheme guard so a non-GPF employee can never get a
            // defined-benefit record written by a replayed message.
            if (!result.definedBenefit) return;

            // NOTE: the route minted its own `recordId` (a separate randomUUID)
            // and returned it as `persistedRecordId`, but never forwarded it in
            // the payload — so that id is unrecoverable here and the row gets
            // the message-scoped id instead. Using `id` (rather than a fresh
            // randomUUID) at least keeps this write idempotent across redeliveries.
            const recordId = id;
            await repo.insertPensionRecord(tx, {
                      id: recordId!,
                      tenantId: p.tenantId,
                      employeeId,
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
