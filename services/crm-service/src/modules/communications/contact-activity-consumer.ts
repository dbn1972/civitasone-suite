/**
 * BRD §9.4 — CRM↔Communication identifier mapping.
 *
 * The Communication Hub (notification-service) publishes one event per
 * per-recipient activity — a campaign response, a delivered message, or a
 * failed message — stamped with the CRM contact/lead/account id it was sent
 * against (`externalReferenceId`). Nothing in crm-service consumed it, so
 * Customer-360's communication/campaign panels could only show honest
 * `null·external` stubs.
 *
 * This consumer projects that event onto crm.contact_communications, a
 * tenant-owned read model. Once a row lands, the 360 route reads REAL counts
 * (delivered/failed messages, campaign responses/conversions/revenue) with
 * `source: 'crm'` instead of a cross-service stub.
 *
 * Idempotency has two layers so a redelivery can never double-count:
 *   1. markProcessed(msg.messageId) — the standard outbox/inbox guard.
 *   2. UNIQUE(tenant_id, dedupe_key) with ON CONFLICT DO NOTHING — dedupes the
 *      SAME person-level send even if the hub re-emits it under a fresh
 *      messageId. dedupe_key is the campaignRecipientId for responses and the
 *      messageId for message delivery/failure (see `dedupeKeyFor`).
 *
 * Poison-loop safety: a structurally bad payload is dropped (return, no throw);
 * only genuine transient DB errors propagate so the queue can retry them.
 *
 * Tenant/RLS: runs inside `db.transaction`; the worker wraps every consumer in
 * withTenantConsumer, so createTenantDb() sets the `app.tenant_id` GUC from the
 * message's tenant context and the FORCE-RLS insert is scoped automatically.
 */
import type { Queue, CommandEnvelope } from "@civitasone/queue";
import { pino } from "pino";
import { sql } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { markProcessed } from "../../shared/outbox.js";

const log = pino({ name: "crm-contact-activity-consumer" });

/** The Communication Hub's fixed contract (BRD §9.4). Must match the emitter. */
export const CONTACT_ACTIVITY_TOPIC = "notification.contact_activity.recorded";

type ActivityKind = "campaign_response" | "message_delivered" | "message_failed";
type ActivityStatus = "responded" | "converted" | "delivered" | "failed";
type SubjectType = "contact" | "lead" | "account";

interface ContactActivityPayload {
  tenantId?: string;
  correlationId?: string;
  externalReferenceId?: string;
  subjectType?: SubjectType;
  kind?: ActivityKind;
  campaignId?: string | null;
  campaignRecipientId?: string | null;
  messageId?: string | null;
  providerId?: string | null;
  status?: ActivityStatus;
  occurredAt?: string;
  revenueMinor?: string | null;
}

const KINDS: readonly ActivityKind[] = ["campaign_response", "message_delivered", "message_failed"];
const STATUSES: readonly ActivityStatus[] = ["responded", "converted", "delivered", "failed"];
const SUBJECT_TYPES: readonly SubjectType[] = ["contact", "lead", "account"];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The person-level dedupe key. campaignRecipientId identifies a unique campaign
 * send; messageId identifies a unique dispatched message. We fall back down the
 * chain (and finally to the envelope messageId) so the NOT NULL column always
 * has a stable value even when the hub omits the preferred identifier.
 */
function dedupeKeyFor(p: ContactActivityPayload, envelopeMessageId: string): string {
  if (p.kind === "campaign_response") {
    return p.campaignRecipientId ?? p.messageId ?? envelopeMessageId;
  }
  return p.messageId ?? p.campaignRecipientId ?? envelopeMessageId;
}

/** Non-negative integer paise string — no decimals, no sign (money is minor units). */
const NONNEG_INT_RE = /^\d+$/;

/** True when an optional field is absent (null/undefined/""), i.e. nothing to validate. */
function absent(v: string | null | undefined): boolean {
  return v === null || v === undefined || v === "";
}

