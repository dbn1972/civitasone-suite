/**
 * Consumer for LM-002 public web-form submissions — `crm.lead.public_capture`.
 *
 * This is the only place a submission from an ANONYMOUS caller becomes a row, and it is
 * what satisfies the acceptance criterion in full: "Submitted data creates or updates a
 * lead and records attribution."
 *
 * ── CREATE-OR-UPDATE, not create ────────────────────────────────────────────────
 * A prospect who filled in a form last quarter and comes back through a new campaign is
 * the SAME lead. Inserting a second row would split their history, double-count the
 * campaign, and (because `uq_contacts_tenant_email_idx` is a real unique index) actually
 * fail rather than duplicate. So the handler resolves an existing lead first:
 *
 *   1. by email blind index — the tenant's dedupe key (`blindIndex()` trims/lowercases,
 *      so "Jane@X.com " and "jane@x.com" are one prospect);
 *   2. failing that, by the deterministic contact id the route derived from the form key
 *      plus the normalised identity. That is what makes a PHONE-ONLY prospect converge:
 *      there is no blind index over phone, so step 1 cannot see them, but the id the
 *      route derives is stable across submissions.
 *
 * Only when neither resolves anything is a row inserted.
 *
 * ── What an update does and does NOT touch ──────────────────────────────────────
 * Attribution is always rewritten: the newest submission is the newest attribution, and
 * that is the whole point of the requirement. Identity fields are refreshed only when
 * the new submission actually supplies them, so a shorter second form cannot blank out
 * data the tenant already holds. `lead_status` is NEVER rewritten — an existing lead may
 * be 'qualified' and resetting it to 'new' would throw away sales work. Consent is only
 * ever turned ON: a later submission that did not ask for consent is not evidence that
 * consent was withdrawn, and DPDP withdrawal is its own (audited) action, not a
 * side effect of a web form.
 *
 * ── PII ─────────────────────────────────────────────────────────────────────────
 * The write goes through contacts/repo, so `email`/`phone` land as AES-256-GCM
 * ciphertext through `encryptedText()` and the email blind index is populated — exactly
 * like every other contact. Nothing here logs a submitted value; log lines carry ids.
 * NOTE: the service fails closed without `CRM_PII_KEY`, which on this path means the
 * message dead-letters and the 202 leaves no row.
 */
import type { Queue } from "@civitasone/queue";
import { pino } from "pino";
import type { RequestContext } from "@civitasone/types";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { markProcessed } from "../../shared/outbox.js";
import { emitWithAudit } from "../../shared/route-audit.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import * as contactRepo from "../contacts/repo.js";
import type { ContactInsert } from "../contacts/schema.js";

const log = pino({ name: "crm-public-lead-capture-consumer" });

/** Cache resource segment for contacts — the same one contacts/routes reads through. */
const RESOURCE = "contact";

export interface PublicLeadCaptureUtm {
  source?: string;
  medium?: string;
  campaign?: string;
  term?: string;
  content?: string;
}

export interface PublicLeadCapturePayload {
  /** Deterministic on (tenant, form, identity); used as the PK only when inserting. */
  contactId: string;
  formId: string;
  tenantId: string;
  name: string;
  email?: string;
  phone?: string;
  company?: string;
  city?: string;
  designation?: string;
  /** As submitted. `false` means consent was not given, never "unknown". */
  consent: boolean;
  /** Server-stamped at submission time by the route (YYYY-MM-DD, UTC). */
  consentDate: string;
  leadSource: string;
  utm: PublicLeadCaptureUtm;
  campaignId?: string;
}

function ctxOf(msg: { tenantId: string; actorId: string; correlationId: string }): RequestContext {
  return {
    tenantId: msg.tenantId,
    actorId: msg.actorId,
    correlationId: msg.correlationId,
  } as RequestContext;
}

/**
 * The attribution the requirement asks to be "recorded". Written identically on create
 * and on update so the two paths cannot drift — a create that recorded attribution while
 * an update quietly did not is exactly the bug the acceptance criterion is guarding.
 *
 * Every value is a bound parameter through Drizzle. Nothing here is string-concatenated
 * into SQL, which matters because `utm_*` arrives verbatim from an anonymous caller
 * (already length-capped at 128 by zod, matching the varchar(128) columns).
 */
