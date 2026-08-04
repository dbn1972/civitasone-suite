/**
 * AC-003 — structured communication log.
 *   POST /v1/crm/communications                          — log a communication (202, CQRS)
 *   GET  /v1/crm/communications?subjectType=&subjectId=  — chronological (occurred_at desc)
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
import * as commands from "./commands.js";
import { createCommunicationBody, listCommunicationsQuery } from "./validators.js";

const CRM_ROLES = ["crm_user", "crm_admin", "super_admin"];

export async function communicationRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/crm/communications", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ROLES);
    const body = createCommunicationBody.parse(req.body);
    const id = commandId(ctx, `${COMMANDS.createCommunication}:${body.subjectId}`);
    return sendAccepted(reply, acceptedResponseSchema, await commands.createCommunication(ctx, id, body));
  });

  app.get("/v1/crm/communications", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ROLES);
    const q = listCommunicationsQuery.parse(req.query);
    const rows = await scopedRead((tx) => tx.execute(sql`
      SELECT id, subject_type AS "subjectType", subject_id AS "subjectId",
             direction, channel, outcome, disposition, summary,
             occurred_at AS "occurredAt", logged_by AS "loggedBy", created_at AS "createdAt"
      FROM crm.communications
      WHERE tenant_id = ${ctx.tenantId}
        AND subject_type = ${q.subjectType}
        AND subject_id = ${q.subjectId}
      ORDER BY occurred_at DESC, created_at DESC
      LIMIT ${q.limit} OFFSET ${q.offset}
    `)) as unknown as Array<Record<string, unknown>>;
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