/**
 * Reject anything we can't safely project. Returns null when the payload is bad.
 *
 * Beyond the required identity fields, the OPTIONAL columns that flow into typed
 * SQL casts are validated too: revenueMinor -> `::bigint`, campaignId /
 * campaignRecipientId -> uuid columns. A bad value here (e.g. "12.50" or a
 * non-uuid) would otherwise fail the Postgres cast, surface in the catch block
 * as if it were a transient error, and burn the full retry budget + a DLQ entry
 * on every redelivery of a permanently-bad field. Validating them up front keeps
 * the docstring's promise: structurally bad payloads are DROPPED, only genuine
 * transient DB errors propagate.
 */
function validate(p: ContactActivityPayload): Required<
  Pick<ContactActivityPayload, "subjectType" | "kind" | "status">
> & { externalReferenceId: string } | null {
  if (!p.externalReferenceId || !UUID_RE.test(p.externalReferenceId)) return null;
  if (!p.subjectType || !SUBJECT_TYPES.includes(p.subjectType)) return null;
  if (!p.kind || !KINDS.includes(p.kind)) return null;
  if (!p.status || !STATUSES.includes(p.status)) return null;
  // Optional-but-typed fields: valid only when absent OR well-formed.
  if (!absent(p.revenueMinor) && !NONNEG_INT_RE.test(p.revenueMinor as string)) return null;
  if (!absent(p.campaignId) && !UUID_RE.test(p.campaignId as string)) return null;
  if (!absent(p.campaignRecipientId) && !UUID_RE.test(p.campaignRecipientId as string)) return null;
  return {
    externalReferenceId: p.externalReferenceId,
    subjectType: p.subjectType,
    kind: p.kind,
    status: p.status,
  };
}

export function registerContactCommunicationConsumer(queue: Queue): void {
  queue.subscribe<ContactActivityPayload>(
    CONTACT_ACTIVITY_TOPIC,
    async (msg: CommandEnvelope<ContactActivityPayload>) => {
      const p = msg.payload ?? {};
      const v = validate(p);
      if (!v) {
        // Structurally unusable — nothing to project, not retryable. Dropping it
        // (rather than throwing) keeps the queue from a poison loop.
        log.warn({ messageId: msg.messageId }, "contact_activity.recorded: bad payload, dropped");
        return;
      }

      const dedupeKey = dedupeKeyFor(p, msg.messageId);
      const occurredAt = p.occurredAt ? new Date(p.occurredAt) : new Date();
      const revenueMinor =
        p.revenueMinor !== null && p.revenueMinor !== undefined && p.revenueMinor !== ""
          ? p.revenueMinor
          : null;

      try {
        await db.transaction(async (tx) => {
          if (!(await markProcessed(tx, msg.messageId))) return;

          await tx.execute(sql`
            INSERT INTO crm.contact_communications (
              tenant_id, subject_type, subject_id, kind,
              campaign_id, campaign_recipient_id, message_id, provider_id,
              status, revenue_minor, occurred_at, correlation_id, dedupe_key
            ) VALUES (
              ${msg.tenantId}, ${v.subjectType}, ${v.externalReferenceId}, ${v.kind},
              ${p.campaignId ?? null}, ${p.campaignRecipientId ?? null},
              ${p.messageId ?? null}, ${p.providerId ?? null},
              ${v.status}, ${revenueMinor}::bigint, ${occurredAt.toISOString()},
              ${p.correlationId ?? msg.correlationId ?? null}, ${dedupeKey}
            )
            ON CONFLICT (tenant_id, dedupe_key) DO NOTHING
          `);
        });
      } catch (err) {
        // A transient DB error should retry; rethrow so the queue redelivers.
        log.error({ err, messageId: msg.messageId }, "contact_activity.recorded projection failed");
        throw err;
      }

      // Invalidate the subject's cached 360/contact view so the new counts show.
      const resource = v.subjectType === "account" ? "account" : "contact";
      await cache.invalidate(cache.makeKey(msg.tenantId, resource, v.externalReferenceId));
      await cache.invalidateResource(msg.tenantId, resource);
    },
  );
}
