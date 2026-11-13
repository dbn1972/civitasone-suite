/**
 * G6 (Section 8): bulk pay-profile request and decision, behind HRMS_S8_BULK_PAY_PROFILE_ENABLED (default OFF -> 404).
 *
 *  POST /v1/hrms/pay-profiles/bulk-request   up to 500 rows; ?dryRun=true reports row errors, queues nothing
 *  POST /v1/hrms/pay-profiles/bulk-decision  approve|reject up to 100 pending profiles, one note, per-row result
 *
 * Nothing here relaxes the single-row rules. Each row is checked by the SAME functions the single routes use
 * (assertAssignable / assertDecidable in routes.ts), so maker-checker is preserved: a bulk request only ever creates
 * PENDING profiles through the existing hrms.pay_profile.request command, and a bulk decision refuses a row the
 * caller requested themselves (SELF_APPROVAL_FORBIDDEN) exactly like the single approve/reject.
 *
 * New profile types are accepted BY DATA: a row's payProfile is validated against domain.PAY_PROFILES (the one list
 * the single route and the consumer also use), and a profile that needs extra per-row inputs (the CTC lane's annual
 * fixed CTC + template code) plugs them in through registerBulkProfileRule() without touching this file.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { and, eq, inArray } from "drizzle-orm";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { scopedRead } from "../../shared/db.js";
import { bulkPayProfileEnabled } from "../../shared/s8-flags.js";
import { zTrimmedCode } from "@civitasone/schemas/validators";
import { hrmsEmployees } from "../employee/schema.js";
import * as repo from "./repo.js";
import * as commands from "./commands.js";
import { PAY_PROFILES, isPayProfile, planApproval, type DeputationMoneyTerms } from "./domain.js";
import { assertAssignable, assertDecidable, loadLockedThrough, WRITE_ROLES } from "./routes.js";

export const BULK_REQUEST_MAX = 500;
export const BULK_DECISION_MAX = 100;

const minorString = z.string().regex(/^\d{1,15}$/, "amount in paise as a digit string");

export interface BulkRequestRow {
  employeeNo?: string | undefined;
  employeeId?: string | undefined;
  payProfile: string;
  effectiveFrom: string;
  deputationId?: string | undefined;
  consolidatedMonthlyMinor?: string | undefined;
  orderRef?: string | undefined;
  remarks?: string | undefined;
  /** Extra inputs for a profile type that registered a rule (e.g. CTC). Refused for a profile with no rule. */
  terms?: Record<string, unknown> | undefined;
}

/** Returns an error message, or null when the row's extra `terms` are acceptable for this profile. */
export type BulkProfileRule = (row: BulkRequestRow) => string | null;
const extraRules = new Map<string, BulkProfileRule>();

/** Plug in the extra per-row validation of a profile type (called once at module load by the lane that owns the type). */
export function registerBulkProfileRule(profile: string, rule: BulkProfileRule): void {
  extraRules.set(profile, rule);
}

const requestRow = z.object({
  employeeNo: zTrimmedCode(32, "employee number").optional(),
  employeeId: z.string().uuid().optional(),
  payProfile: z.string().min(1).max(64),
  effectiveFrom: z.string().regex(/^\d{4}-\d{2}-01$/, "must be the 1st of a month (YYYY-MM-01)"),
  deputationId: z.string().uuid().optional(),
  consolidatedMonthlyMinor: minorString.optional(),
  orderRef: z.string().max(120).optional(),
  remarks: z.string().max(2000).optional(),
  terms: z.record(z.unknown()).optional(),
}).refine((r) => !!r.employeeNo !== !!r.employeeId, { message: "give exactly one of employeeNo or employeeId", path: ["employeeNo"] });
const requestBody = z.object({ items: z.array(requestRow).min(1).max(BULK_REQUEST_MAX) });

const decisionBody = z.object({
  decision: z.enum(["approve", "reject"]),
  profileIds: z.array(z.string().uuid()).min(1).max(BULK_DECISION_MAX),
  note: z.string().max(500).optional(),
});

const isDryRun = (req: { query?: unknown }) => (req.query as { dryRun?: string } | undefined)?.dryRun === "true";

function codeOf(err: unknown): string {
  if (err instanceof HttpError) return err.code;
  throw err; // anything that is not a deliberate refusal is a real failure: surface it, never record it as a row error
}

