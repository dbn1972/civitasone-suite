/**
 * PSU v1 slice C: cap-table register, dividend declaration -> payment, CSR note, and the PSU disclosures view. ADDITIVE routes under
 * /v1/finance/psu/... Every route sits behind ONE centralised preHandler (gate.ts): 404 PSU_NOT_ENABLED unless the STORED chart is
 * commercial AND the STORED govt_owned flag is set. There is no per-handler tenant check and nothing keys on edition / profile.
 * Dividend journals are accepted synchronously and posted asynchronously by the GL consumer via the outbox (same as sales).
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { zIsoDate } from "@civitasone/schemas/validators";
import { resolveContext, requireRole, HttpError, financeErrorHandler } from "../../shared/context.js";
import { db, scopedRead } from "../../shared/db.js";
import { currentFyIST } from "../../shared/ist-date.js";
import { DomainError } from "../approvals/domain.js";
import { postingDateWindow } from "../gl/validators.js";
import { COA_INCOMPLETE_CODE } from "../gl/commercial-chart.js";
import { commercialPresentation, loadCommercialRows } from "../financial-statements/commercial-statements-repo.js";
import { loadPsuConfig } from "./config.js";
import { psuTenantGate } from "./gate.js";
import { HOLDER_CATEGORIES, SHARE_CLASSES, DIVIDEND_TYPES } from "./schema.js";
import { capTableTx, createHoldingTx, csrForFyTx, declareDividendTx, dipamForFyTx, listDividendsTx, listHoldingsTx, payDividendTx, updateHoldingTx } from "./service.js";

const READER_ROLES = ["finance_officer", "finance_admin", "super_admin", "audit_officer"];
const MAKER_ROLES = ["finance_admin", "super_admin"];

const count = z.union([z.string().regex(/^\d+$/), z.number().int().nonnegative()]).transform((v) => BigInt(v)).refine((v) => v > 0n, "must be positive");
const idParam = z.object({ id: z.string().uuid() });
const fyQuery = z.object({ fy: z.string().regex(/^\d{4}-\d{2}$/, "fy must be a financial year such as 2026-27").optional() });

const holdingBody = z.object({
  holderName: z.string().trim().min(1).max(200), category: z.enum(HOLDER_CATEGORIES), shareClass: z.enum(SHARE_CLASSES).optional(),
  shares: count, faceValueMinor: count, folio: z.string().trim().min(1).max(32).optional(), remarks: z.string().trim().max(500).optional(),
});
const holdingPatch = holdingBody.partial().extend({ status: z.enum(["active", "retired"]).optional(), expectedVersion: z.number().int().positive().optional() });
const declareBody = z.object({
  dividendType: z.enum(DIVIDEND_TYPES), declaredOn: zIsoDate({ window: postingDateWindow, label: "declaration date" }),
  resolutionRef: z.string().trim().min(1).max(200), perShareMinor: count,
});
const payBody = z.object({ paidOn: zIsoDate({ window: postingDateWindow, label: "payment date" }) });

const serialise = (v: unknown): unknown => JSON.parse(JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x)));

const CONFLICT = new Set(["FOLIO_EXISTS", "DIVIDEND_EXISTS", "DIVIDEND_ALREADY_PAID", "HOLDING_VERSION_CONFLICT", "PSU_HEAD_COLLISION"]);
const toHttp = (err: unknown): never => {
  if (err instanceof DomainError) {
    const c = err.code;
    throw new HttpError(/_NOT_FOUND$/.test(c) ? 404 : CONFLICT.has(c) ? 409 : 422, c, err.message);
  }
  if ((err as { code?: string })?.code === COA_INCOMPLETE_CODE) throw new HttpError(422, COA_INCOMPLETE_CODE, (err as Error).message);
  throw err;
};

export async function psuRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", psuTenantGate);
  const run = async <T>(fn: () => Promise<T>): Promise<T> => { try { return await fn(); } catch (e) { return toHttp(e); } };

  // ---- shareholding register / cap table
  app.get("/v1/finance/psu/shareholdings", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, READER_ROLES);
    return reply.send({ data: serialise(await scopedRead((tx) => listHoldingsTx(tx, ctx.tenantId))) });
  });
  app.post("/v1/finance/psu/shareholdings", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, MAKER_ROLES);
    const body = holdingBody.parse(req.body);
    return reply.code(201).send({ data: serialise(await run(() => db.transaction((tx) => createHoldingTx(tx, ctx, body)))) });
  });
  app.put("/v1/finance/psu/shareholdings/:id", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, MAKER_ROLES);
    const { id } = idParam.parse(req.params);
    const body = holdingPatch.parse(req.body);
    return reply.send({ data: serialise(await run(() => db.transaction((tx) => updateHoldingTx(tx, ctx, id, body)))) });
  });
  app.get("/v1/finance/psu/cap-table", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, READER_ROLES);
    const fy = fyQuery.parse(req.query).fy ?? currentFyIST();
    return reply.send({ data: serialise(await run(() => scopedRead(async (tx) => {
      const rows = await loadCommercialRows(tx, ctx.tenantId, fy);
      return { fiscalYear: fy, ...(await capTableTx(tx, ctx.tenantId, rows, commercialPresentation(), true)) };
    }))) });
  });

  // ---- dividends
  app.get("/v1/finance/psu/dividends", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, READER_ROLES);
    const fy = fyQuery.parse(req.query).fy;
    return reply.send({ data: serialise(await scopedRead((tx) => listDividendsTx(tx, ctx.tenantId, fy))) });
  });
  app.post("/v1/finance/psu/dividends/declare", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, MAKER_ROLES);
    const body = declareBody.parse(req.body);
    return reply.code(202).send({ data: serialise(await run(() => db.transaction((tx) => declareDividendTx(tx, ctx, body)))) });
  });
  app.post("/v1/finance/psu/dividends/:id/pay", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, MAKER_ROLES);
    const { id } = idParam.parse(req.params);
    const { paidOn } = payBody.parse(req.body);
    return reply.code(202).send({ data: serialise(await run(() => db.transaction((tx) => payDividendTx(tx, ctx, id, paidOn)))) });
  });
  app.get("/v1/finance/psu/dividends/dipam-advisory", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, READER_ROLES);
    const fy = fyQuery.parse(req.query).fy ?? currentFyIST();
    const cfg = loadPsuConfig();
    return reply.send({ data: serialise({ fiscalYear: fy, mode: cfg.dipam.mode, advisory: cfg.dipam.mode === "advisory" ? await run(() => scopedRead((tx) => dipamForFyTx(tx, ctx.tenantId, fy, cfg))) : null }) });
  });

  // ---- CSR (s.135) note
  app.get("/v1/finance/psu/csr", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, READER_ROLES);
    const fy = fyQuery.parse(req.query).fy ?? currentFyIST();
    return reply.send({ data: serialise(await run(() => scopedRead((tx) => csrForFyTx(tx, ctx.tenantId, fy, commercialPresentation())))) });
  });

  app.setErrorHandler(financeErrorHandler);
}
