/**
 * UAT T-PERIOD year-end endpoints:
 *  GET  /v1/finance/budgets/lapse-statement?fy=   the 31 March lapse statement (live, or as recorded at year end)
 *  GET  /v1/finance/year-end/:fy                  status of the year-end close for a financial year
 *  POST /v1/finance/year-end/:fy/close            run (or re-run, idempotent) the year-end close -- finance_admin
 *  GET  /v1/finance/ledger/balances?headId=&fy=   per-month opening / debit / credit / closing of one head
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { resolveContext, requireRole, HttpError, financeErrorHandler } from "../../shared/context.js";
import { scopedRead } from "../../shared/db.js";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import { currentFyIST, nextFy } from "../../shared/ist-date.js";
import { fetchUserSummaries, actorName } from "../../shared/identity-client.js";
import { DomainError } from "../masters/domain.js";
import { lapseTotals } from "./domain.js";
import * as repo from "./repo.js";

const READER_ROLES = ["finance_officer", "finance_admin", "super_admin", "audit_officer"];
const ADMIN_ROLES = ["finance_admin", "super_admin"];
const FY_RE = /^\d{4}-\d{2}$/;
const fyField = z.string().regex(FY_RE, "fy must be a financial year such as 2026-27");
const s = (v: bigint) => v.toString();

export async function yearEndRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/finance/budgets/lapse-statement", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const { fy } = z.object({ fy: fyField.optional() }).parse(req.query);
    const year = fy ?? currentFyIST();
    const { rows, recorded } = await scopedRead(async (tx) => ({
      rows: await repo.lapseRowsForFy(tx, ctx.tenantId, year),
      recorded: await repo.lapseRecorded(tx, ctx.tenantId, year),
    }));
    const names = recorded ? await fetchUserSummaries(ctx.tenantId) : null;
    const t = lapseTotals(rows);
    return reply.send({
      fiscalYear: year,
      recorded: recorded ? { ...recorded, recordedByName: names ? actorName(names, recorded.recordedBy) : null } : null,
      rows: rows.map((r) => ({
        headId: r.headId, headCode: r.headCode, headName: r.headName,
        beMinor: s(r.beMinor), reMinor: s(r.reMinor), reappropriationNetMinor: s(r.reappropriationNetMinor),
        expenditureMinor: s(r.expenditureMinor), lapseMinor: s(r.lapseMinor), excessMinor: s(r.excessMinor),
      })),
      totals: { beMinor: s(t.beMinor), reMinor: s(t.reMinor), expenditureMinor: s(t.expenditureMinor), lapseMinor: s(t.lapseMinor), excessMinor: s(t.excessMinor) },
    });
  });

  app.get("/v1/finance/year-end/:fy", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const { fy } = z.object({ fy: fyField }).parse(req.params);
    const run = await scopedRead((tx) => repo.yearEndRun(tx, ctx.tenantId, fy));
    return reply.send({
      fiscalYear: fy, nextFiscalYear: nextFy(fy), status: run ? "done" : "not_run",
      runAt: run?.runAt ?? null, runBy: run?.runBy ?? null, runCount: run?.runCount ?? 0,
      openingBalanceCount: run?.openingBalanceCount ?? 0, lapseTotalMinor: run?.lapseTotalMinor ?? "0", fundCarriedMinor: run?.fundCarriedMinor ?? "0",
    });
  });

  app.post("/v1/finance/year-end/:fy/close", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { fy } = z.object({ fy: fyField }).parse(req.params);
    const { reason } = z.object({ reason: z.string().trim().min(10, "Reason must be at least 10 characters").max(500) }).parse(req.body ?? {});
    try {
      await scopedRead((tx) => repo.checkYearEndClose(tx, ctx.tenantId, fy));
    } catch (err) {
      if (err instanceof DomainError) throw new HttpError(err.code === "NOT_FOUND" ? 404 : 409, err.code, err.message.replace(/^\[[A-Z_]+\]\s*/, ""));
      throw err;
    }
    const id = randomUUID();
    await queue.publish(COMMANDS.yearEndClose, {
      messageId: id, type: COMMANDS.yearEndClose,
      tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
      payload: { id, tenantId: ctx.tenantId, fy, reason },
    });
    return reply.code(202).send({ id, status: "accepted", correlationId: ctx.correlationId, fiscalYear: fy, nextFiscalYear: nextFy(fy) });
  });

  app.get("/v1/finance/ledger/balances", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const q = z.object({ headId: z.string().trim().min(1).max(64), fy: fyField.optional() }).parse(req.query);
    const fy = q.fy ?? currentFyIST();
    const out = await scopedRead(async (tx) => {
      const dir = await repo.headDirectory(tx, ctx.tenantId);
      const head = dir.get(q.headId) ?? [...dir.values()].find((h) => h.id === q.headId);
      if (!head) return null;
      return repo.headMonthlyBalances(tx, ctx.tenantId, head, fy);
    });
    if (!out) throw new HttpError(404, "NOT_FOUND", "head not found in the chart of accounts");
    return reply.send({
      fiscalYear: fy, head: out.head, openingSource: out.openingSource,
      openingMinor: s(out.openingMinor), closingMinor: s(out.closingMinor),
      periods: out.periods.map((p) => ({ period: p.period, openingMinor: s(p.openingMinor), debitMinor: s(p.debitMinor), creditMinor: s(p.creditMinor), closingMinor: s(p.closingMinor) })),
    });
  });

  app.setErrorHandler(financeErrorHandler);
}