function attributionOf(p: PublicLeadCapturePayload): Partial<ContactInsert> {
  return {
    leadSource: p.leadSource,
    captureFormId: p.formId,
    ...(p.campaignId !== undefined ? { campaignId: p.campaignId } : {}),
    ...(p.utm.source !== undefined ? { utmSource: p.utm.source } : {}),
    ...(p.utm.medium !== undefined ? { utmMedium: p.utm.medium } : {}),
    ...(p.utm.campaign !== undefined ? { utmCampaign: p.utm.campaign } : {}),
    ...(p.utm.term !== undefined ? { utmTerm: p.utm.term } : {}),
    ...(p.utm.content !== undefined ? { utmContent: p.utm.content } : {}),
    // Consent is only ever asserted, never revoked — see the file header. The date is the
    // server-stamped one from the route; there is no client-supplied consent date to
    // prefer, because the public validator has no such field.
    ...(p.consent ? { marketingConsent: true, consentDate: p.consentDate } : {}),
  };
}

/** Identity fields, but only the ones this submission actually supplied. */
function identityOf(p: PublicLeadCapturePayload): Partial<ContactInsert> {
  return {
    ...(p.email !== undefined ? { email: p.email } : {}),
    ...(p.phone !== undefined ? { phone: p.phone } : {}),
    ...(p.company !== undefined ? { company: p.company } : {}),
    ...(p.city !== undefined ? { city: p.city } : {}),
    ...(p.designation !== undefined ? { designation: p.designation } : {}),
  };
}

export function registerPublicLeadCaptureConsumer(queue: Queue): void {
  queue.subscribe<PublicLeadCapturePayload>(COMMANDS.publicLeadCapture, async (msg) => {
    const p = msg.payload;
    try {
      let outcome: "created" | "updated" = "created";
      let contactId = p.contactId;
      /** False when `markProcessed` short-circuited, so the log line says so rather
       *  than claiming a write that did not happen. */
      let applied = false;

      await db.transaction(async (tx) => {
        // Idempotency first, always: a redelivered submission must not bump the row
        // version or re-emit the capture event.
        if (!(await markProcessed(tx, msg.messageId))) return;
        applied = true;

        const byEmail = p.email !== undefined
          ? await contactRepo.findIdByEmail(tx, p.tenantId, p.email)
          : null;
        // Fall back to the deterministic id so a phone-only (or name-only-with-stable-id)
        // resubmission updates its own row instead of colliding on the primary key.
        const existingId = byEmail
          ?? ((await contactRepo.idExistsInTx(tx, p.tenantId, p.contactId)) ? p.contactId : null);

        if (existingId !== null) {
          outcome = "updated";
          contactId = existingId;
          await contactRepo.update(
            tx,
            existingId,
            p.tenantId,
            {
              // name is always present on a submission and is the one identity field a
              // prospect cannot omit, so a corrected spelling propagates.
              name: p.name,
              ...identityOf(p),
              ...attributionOf(p),
            },
            msg.actorId,
          );
        } else {
          await contactRepo.insert(tx, {
            id: p.contactId,
            tenantId: p.tenantId,
            name: p.name,
            ...identityOf(p),
            ...attributionOf(p),
            // A web-form lead starts at the top of the funnel. Only set on INSERT.
            leadStatus: "new",
            status: "active",
            createdBy: msg.actorId,
            updatedBy: msg.actorId,
            version: 1,
          });
        }

        await emitWithAudit(tx, ctxOf(msg), {
          eventType: EVENTS.publicLeadCaptured,
          action: outcome === "created" ? "public_lead_created" : "public_lead_updated",
          resourceType: RESOURCE,
          resourceId: contactId,
          // Attribution identifiers only — never the submitted name/email/phone. This
          // event fans out to analytics-service for campaign ROI, and a downstream
          // consumer has no lawful need for the prospect's contact details.
          payload: {
            contactId,
            formId: p.formId,
            outcome,
            leadSource: p.leadSource,
            consent: p.consent,
            utm: p.utm,
            ...(p.campaignId !== undefined ? { campaignId: p.campaignId } : {}),
          },
        });
      });

      await cache.invalidateResource(p.tenantId, RESOURCE);
      // Ids and the outcome only. No submitted value (no name/email/phone), no form key.
      log.info(
        {
          messageId: msg.messageId,
          tenantId: p.tenantId,
          formId: p.formId,
          contactId,
          outcome: applied ? outcome : "skipped",
        },
        "public lead capture processed",
      );
    } catch (err) {
      log.error({ err, messageId: msg.messageId, formId: p.formId }, "publicLeadCapture failed");
      throw err;
    }
  });
}
