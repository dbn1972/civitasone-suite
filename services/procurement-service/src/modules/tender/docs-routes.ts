import { sendAccepted } from "@civitasone/schemas/validate";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import type { FastifyInstance } from "fastify";
import { resolveContext, requireRole } from "../../shared/context.js";
import * as commands from "./docs-commands.js";
import * as docsRepo from "./docs-repo.js";
import {
  addDocBody, createCorrigendumBody, republishCorrigendumBody,
  createPrebidQueryBody, answerPrebidQueryBody,
  tenderIdParam, corrigendumIdParam, queryIdParam,
} from "./docs-validators.js";

const WRITE_ROLES  = ["procurement_officer", "procurement_admin", "super_admin"];
const READER_ROLES = [...WRITE_ROLES, "audit_officer", "finance_officer", "vendor"];

function serBig(rows: Record<string, unknown>[]): Record<string, unknown>[] {
  return rows.map((r) => {
    const o = { ...r };
    if (o.sizeBytes !== undefined && o.sizeBytes !== null) o.sizeBytes = String(o.sizeBytes);
    return o;
  });
}

export async function tenderDocsRoutes(app: FastifyInstance): Promise<void> {
  // ── Documents ──────────────────────────────────────────────────
  app.post("/v1/procurement/tenders/:id/documents", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const { id } = tenderIdParam.parse(req.params);
    const body = addDocBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.addDocument(ctx, id, body));
  });

  app.get("/v1/procurement/tenders/:id/documents", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const { id } = tenderIdParam.parse(req.params);
    const rows = await docsRepo.listDocsByTender(id, ctx.tenantId);
    return reply.send({ data: serBig(rows as unknown as Record<string, unknown>[]) });
  });

  // ── Corrigenda ─────────────────────────────────────────────────
  app.post("/v1/procurement/tenders/:id/corrigenda", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const { id } = tenderIdParam.parse(req.params);
    const body = createCorrigendumBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.createCorrigendum(ctx, id, body));
  });

  app.patch("/v1/procurement/tenders/:id/corrigenda/:corrigendumId/republish", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const { id, corrigendumId } = corrigendumIdParam.parse(req.params);
    const body = republishCorrigendumBody.parse(req.body ?? {});
    return sendAccepted(reply, acceptedResponseSchema, await commands.republishCorrigendum(ctx, id, corrigendumId, body));
  });

  app.get("/v1/procurement/tenders/:id/corrigenda", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const { id } = tenderIdParam.parse(req.params);
    const rows = await docsRepo.listCorrigendaByTender(id, ctx.tenantId);
    return reply.send({ data: rows });
  });

  // ── Pre-bid queries ────────────────────────────────────────────
  app.post("/v1/procurement/tenders/:id/prebid-queries", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const { id } = tenderIdParam.parse(req.params);
    const body = createPrebidQueryBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.createPrebidQuery(ctx, id, body));
  });

  app.patch("/v1/procurement/tenders/:id/prebid-queries/:queryId/answer", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const { id, queryId } = queryIdParam.parse(req.params);
    const body = answerPrebidQueryBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.answerPrebidQuery(ctx, id, queryId, body));
  });

  app.patch("/v1/procurement/tenders/:id/prebid-queries/:queryId/publish", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const { id, queryId } = queryIdParam.parse(req.params);
    return sendAccepted(reply, acceptedResponseSchema, await commands.publishPrebidQuery(ctx, id, queryId));
  });

  app.get("/v1/procurement/tenders/:id/prebid-queries", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const { id } = tenderIdParam.parse(req.params);
    const rows = await docsRepo.listPrebidQueriesByTender(id, ctx.tenantId);
    return reply.send({ data: rows });
  });
}
