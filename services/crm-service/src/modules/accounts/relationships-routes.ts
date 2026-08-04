/**
 * CM-002 — account relationships / groups (beyond the single parent_id hierarchy).
 *   GET    /v1/crm/accounts/:id/relationships           — edges from this account (+ related name)
 *   POST   /v1/crm/accounts/:id/relationships            — create edge (202, CQRS)
 *   DELETE /v1/crm/accounts/:id/relationships/:relId     — remove edge (202, CQRS)
 */
import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { sql } from "drizzle-orm";
import { sendAccepted } from "@civitasone/schemas/validate";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { commandId } from "../../shared/idempotency.js";
import { scopedRead } from "../../shared/db.js";
import { COMMANDS } from "../../topics.js";
import * as commands from "./relationships-commands.js";
import { createRelationshipBody, accountIdParam, relIdParam } from "./relationships-validators.js";

const CRM_ROLES = ["crm_user", "crm_admin", "super_admin"];

async function accountExists(tenantId: string, id: string): Promise<boolean> {
  const rows = (await scopedRead((tx) => tx.execute(sql`
    SELECT id FROM crm.accounts WHERE id = ${id} AND tenant_id = ${tenantId}
  `))) as unknown as Array<{ id: string }>;
  return rows.length > 0;
}

export async function accountRelationshipRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/crm/accounts/:id/relationships", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ROLES);
    const { id } = accountIdParam.parse(req.params);
    const rows = (await scopedRead((tx) => tx.execute(sql`
      SELECT r.id, r.from_account_id AS "fromAccountId", r.to_account_id AS "toAccountId",
             r.rel_type AS "relType", r.created_at AS "createdAt",
             a.name AS "toAccountName"
      FROM crm.account_relationships r
      LEFT JOIN crm.accounts a ON a.id = r.to_account_id AND a.tenant_id = r.tenant_id
      WHERE r.tenant_id = ${ctx.tenantId} AND r.from_account_id = ${id}
      ORDER BY r.created_at DESC
    `))) as unknown as Array<Record<string, unknown>>;
    return reply.send({ data: rows, meta: { total: rows.length } });
  });

  app.post("/v1/crm/accounts/:id/relationships", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ROLES);
    const { id: fromAccountId } = accountIdParam.parse(req.params);
    const body = createRelationshipBody.parse(req.body);
    if (fromAccountId === body.toAccountId) throw new HttpError(400, "INVALID", "an account cannot relate to itself");
    // Both endpoints must live in this tenant — no cross-tenant edges.
    if (!(await accountExists(ctx.tenantId, fromAccountId))) throw new HttpError(404, "NOT_FOUND", "from account not found");
    if (!(await accountExists(ctx.tenantId, body.toAccountId))) throw new HttpError(404, "NOT_FOUND", "to account not found");
    const relId = commandId(ctx, `${COMMANDS.createAccountRelationship}:${fromAccountId}:${body.toAccountId}:${body.relType}`);
    return sendAccepted(reply, acceptedResponseSchema,
      await commands.createAccountRelationship(ctx, relId, { fromAccountId, toAccountId: body.toAccountId, relType: body.relType }));
  });

  app.delete("/v1/crm/accounts/:id/relationships/:relId", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ROLES);
    const { id: fromAccountId, relId } = relIdParam.parse(req.params);
    const found = (await scopedRead((tx) => tx.execute(sql`
      SELECT id FROM crm.account_relationships
      WHERE id = ${relId} AND from_account_id = ${fromAccountId} AND tenant_id = ${ctx.tenantId}
    `))) as unknown as Array<{ id: string }>;
    if (found.length === 0) throw new HttpError(404, "NOT_FOUND", "relationship not found");
    return sendAccepted(reply, acceptedResponseSchema,
      await commands.deleteAccountRelationship(ctx, relId, { fromAccountId }));
  });

  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) {
      return reply.code(400).send({
        code: "VALIDATION_FAILED", message: "invalid request", correlationId, retryable: false,
        fieldErrors: err.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
      });
    }
    if (err instanceof HttpError) {
      return reply.code(err.status).send({ code: err.code, message: err.message, correlationId, retryable: false });
    }
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId, retryable: true });
  });
}
