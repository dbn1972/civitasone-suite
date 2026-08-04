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
 *   1. by email blind index, restricted to rows THIS path created — see the
 *      consent-forgery note below;
 *   2. failing that, by the deterministic contact id the route derived from the form key
 *      plus the normalised identity, restricted the same way. That is what makes a
 *      PHONE-ONLY prospect converge: there is no blind index over phone, so step 1
 *      cannot see them, but the id the route derives is stable across submissions.
 *
 * Only when neither resolves anything is a row inserted.
 *
 * ── The update target is NEVER an arbitrary contact (consent forgery) ────────────
 * The form key lives in the tenant's public web page, so it is public knowledge, and the
 * submitted email is entirely attacker-chosen. If the lookup matched ANY contact with
 * that address, a stranger holding the key plus a victim's email could rewrite the
 * victim's identity fields and all of their attribution — and because `attributionOf`
 * only ever ASSERTS consent, could stamp `marketing_consent = true` with a
 * server-generated date on someone who never consented or explicitly declined. That is
 * DPDP consent forgery, not deduplication.
 *
 * So both lookups go through `findCaptureFormLeadIdByEmail` /
 * `captureFormLeadIdExistsInTx`, which require `capture_form_id IS NOT NULL` AND
 * `status = 'active'`. Consent may only ever be asserted on a row this form path itself
 * created. When the address belongs to some other contact the submission is DROPPED (no
 * update, no insert, no event) — see `handleCollision` below for why.
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
import { z } from "zod";
import type { RequestContext } from "@civitasone/types";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { markProcessed } from "../../shared/outbox.js";
import { emitWithAudit } from "../../shared/route-audit.js";
import { allocateLeadNo } from "../../shared/numbering.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import * as contactRepo from "../contacts/repo.js";
import type { ContactInsert } from "../contacts/schema.js";

const log = pino({ name: "crm-public-lead-capture-consumer" });

/** Cache resource segment for contacts — the same one contacts/routes reads through. */
const RESOURCE = "contact";

/**
 * ── The QUEUE is a trust boundary, and on this topic doubly so ───────────────────
 *
 * Every other consumer in the service receives payloads that an AUTHENTICATED route
 * already zod-parsed. This one does not: the values here started life in an anonymous
 * web form. Casting `msg.payload` would mean the only validation between a stranger's
 * keystrokes and a DB write lived in a different process — one queue-driver change, one
 * replayed DLQ message, or one hand-crafted admin replay away from writing unvalidated
 * data.
 *
 * The caps are the DB column widths, deliberately. A value one byte too long for
 * `varchar(n)` raises Postgres 22001 INSIDE the write transaction, which rolls back
 * `markProcessed` too and turns a single bad message into an endless redelivery loop.
 * Catching it in the parser instead means the message dead-letters once, with nothing
 * partially written.
 */
const utmPayload = z
  .object({
    source: z.string().max(128).optional(),
    medium: z.string().max(128).optional(),
    campaign: z.string().max(128).optional(),
    term: z.string().max(128).optional(),
    content: z.string().max(128).optional(),
  })
  // Default `strip`, not `.strict()`: an unknown key must not dead-letter a message
  // during a rollout that adds one. Unknown keys are dropped and never reach the row.
  .default({});

export const publicLeadCapturePayloadSchema = z.object({
  /** Deterministic on (tenant, form, identity); used as the PK only when inserting. */
  contactId: z.string().uuid(),
  formId: z.string().uuid(),
  tenantId: z.string().uuid(),
  name: z.string().min(1).max(200),
  email: z.string().max(320).optional(),
  phone: z.string().max(32).optional(),
  company: z.string().max(200).optional(),
  city: z.string().max(100).optional(),
  designation: z.string().max(120).optional(),
  /** As submitted. `false` means consent was not given, never "unknown". */
  consent: z.boolean(),
  /** Server-stamped at submission time by the route (YYYY-MM-DD, UTC). */
  consentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  leadSource: z.string().min(1).max(64),
  utm: utmPayload,
  campaignId: z.string().uuid().optional(),
});

