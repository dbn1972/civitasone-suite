/**
 * Section 8 NF-3: grants-in-aid routes. Every route answers 404 GRANTS_NOT_ENABLED unless fund_accounting is ON for the tenant
 * (a govt tenant sees no grants API at all). Postings are accepted asynchronously (202): the journal is published on
 * finance.gl.post and posted by the GL consumer through the NF-1 fund seam. Registered by app.ts; nothing turns the flag on before NF-8.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { idempotentId } from "@civitasone/auth";
import { zIsoDate } from "@civitasone/schemas/validators";
import { resolveContext, requireRole, HttpError, financeErrorHandler } from "../../shared/context.js";
import { db, scopedRead } from "../../shared/db.js";
import { DomainError } from "../approvals/domain.js";
import { postingDateWindow } from "../gl/validators.js";
import { GRANT_CATEGORIES, INTEREST_TREATMENTS, type GrantPostingKind } from "./schema.js";
import { CAPITAL_GRANT_POLICIES } from "./domain.js";
import {
  createGrantTx, getGrantTx, listGrantsTx, postGrantEventTx, recordUtilisationMetaTx, setCapitalGrantPolicyTx,
} from "./service.js";

const READER_ROLES = ["finance_officer", "finance_admin", "super_admin", "audit_officer"];
const MAKER_ROLES = ["finance_officer", "finance_admin", "super_admin"];
const ADMIN_ROLES = ["finance_admin", "super_admin"];

const minor = z.union([z.string().regex(/^\d+$/), z.number().int().positive()]).transform((v) => BigInt(v));
const createGrantBody = z.object({
  fundId: z.string().uuid(),
  category: z.enum(GRANT_CATEGORIES),
  grantor: z.string().trim().min(1).max(200),
  schemeCode: z.string().trim().max(64).optional(),
  sanctionRef: z.string().trim().min(1).max(128),
  sanctionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  amountSanctionedMinor: minor,
  currency: z.literal("INR").optional(),
});
const eventBody = z.object({
  amountMinor: minor,
  postingDate: zIsoDate({ window: postingDateWindow, label: "posting date" }),
  narration: z.string().trim().max(500).optional(),
  bankHeadCode: z.string().trim().min(1).max(32).optional(),
});
const utilisationBody = z.object({
  period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
  interestEarnedMinor: z.union([z.string().regex(/^\d+$/), z.number().int().nonnegative()]).transform((v) => BigInt(v)).optional(),
  interestTreatment: z.enum(INTEREST_TREATMENTS).nullable().optional(),
  ucForm: z.string().trim().max(64).nullable().optional(),
  ucSubmittedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
});
const policyBody = z.object({ policy: z.enum(CAPITAL_GRANT_POLICIES as [string, ...string[]]), reason: z.string().trim().min(1).max(500) });

const toHttp = (err: unknown): never => {
  if (err instanceof DomainError) throw new HttpError(err.code === "GRANTS_NOT_ENABLED" ? 404 : 422, err.code, err.message);
  throw err;
};
const serialise = (v: unknown): unknown => JSON.parse(JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x)));

export async function grantRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/finance/grants", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    try {
      return reply.send({ data: serialise(await scopedRead((tx) => listGrantsTx(tx, ctx.tenantId))) });
    } catch (err) { return toHttp(err); }
  });

  app.post("/v1/finance/grants", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const body = createGrantBody.parse(req.body);
    try {
      const row = await db.transaction((tx) => createGrantTx(tx, ctx, body));
      return reply.code(201).send({ data: serialise(row) });
    } catch (err) { return toHttp(err); }
  });

  app.put("/v1/finance/grants/policy", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const body = policyBody.parse(req.body);
    try {
      await db.transaction((tx) => setCapitalGrantPolicyTx(tx, ctx, body.policy as "deferred_income" | "capital_fund", body.reason));
      return reply.send({ data: { capitalGrantPolicy: body.policy } });
    } catch (err) { return toHttp(err); }
  });

  app.get("/v1/finance/grants/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    try {
      return reply.send({ data: serialise(await scopedRead((tx) => getGrantTx(tx, ctx.tenantId, id))) });
    } catch (err) {
      if (err instanceof DomainError && err.code === "GRANT_NOT_FOUND") throw new HttpError(404, "NOT_FOUND", err.message);
      return toHttp(err);
    }
  });

  const event = (path: string, kind: GrantPostingKind) =>
    app.post(path, { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } }, async (req, reply) => {
      const ctx = resolveContext(req);
      requireRole(ctx, MAKER_ROLES);
      const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
      const body = eventBody.parse(req.body);
      try {
        const out = await db.transaction((tx) => postGrantEventTx(tx, ctx, kind, { ...body, grantId: id, id: idempotentId(ctx) }));
        return reply.code(202).send({ id: out.postingId, journalId: out.journalId, status: "accepted", correlationId: ctx.correlationId });
      } catch (err) { return toHttp(err); }
    });
  event("/v1/finance/grants/:id/receipts", "receipt");
  event("/v1/finance/grants/:id/recognitions", "recognition");
  event("/v1/finance/grants/:id/capitalisations", "capitalisation");
  event("/v1/finance/grants/:id/releases", "release");

  app.put("/v1/finance/grants/:id/utilisation", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, MAKER_ROLES);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = utilisationBody.parse(req.body);
    try {
      return reply.send({ data: serialise(await db.transaction((tx) => recordUtilisationMetaTx(tx, ctx, { ...body, grantId: id }))) });
    } catch (err) { return toHttp(err); }
  });

  app.setErrorHandler(financeErrorHandler);
}
