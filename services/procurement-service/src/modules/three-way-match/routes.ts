import type { FastifyInstance } from "fastify";
import { ZodError, z } from "zod";
import { sendAccepted } from "@civitasone/schemas/validate";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import * as repo from "./repo.js";
import type { ThreeWayMatchRow } from "./schema.js";
import * as poRepo from "../po/repo.js";
import * as grnRepo from "../grn/repo.js";
import * as commands from "./commands.js";
import { randomUUID } from "node:crypto";

const PROC_ROLES = ["procurement_officer", "procurement_admin", "finance_admin", "super_admin"];

const createBody = z.object({
  poId: z.string().uuid(),
  grnId: z.string().uuid(),
  invoiceId: z.string().uuid().optional(),
  invoiceAmountMinor: z.number().int().nonnegative().optional(),
});

const invoiceAttachBody = z.object({
  matchId:       z.string().uuid(),
  invoiceRef:    z.string().min(1).max(128),
  invoiceDate:   z.string().optional(),
  invoiceAmount: z.number().nonnegative(),
  invoiceTax:    z.number().nonnegative().default(0),
  currency:      z.string().length(3).default("INR"),
});

function toApi(r: ThreeWayMatchRow): Record<string, unknown> {
  return {
    id: r.id,
    tenantId: r.tenantId,
    poId: r.poId,
    grnId: r.grnId,
    invoiceId: r.invoiceId,
    poAmountMinor: String(r.poAmountMinor),
    grnAmountMinor: String(r.grnAmountMinor),
    invoiceAmountMinor: r.invoiceAmountMinor != null ? String(r.invoiceAmountMinor) : null,
    matchStatus: r.matchStatus,
    variancePct: r.variancePct,
    autoMatched: r.autoMatched,
    createdAt: r.createdAt,
  };
}

export async function threeWayMatchRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/procurement/three-way-match", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, PROC_ROLES);
    const body = createBody.parse(req.body);
    const po = await poRepo.findPoById(body.poId, ctx.tenantId);
    if (!po) throw new HttpError(404, "NOT_FOUND", "PO not found");
    const grn = await grnRepo.findGrnById(body.grnId);
    if (!grn || grn.tenantId !== ctx.tenantId) throw new HttpError(404, "NOT_FOUND", "GRN not found");
    const grnPoId = grn.poRef.replace(/\^procurement_po:/, "");
    if (grnPoId !== body.poId) throw new HttpError(409, "GRN_PO_MISMATCH", "GRN does not belong to the supplied PO");
    return sendAccepted(reply, acceptedResponseSchema, await commands.runThreeWayMatch(ctx, body));
  });

  app.get("/v1/procurement/three-way-match", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, PROC_ROLES);
    const q = z.object({ poId: z.string().uuid().optional(), limit: z.coerce.number().int().min(1).max(200).default(50), offset: z.coerce.number().int().min(0).default(0) }).parse(req.query);
    const rows = await repo.listByTenant(ctx.tenantId, q.poId, q.limit, q.offset);
    return reply.send({ data: rows.map(toApi), total: rows.length });
  });

  app.post("/v1/procurement/matches/invoice", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, PROC_ROLES);
    const body = invoiceAttachBody.parse(req.body);
    const existingMatch = await repo.findMatchById(body.matchId, ctx.tenantId);
    if (!existingMatch) throw new HttpError(404, "NOT_FOUND", "three-way match record not found");
    const invoiceId = randomUUID();
    const invoiceAmountMinor = Math.round((body.invoiceAmount + body.invoiceTax) * 100);
    return sendAccepted(reply, acceptedResponseSchema, await commands.runThreeWayMatch(ctx, { poId: existingMatch.poId, grnId: existingMatch.grnId, invoiceId, invoiceAmountMinor }));
  });

  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) return reply.code(400).send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId, retryable: false });
    if (err instanceof HttpError) return reply.code(err.status).send({ code: err.code, message: err.message, correlationId, retryable: false });
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId, retryable: true });
  });
}