export type PublicLeadCapturePayload = z.infer<typeof publicLeadCapturePayloadSchema>;
export type PublicLeadCaptureUtm = PublicLeadCapturePayload["utm"];

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
    // captureFormId is deliberately NOT included here — it is set only on INSERT.
    // The system-field protection trigger (LM-006) prevents changing it once set,
    // and the business rule is that the FIRST form that created the lead is its
    // origin. Subsequent forms update attribution (UTM, campaign) but not origin.
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
  queue.subscribe<unknown>(COMMANDS.publicLeadCapture, async (msg) => {
    // Parse BEFORE anything else. On failure: log (ids only) and throw, so the message
    // dead-letters with nothing written, rather than a cast letting a malformed payload
    // reach `contactRepo` and fail halfway through the transaction.
    const parsed = publicLeadCapturePayloadSchema.safeParse(msg.payload);
    if (!parsed.success) {
      log.error(
        {
          messageId: msg.messageId,
          // Field paths and zod codes only. `issue.message` can quote the offending
          // value, and the offending value here is a prospect's PII.
          issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), code: i.code })),
        },
        "publicLeadCapture payload rejected at the queue boundary — dead-lettering",
      );
      throw new Error("publicLeadCapture payload failed validation");
    }
    const p: PublicLeadCapturePayload = parsed.data;
    try {
      let outcome: "created" | "updated" | "skipped_conflict" = "created";
      let contactId = p.contactId;
      /** False when `markProcessed` short-circuited, so the log line says so rather
       *  than claiming a write that did not happen. */
      let applied = false;

      await db.transaction(async (tx) => {
        // Idempotency first, always: a redelivered submission must not bump the row
        // version or re-emit the capture event.
        if (!(await markProcessed(tx, msg.messageId))) return;
        applied = true;

        // Form-originated + active ONLY. See the header: an anonymous caller must never
        // be able to steer this at a contact created by the authenticated UI, by bulk
        // import, or by deal conversion, nor resurrect a soft-deleted one.
        const byEmail = p.email !== undefined
          ? await contactRepo.findCaptureFormLeadIdByEmail(tx, p.tenantId, p.email)
          : null;
        // Fall back to the deterministic id so a phone-only (or name-only-with-stable-id)
        // resubmission updates its own row instead of colliding on the primary key. Same
        // form-origin + active guard: the id is derived from the (public) form key plus a
        // guessable identity, so it is no more trustworthy than the email.
        const existingId = byEmail
          ?? ((await contactRepo.captureFormLeadIdExistsInTx(tx, p.tenantId, p.contactId))
            ? p.contactId
            : null);

        /**
         * ── Collision with a contact the anonymous path may not touch ──────────────
         *
         * The address resolved nothing we are allowed to update, but SOME row in this
         * tenant already holds it (an authenticated-UI contact, an imported one, a
         * converted deal, or a soft-deleted lead). Three options, two of them wrong:
         *
         *   * UPDATE it — the consent-forgery vector this guard exists to close. A
         *     stranger with the public form key and a victim's address could rewrite
         *     their identity and assert DPDP marketing consent on their behalf.
         *   * INSERT anyway — aborts the transaction on `uq_contacts_tenant_email_idx`
         *     (or, for a phone-only prospect, on the primary key, since the id the route
         *     derives is deterministic). That rolls `markProcessed` back too, so the
         *     message redelivers forever and eventually dead-letters for a reason that
         *     looks like a DB fault rather than a policy decision.
         *   * DROP the submission. That is this branch.
         *
         * A GENUINE prospect whose address already exists as a CRM contact therefore
         * needs an AUTHENTICATED merge by someone in the tenant who can see both rows
         * and take responsibility for the consent record. There is no safe way for an
         * anonymous request to make that call, and silently updating the existing row is
         * exactly the consent-forgery vector. So: nothing written, NO domain event
         * emitted (a downstream consumer must not see a capture that did not happen),
         * and an INFO line carrying ids only — no address, no name, no form key.
         */
        // Both unique constraints an insert could trip are checked, because both can be
        // occupied by a row we are not allowed to update: the email index, and the primary
        // key (the deterministic contact id, which is what makes a phone-only prospect
        // converge — and which therefore also collides with its own soft-deleted row).
        const occupiedByIneligible = existingId === null && (
          (p.email !== undefined && await contactRepo.emailExistsInTx(tx, p.tenantId, p.email))
          || await contactRepo.idExistsInTx(tx, p.tenantId, p.contactId)
        );
        if (occupiedByIneligible) {
          outcome = "skipped_conflict";
          log.info(
            { messageId: msg.messageId, tenantId: p.tenantId, formId: p.formId },
            "public lead capture skipped — email belongs to a contact this path may not update; needs an authenticated merge",
          );
          return;
        }

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
          // LM-006: allocate gapless lead reference number inside the create transaction.
          const leadNo = await allocateLeadNo(tx, p.tenantId);
          await contactRepo.insert(tx, {
            id: p.contactId,
            tenantId: p.tenantId,
            name: p.name,
            ...identityOf(p),
            ...attributionOf(p),
            // captureFormId set only on INSERT — the trigger protects it from change.
            captureFormId: p.formId,
            // A web-form lead starts at the top of the funnel. Only set on INSERT.
            leadStatus: "new",
            status: "active",
            createdBy: msg.actorId,
            updatedBy: msg.actorId,
            version: 1,
            leadNo,
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
