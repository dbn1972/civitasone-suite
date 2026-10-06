/**
 * F1-05 — Audited PII reveal.
 *
 * `POST /v1/crm/pii/reveal { resourceType, resourceId, field, reason }`.
 *
 * One field, one resource, one call (no bulk — rate-limit friendly). The caller
 * must hold a PII-read role for that resource type (onboarding uses the
 * stricter KYC-approver set). The clear value is read inside a transaction and
 * a `pii_reveal` audit event is emitted in that SAME transaction, so a reveal
 * either produces a value AND an audit record or neither. The audit payload
 * carries resourceType/resourceId/field/reason/actor only — never the value.
 *
 * Lives beside shared/pii-reveal.ts (the policy + role module) because it is
 * cross-module: one endpoint serves grievances, RTI, service-requests,
 * onboarding and contacts rather than each module re-implementing a reveal.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { sql } from "drizzle-orm";
import { resolveContext, requireRole, HttpError } from "./context.js";
import { scopedRead } from "./db.js";
import { emitWithAudit } from "./route-audit.js";
import { decryptPii } from "./pii-crypto.js";
import {
  revealRolesFor,
  REVEALABLE_FIELDS,
  type ResourceType,
} from "./pii-reveal.js";

const RESOURCE_TYPES = ["grievance", "rti", "service_request", "onboarding", "contact"] as const;

/** Table that holds each resource's clear PII, by resource type. */
const RESOURCE_TABLES: Record<ResourceType, string> = {
  grievance: "crm.grievances",
  rti: "crm.rti_requests",
  service_request: "crm.service_requests",
  onboarding: "crm.onboarding_cases",
  contact: "crm.contacts",
};

const revealBody = z.object({
  resourceType: z.enum(RESOURCE_TYPES),
  resourceId: z.string().uuid(),
  field: z.string().min(1).max(64),
  /** A substantive reason is required for the audit trail (DPDP accountability). */
  reason: z.string().trim().min(10).max(2000),
});

export async function piiRevealRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/crm/pii/reveal", async (req, reply) => {
    const ctx = resolveContext(req);
    const body = revealBody.parse(req.body);
    const resourceType = body.resourceType as ResourceType;

    // Authz: only this resource's PII-read roles may reveal. Fail closed (403).
    requireRole(ctx, revealRolesFor(resourceType));

    // The requested field must be one we allow revealing — never an arbitrary
    // column name from the client.
    const column = REVEALABLE_FIELDS[resourceType][body.field];
    if (!column) {
      throw new HttpError(422, "FIELD_NOT_REVEALABLE", `field '${body.field}' is not revealable for ${resourceType}`);
    }
    const table = RESOURCE_TABLES[resourceType];

    // Read the clear value and write the audit event in ONE transaction. The
    // column list is from a server-side allow-list, never user input.
    const value = await scopedRead(async (tx) => {
      const rows = (await tx.execute(sql`
        SELECT ${sql.raw(column)} AS value
        FROM ${sql.raw(table)}
        WHERE id = ${body.resourceId}::uuid AND tenant_id = ${ctx.tenantId}::uuid
      `)) as unknown as Array<{ value: string | null }>;

      if (rows.length === 0) {
        throw new HttpError(404, "NOT_FOUND", "resource not found");
      }

      await emitWithAudit(tx, ctx, {
        eventType: "crm.pii.revealed",
        action: "pii_reveal",
        resourceType,
        resourceId: body.resourceId,
        // No PII value in the payload — field name + reason only.
        payload: {
          resourceType,
          resourceId: body.resourceId,
          field: body.field,
          reason: body.reason,
        },
      });

      return rows[0]!.value;
    });

    // Contacts store email/phone as AES-GCM ciphertext at rest; the clear value
    // is produced here (decryptPii is a no-op on legacy plaintext). The other
    // resources store plaintext, so this leaves them unchanged.
    const clear = resourceType === "contact" && value !== null ? decryptPii(value) : value;

    return reply.send({ data: { resourceType, resourceId: body.resourceId, field: body.field, value: clear } });
  });
}
