/**
 * CO-001 — POST /v1/crm/communications/send and /bulk-send.
 *
 * Send triggers outbound messages through notification-service, gated on
 * marketing consent at the route level (early reject) and again at the
 * consumer level (late re-check before actual delivery).
 */
import type { FastifyInstance } from "fastify";
import { sql } from "drizzle-orm";
import { sendAccepted } from "@civitasone/schemas/validate";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { commandId } from "../../shared/idempotency.js";
import { scopedRead } from "../../shared/db.js";
import { COMMANDS } from "../../topics.js";
import * as sendCommands from "./send-commands.js";
import { sendCommunicationBody, bulkSendCommunicationBody } from "./send-validators.js";

const CRM_SEND_ROLES = ["crm_user", "crm_admin", "super_admin"];
const BULK_SEND_ROLES = ["crm_admin", "super_admin"];

interface ContactConsentRow {
  id: string;
  marketingConsent: boolean;
  status: string;
}

async function getContactConsent(tenantId: string, contactId: string): Promise<ContactConsentRow | null> {
  const rows = await scopedRead((tx) => tx.execute(sql`
    SELECT id, marketing_consent AS "marketingConsent", status
    FROM crm.contacts
    WHERE tenant_id = ${tenantId} AND id = ${contactId}
    LIMIT 1
  `)) as unknown as ContactConsentRow[];
  return rows[0] ?? null;
}

async function getContactsConsent(tenantId: string, contactIds: string[]): Promise<ContactConsentRow[]> {
  // postgres.js requires a typed array for ANY(...) — use IN clause with individual params instead
  if (contactIds.length === 0) return [];
  const placeholders = contactIds.map((_, i) => sql`${contactIds[i]}`);
  const inClause = sql.join(placeholders, sql`,`);
  const rows = await scopedRead((tx) => tx.execute(sql`
    SELECT id, marketing_consent AS "marketingConsent", status
    FROM crm.contacts
    WHERE tenant_id = ${tenantId}
      AND id IN (${inClause})
      AND status = 'active'
  `)) as unknown as ContactConsentRow[];
  return rows;
}

export async function sendRoutes(app: FastifyInstance): Promise<void> {
  // Single send
  app.post("/v1/crm/communications/send", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_SEND_ROLES);
    const body = sendCommunicationBody.parse(req.body);

    // Validate contact exists + is active
    const contact = await getContactConsent(ctx.tenantId, body.recipientContactId);
    if (!contact || contact.status !== "active") {
      throw new HttpError(404, "CONTACT_NOT_FOUND", "contact not found or inactive");
    }

    // Consent check
    if (!contact.marketingConsent) {
      throw new HttpError(422, "CONSENT_REQUIRED", "contact has not granted marketing consent");
    }

    const id = commandId(ctx, `${COMMANDS.sendCommunication}:${body.recipientContactId}:${body.templateId}`);
    return sendAccepted(reply, acceptedResponseSchema, await sendCommands.sendCommunication(ctx, id, body));
  });

  // Bulk send
  app.post("/v1/crm/communications/bulk-send", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, BULK_SEND_ROLES);
    const body = bulkSendCommunicationBody.parse(req.body);

    // Fetch consent for all contacts
    const contactRows = await getContactsConsent(ctx.tenantId, body.contactIds);
    const consentedIds = contactRows
      .filter((c) => c.marketingConsent)
      .map((c) => c.id);

    const excludedCount = body.contactIds.length - consentedIds.length;

    if (consentedIds.length === 0) {
      // All excluded — still 202 but with zero eligible
      return reply.code(202).send({
        id: commandId(ctx, `${COMMANDS.bulkSendCommunication}:bulk`),
        status: "accepted",
        correlationId: ctx.correlationId,
        eligible: 0,
        excluded: excludedCount,
      });
    }

    const id = commandId(ctx, `${COMMANDS.bulkSendCommunication}:${body.templateId}`);
    const result = await sendCommands.bulkSendCommunication(ctx, id, body, consentedIds);
    return reply.code(202).send({
      ...result,
      eligible: consentedIds.length,
      excluded: excludedCount,
    });
  });
}
