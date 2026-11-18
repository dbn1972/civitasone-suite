/**
 * MSME commercial M4: GSTR-1 / GSTR-3B PREPARE + JSON export for the tenant's own sales and purchases. Registered by app.ts behind the
 * ONE centralised commercial gate (shared/commercial-gate.ts -> 404 COMMERCIAL_NOT_ENABLED for a govt tenant). v1 prepares and
 * exports only; there is no live GSTN filing (v2). billing's gstn/ (platform SaaS returns) is not touched.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { resolveContext, requireRole, HttpError, financeErrorHandler } from "../../shared/context.js";
import { commercialTenantGate } from "../../shared/commercial-gate.js";
import { db, scopedRead } from "../../shared/db.js";
import { DomainError } from "../approvals/domain.js";
import { prepareRunTx, getRunTx, listRunsTx, getReturnSettingsTx, setFilingFrequencyTx } from "./service.js";

const READER_ROLES = ["finance_officer", "finance_admin", "super_admin", "audit_officer"];
const MAKER_ROLES = ["finance_officer", "finance_admin", "super_admin"];
const idParam = z.object({ id: z.string().uuid() });
const serialise = (v: unknown): unknown => JSON.parse(JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x)));

const toHttp = (err: unknown): never => {
  if (err instanceof DomainError) {
    const status = /_NOT_FOUND$/.test(err.code) ? 404 : /_NOT_ELIGIBLE$/.test(err.code) ? 422 : 422;
    throw new HttpError(status, err.code, err.message);
  }
  const msg = String((err as Error)?.message ?? "");
  if (/^GSTR_JSON_VERSION_UNSUPPORTED/.test(msg)) throw new HttpError(500, "GSTR_JSON_VERSION_UNSUPPORTED", msg);
  throw err;
};

export async function gstReturnRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", commercialTenantGate);
  const run = async <T>(fn: () => Promise<T>): Promise<T> => { try { return await fn(); } catch (e) { return toHttp(e); } };

  app.get("/v1/finance/gst-returns/settings", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, READER_ROLES);
    return reply.send({ data: serialise(await scopedRead((tx) => getReturnSettingsTx(tx, ctx.tenantId))) });
  });
  app.put("/v1/finance/gst-returns/settings", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, MAKER_ROLES);
    const body = z.object({ filingFrequency: z.enum(["monthly", "quarterly"]) }).parse(req.body);
    return reply.send({ data: serialise(await run(() => db.transaction((tx) => setFilingFrequencyTx(tx, ctx, body.filingFrequency)))) });
  });

  app.post("/v1/finance/gst-returns/runs", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, MAKER_ROLES);
    const body = z.object({ period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/), filedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }).parse(req.body);
    return reply.code(201).send({ data: serialise(await run(() => db.transaction((tx) => prepareRunTx(tx, ctx, body)))) });
  });
  app.get("/v1/finance/gst-returns/runs", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, READER_ROLES);
    return reply.send({ data: serialise(await scopedRead((tx) => listRunsTx(tx, ctx.tenantId))) });
  });
  app.get("/v1/finance/gst-returns/runs/:id", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, READER_ROLES);
    const { id } = idParam.parse(req.params);
    return reply.send({ data: serialise(await run(() => scopedRead((tx) => getRunTx(tx, ctx.tenantId, id)))) });
  });
  // JSON export of the stored snapshot in the pinned schema shape (re-exportable byte-for-byte).
  for (const which of ["gstr1", "gstr3b"] as const) {
    app.get(`/v1/finance/gst-returns/runs/:id/${which}.json`, async (req, reply) => {
      const ctx = resolveContext(req); requireRole(ctx, READER_ROLES);
      const { id } = idParam.parse(req.params);
      const r = await run(() => scopedRead((tx) => getRunTx(tx, ctx.tenantId, id)));
      const payload = which === "gstr1" ? r.gstr1 : r.gstr3b;
      if (!payload) throw new HttpError(404, "GSTR_EXPORT_NOT_AVAILABLE", `this ${r.kind} run has no ${which.toUpperCase()} payload`);
      return reply.header("content-disposition", `attachment; filename="${which}_${r.gstin}_${r.periodKey}_run${r.runNo}.json"`).header("x-gstr-json-version", r.schemaVersion).send(payload);
    });
  }

  app.setErrorHandler(financeErrorHandler);
}
