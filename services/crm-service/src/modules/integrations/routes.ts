/**
 * AC-004 — email/calendar linking (FRAMEWORK ONLY; live provider sync deferred).
 *   GET    /v1/crm/linked-accounts                — the tenant's linked mailboxes/calendars
 *   POST   /v1/crm/linked-accounts                 — connect (records intent, status=pending)
 *   DELETE /v1/crm/linked-accounts/:id             — disconnect
 *   POST   /v1/crm/synced-items                    — link an external email/meeting to a record
 *   GET    /v1/crm/synced-items?subjectType=&subjectId=  — items linked to a record
 */
import type { FastifyInstance } from "fastify";
import { ZodError, z } from "zod";
import { sql } from "drizzle-orm";
import { sendAccepted } from "@civitasone/schemas/validate";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { commandId } from "../../shared/idempotency.js";
import { scopedRead } from "../../shared/db.js";
import { COMMANDS } from "../../topics.js";
import * as commands from "./commands.js";
import { connectLinkedAccountBody, linkSyncedItemBody, idParam } from "./validators.js";

const CRM_ROLES = ["crm_user", "crm_admin", "super_admin"];

const syncedItemsQuery = z.object({
  subjectType: z.enum(["contact", "account", "deal"]),
  subjectId: z.string().uuid(),
});

export async function integrationRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/crm/linked-accounts", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ROLES);
    const rows = (await scopedRead((tx) => tx.execute(sql`
      SELECT id, user_id AS "userId", provider, external_email AS "externalEmail", status, scopes,
             connected_at AS "connectedAt", created_at AS "createdAt"
      FROM crm.linked_accounts WHERE tenant_id = ${ctx.tenantId}
      ORDER BY created_at DESC
    `))) as unknown as Array<Record<string, unknown>>;
    return reply.send({ data: rows, meta: { total: rows.length, liveSyncDeferred: true } });
  });

  app.post("/v1/crm/linked-accounts", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ROLES);
    const body = connectLinkedAccountBody.parse(req.body);
    const id = commandId(ctx, `${COMMANDS.connectLinkedAccount}:${ctx.actorId}:${body.provider}:${body.externalEmail}`);
    return sendAccepted(reply, acceptedResponseSchema, await commands.connectLinkedAccount(ctx, id, body));
  });

  app.delete("/v1/crm/linked-accounts/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ROLES);
    const { id } = idParam.parse(req.params);
    const found = (await scopedRead((tx) => tx.execute(sql`
      SELECT id FROM crm.linked_accounts WHERE id = ${id} AND tenant_id = ${ctx.tenantId}
    `))) as unknown as Array<{ id: string }>;
    if (found.length === 0) throw new HttpError(404, "NOT_FOUND", "linked account not found");
    return sendAccepted(reply, acceptedResponseSchema, await commands.disconnectLinkedAccount(ctx, id));
  });

  app.post("/v1/crm/synced-items", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ROLES);
    const body = linkSyncedItemBody.parse(req.body);
    // The linked account must exist in this tenant before we attach items to it.
    const la = (await scopedRead((tx) => tx.execute(sql`
      SELECT id FROM crm.linked_accounts WHERE id = ${body.linkedAccountId} AND tenant_id = ${ctx.tenantId}
    `))) as unknown as Array<{ id: string }>;
    if (la.length === 0) throw new HttpError(404, "NOT_FOUND", "linked account not found");
    const id = commandId(ctx, `${COMMANDS.linkSyncedItem}:${body.linkedAccountId}:${body.externalId}`);
    return sendAccepted(reply, acceptedResponseSchema, await commands.linkSyncedItem(ctx, id, body));
  });

  app.get("/v1/crm/synced-items", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ROLES);
    const q = syncedItemsQuery.parse(req.query);
    const rows = (await scopedRead((tx) => tx.execute(sql`
      SELECT id, linked_account_id AS "linkedAccountId", kind, external_id AS "externalId",
             subject_type AS "subjectType", subject_id AS "subjectId",
             occurred_at AS "occurredAt", created_at AS "createdAt"
      FROM crm.synced_items
      WHERE tenant_id = ${ctx.tenantId} AND subject_type = ${q.subjectType} AND subject_id = ${q.subjectId}
      ORDER BY occurred_at DESC
    `))) as unknown as Array<Record<string, unknown>>;
    return reply.send({ data: rows, meta: { total: rows.length } });
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