export async function payProfileBulkRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/hrms/pay-profiles/bulk-request", async (req, reply) => {
    if (!bulkPayProfileEnabled()) throw new HttpError(404, "NOT_FOUND", "route not found");
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const { items } = requestBody.parse(req.body);
    const dryRun = isDryRun(req);
    const errors: Array<{ field: string; message: string }> = [];

    // employeeNo -> id, one tenant-scoped read.
    const nos = [...new Set(items.map((i) => i.employeeNo).filter((v): v is string => !!v))];
    const byNo = new Map<string, string>();
    if (nos.length > 0) {
      const rows = await scopedRead((tx) => tx.select({ id: hrmsEmployees.id, employeeNo: hrmsEmployees.employeeNo }).from(hrmsEmployees)
        .where(and(eq(hrmsEmployees.tenantId, ctx.tenantId), inArray(hrmsEmployees.employeeNo, nos))));
      for (const r of rows) byNo.set(r.employeeNo, r.id);
    }
    const locked = await loadLockedThrough(ctx.tenantId); // once, not 500 times
    const resolved: Array<{ row: BulkRequestRow; employeeId: string; terms: DeputationMoneyTerms | null }> = [];
    const seen = new Set<string>();

    for (const [idx, row] of items.entries()) {
      const at = (f: string) => `items.${idx}.${f}`;
      const employeeId = row.employeeId ?? (row.employeeNo ? byNo.get(row.employeeNo) : undefined);
      if (!employeeId) { errors.push({ field: at("employeeNo"), message: `Unknown employee: ${row.employeeNo ?? row.employeeId}` }); continue; }
      if (seen.has(employeeId)) { errors.push({ field: at("employeeNo"), message: "This employee appears twice in the file" }); continue; }
      seen.add(employeeId);
      if (!isPayProfile(row.payProfile)) {
        errors.push({ field: at("payProfile"), message: `Unknown pay profile '${row.payProfile}' (known: ${PAY_PROFILES.join(", ")})` });
        continue;
      }
      if (row.terms) {
        const rule = extraRules.get(row.payProfile);
        const msg = rule ? rule(row) : `terms are not supported for pay profile '${row.payProfile}'`;
        if (msg) { errors.push({ field: at("terms"), message: msg }); continue; }
      }
      try {
        const terms = await assertAssignable(ctx.tenantId, {
          employeeId, payProfile: row.payProfile, effectiveFrom: row.effectiveFrom,
          deputationId: row.deputationId ?? null,
          consolidatedMonthlyMinor: row.consolidatedMonthlyMinor != null ? BigInt(row.consolidatedMonthlyMinor) : null,
          lockedThroughOverride: locked,
        });
        const history = await repo.listByEmployee(ctx.tenantId, employeeId);
        if (history.some((r) => r.status === "pending")) {
          errors.push({ field: at("employeeNo"), message: "PROFILE_REQUEST_PENDING: this employee already has a pay profile change awaiting a decision" });
          continue;
        }
        const plan = planApproval({ id: "new", effectiveFrom: row.effectiveFrom }, history.filter((r) => r.status === "active"));
        if ("error" in plan) { errors.push({ field: at("effectiveFrom"), message: `${plan.error}: a new pay profile must start after the employee's current one` }); continue; }
        resolved.push({ row, employeeId, terms });
      } catch (err) {
        errors.push({ field: at("payProfile"), message: codeOf(err) });
      }
    }

    if (errors.length > 0) {
      return reply.code(400).send({ code: "VALIDATION_FAILED", message: "Bulk pay-profile request has errors", fieldErrors: errors, ...(dryRun ? { dryRun: true } : {}), correlationId: ctx.correlationId });
    }
    if (dryRun) return reply.code(200).send({ dryRun: true, ok: true, rowCount: items.length, correlationId: ctx.correlationId });

    // NOT atomic: each row is its own queued command. If the queue fails part-way the rows already accepted stay
    // accepted (they are PENDING requests, safe to leave or reject) and are returned so the caller can retry the rest.
    const accepted: Array<{ employeeId: string; profileId: string }> = [];
    for (const { row, employeeId, terms } of resolved) {
      let a;
      try { a = await commands.requestPayProfile(ctx, {
        employeeId, payProfile: row.payProfile, effectiveFrom: row.effectiveFrom,
        deputationId: row.deputationId ?? null, consolidatedMonthlyMinor: row.consolidatedMonthlyMinor ?? null,
        deputationTerms: terms, orderRef: row.orderRef ?? null, remarks: row.remarks ?? null,
      }); } catch (err) {
        if (err instanceof HttpError) throw err; // a deliberate refusal keeps its own status; only queue/publish failures are BULK_PARTIAL
        req.log.error({ err, accepted: accepted.length }, "bulk pay-profile request: queue failed part-way");
        return reply.code(503).send({
          code: "BULK_PARTIAL", message: "The queue failed part-way; the batch is not atomic. Rows listed in `accepted` were queued; retry the rest.",
          atomic: false, accepted, notQueued: resolved.length - accepted.length, correlationId: ctx.correlationId,
        });
      }
      accepted.push({ employeeId, profileId: a.id });
    }
    return reply.code(202).send({ status: "accepted", accepted: accepted.length, items: accepted, correlationId: ctx.correlationId });
  });

  app.post("/v1/hrms/pay-profiles/bulk-decision", async (req, reply) => {
    if (!bulkPayProfileEnabled()) throw new HttpError(404, "NOT_FOUND", "route not found");
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const body = decisionBody.parse(req.body);
    const dryRun = isDryRun(req);
    const ids = [...new Set(body.profileIds)];
    const locked = body.decision === "approve" ? await loadLockedThrough(ctx.tenantId) : undefined; // once, not per row
    const results: Array<{ profileId: string; outcome: "accepted" | "skipped"; code?: string }> = [];
    for (const profileId of ids) {
      try {
        await assertDecidable(ctx, profileId, body.decision, locked);
        if (!dryRun) await commands.decidePayProfile(ctx, profileId, body.decision, body.note ?? null);
        results.push({ profileId, outcome: "accepted" });
      } catch (err) {
        results.push({ profileId, outcome: "skipped", code: codeOf(err) });
      }
    }
    const acceptedCount = results.filter((r) => r.outcome === "accepted").length;
    return reply.code(dryRun ? 200 : 202).send({
      ...(dryRun ? { dryRun: true } : {}), decision: body.decision, accepted: acceptedCount, skipped: results.length - acceptedCount,
      results, correlationId: ctx.correlationId,
    });
  });
}
