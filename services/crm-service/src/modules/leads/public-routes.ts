/**
 * ██ PUBLIC, UNAUTHENTICATED ROUTE — LM-002 lead capture from web forms ██
 *
 *   POST /v1/crm/public/leads/:formKey
 *
 * This is the ONLY unauthenticated write in crm-service. It lives in its own file, and
 * this file contains nothing else, so a reviewer can see the entire anonymous surface
 * of the service in one place. Do not add an authenticated route here, and do not add a
 * route here without reading the threat model below.
 *
 * ── How the auth bypass works ───────────────────────────────────────────────────
 * `@civitasone/auth`'s `authPlugin` registers a single `onRequest` hook that demands a
 * Bearer token for every path except `/health`, `/ready`, `/metrics` — UNLESS the route
 * declares `config: { public: true }`, in which case the hook installs an anonymous
 * `req.ctx` (`actorId: "anonymous"`, `roles: []`, `tenantId: ""`) and returns without
 * verifying anything. That is the repo-wide mechanism (telephony webhooks, citizen
 * certificate verification, careers apply, metadata public form submissions all use
 * it), so it is what this route uses. NOTE: catalogue-service's `public-routes.ts` is
 * NOT this pattern — "public" there means "public-facing", and it still requires a JWT.
 *
 * Because `req.ctx.tenantId` is `""` on this path, `resolveContext`/`requireRole` are
 * never called here and the tenant comes from the form key alone.
 *
 * ════════════════════════════════════════════════════════════════════════════════
 * THREAT MODEL
 * ════════════════════════════════════════════════════════════════════════════════
 *
 * 1. CROSS-TENANT WRITE. The tenant is derived SOLELY from the 64-hex form key, by
 *    lookup against a globally unique index. The body is `.strict()`, so a body
 *    carrying `tenantId` is a 400 rather than an override, and no header is consulted.
 *    The resolved tenant is then what scopes the command envelope and the consumer's
 *    RLS-enforced write. Tenant A's key cannot reach tenant B's rows.
 *
 * 2. ENUMERATION — and the decision this route makes about it.
 *
 *    THE DECISION: every FORM-RESOLUTION outcome answers one identical, neutral 404
 *    (`{ code: "NOT_FOUND", message: "form not found" }`). That covers a key that
 *    never existed, a malformed key, a disabled form, and a key belonging to another
 *    tenant — which is the same case, since the key IS the tenant resolver, so there
 *    is no code path that could distinguish "not yours" from "not there". A scanner
 *    therefore learns nothing about which keys or tenants exist. 404 rather than a
 *    blanket 202 because a tenant's own web developer has to be able to tell a
 *    mistyped embed URL from a working one, and a 202 for an unknown key would make
 *    a broken form indistinguishable from a working one for the operator too.
 *
 *    Timing shape: unknown key and disabled form both perform exactly ONE indexed
 *    lookup that then lands in the same branch, so they are indistinguishable by
 *    latency as well as by body. (A malformed key short-circuits before the query —
 *    that reveals only that the caller got the FORMAT wrong, which they can already
 *    tell from the 64-hex shape of any key they have seen, and never whether a key
 *    exists.)
 *
 *    The consent (422) and origin (403) refusals below are deliberately distinct.
 *    They are only reachable by a caller who ALREADY holds a valid key, so they leak
 *    nothing about existence, and collapsing them into the 404 would leave a tenant's
 *    integrator with no way to tell "wrong URL" from "you forgot the consent
 *    checkbox". The key itself is 256 bits of crypto randomness and cannot be guessed.
 *
 * 3. SPAM / OPEN RELAY. TWO fixed-window limits run before any write: per (form,
 *    client IP), bounded by the form's `max_per_minute` (DB CHECK 1..600), and a
 *    per-TENANT ceiling that a distributed flood cannot dodge by rotating IPs. The
 *    per-IP budget is charged first so one abusive host cannot burn the tenant's
 *    shared budget and deny capture for everyone — see public-capture-rate-limit.ts,
 *    which also explains why the limiter FAILS CLOSED and how the client IP is
 *    derived from `x-forwarded-for` without letting a caller spoof it. Nothing here
 *    sends mail or makes an outbound call, so a submission cannot be turned into a
 *    relay.
 *
 * 4. BOTS. An unadvertised honeypot field (`_hp`) is answered with the normal 202 and
 *    silently dropped. A distinct rejection would just teach the bot to omit the field.
 *
 * 5. REFLECTION / ORACLES. The 202 body is `{ status, correlationId }` and nothing
 *    else: no contact id, no tenant id, no echo of submitted values. So the endpoint
 *    cannot be used to confirm what was stored, to enumerate ids, or to test whether
 *    an address is already a lead in some tenant.
 *
 * 6. CONSENT (DPDP Act 2023). When the form requires consent, a submission without
 *    explicit `consent: true` is refused 422. Consent is never defaulted to true, and
 *    `consent_date` is stamped SERVER-SIDE — a client-supplied consent date is not
 *    evidence of anything.
 *
 * 7. RESOURCE EXHAUSTION. 16 KiB body cap enforced by Fastify before the payload is
 *    buffered (413), every string length-capped by zod, and no unbounded collections.
 *
 * 8. PII. `email`/`phone` are written by the consumer through `encryptedText()`
 *    (AES-256-GCM). Nothing on this path logs a submitted value; log lines carry the
 *    form id and the correlation id only. The form KEY is also never logged — it is a
 *    bearer secret in a URL.
 *
 * 9. CQRS. The route performs exactly one read (the key lookup) and one publish. It
 *    never writes to Postgres; public-capture-consumer.ts does that.
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { RequestContext } from "@civitasone/types";
import { HttpError } from "../../shared/context.js";
import { commandId } from "../../shared/idempotency.js";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import * as repo from "./capture-forms-repo.js";
import type { ResolvedCaptureForm } from "./capture-forms-schema.js";
import { checkCaptureRateLimit, resolveClientIp } from "./public-capture-rate-limit.js";
import {
  publicLeadBody,
  publicAcceptedSchema,
  FORM_KEY_PATTERN,
  MAX_PUBLIC_BODY_BYTES,
  type PublicLeadBody,
} from "./capture-forms-validators.js";

/** Fallback lead_source when neither the submission nor the form declares one. */
export const DEFAULT_PUBLIC_LEAD_SOURCE = "public_form";

/**
 * ONE error for every resolution failure: no such key, malformed key, disabled form.
 * Same status, same code, same message, every time — see threat model §2.
 */
function notFound(): never {
  throw new HttpError(404, "NOT_FOUND", "form not found");
}

const formKeyParam = z.object({ formKey: z.string().min(1).max(64) });

/**
 * Normalise the submitted identity into the string the deterministic ids are derived
 * from. Email wins over phone because email is what `crm.contacts` actually dedupes on
 * (the partial unique index over `(tenant_id, email_idx)`), and the normalisation here
 * — trim + lowercase — is deliberately the SAME normalisation `blindIndex()` applies,
 * so the id the route derives and the row the consumer converges on agree.
 *
 * Returns null when the submission carries neither: a name-only lead has no identity to
 * dedupe on, so each such submission is a fresh row rather than all of them colliding
 * into one.
 */
export function submissionIdentity(body: Pick<PublicLeadBody, "email" | "phone">): string | null {
  if (body.email !== undefined && body.email.trim() !== "") {
    return `email:${body.email.trim().toLowerCase()}`;
  }
  if (body.phone !== undefined && body.phone.trim() !== "") {
    // Digits only, so "+91 98765 43210" and "+919876543210" are one prospect.
    const digits = body.phone.replace(/\D/g, "");
    if (digits !== "") return `phone:${digits}`;
  }
  return null;
}

/**
 * A browser sends `Origin` on cross-origin form posts; a server-side integration sends
 * none at all. So an empty allowlist means "any origin", and a configured allowlist
 * requires an exact match — including for a request with no Origin header, which cannot
 * satisfy an allowlist and is therefore refused.
 *
 * 403 rather than 404 here: unlike the key checks this leaks nothing an attacker does
 * not already have (they hold a valid key), and a 404 would send a tenant's own web
 * developer hunting for a missing form instead of a misconfigured origin.
 */
export function originAllowed(allowedOrigins: string[], origin: string | undefined): boolean {
  if (allowedOrigins.length === 0) return true;
  if (origin === undefined || origin === "") return false;
  return allowedOrigins.includes(origin);
}

/**
 * Synthetic anonymous context, used only to reach `commandId`'s scoping rules and to
 * stamp the envelope. `actorType: "user"` with the well-known anonymous actor id is how
 * the rest of the suite represents an unauthenticated principal.
 */
const ANONYMOUS_ACTOR_ID = "00000000-0000-0000-0000-000000000000";

function anonymousContext(
  tenantId: string,
  correlationId: string,
  idempotencyKey?: string,
): RequestContext {
  return {
    tenantId,
    actorId: ANONYMOUS_ACTOR_ID,
    actorType: "user",
    roles: [],
    correlationId,
    ...(idempotencyKey !== undefined ? { idempotencyKey } : {}),
  };
}

async function resolveForm(formKey: string): Promise<ResolvedCaptureForm> {
  // Shape check produces the SAME 404 as a miss, so a scanner cannot learn the format.
  if (!FORM_KEY_PATTERN.test(formKey)) notFound();
  const form = await repo.findByFormKey(formKey);
  // `!form.enabled` collapses into the same branch on purpose: a disabled form must be
  // indistinguishable from one that never existed.
  if (!form || !form.enabled) notFound();
  return form;
}

export async function publicLeadCaptureRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    "/v1/crm/public/leads/:formKey",
    {
      // THE auth bypass. See the file header.
      config: { public: true },
      // Enforced by Fastify before the body is buffered in full → 413, not a 500.
      bodyLimit: MAX_PUBLIC_BODY_BYTES,
    },
    async (req: FastifyRequest, reply) => {
      const { formKey } = formKeyParam.parse(req.params);
      const form = await resolveForm(formKey);

      // Rate limit before parsing the body and before any further work. It has to come
      // after the lookup because the budget is a per-form setting.
      const decision = await checkCaptureRateLimit({
        formKey,
        tenantId: form.tenantId,
        clientIp: resolveClientIp(req),
        maxPerMinute: form.maxPerMinute,
      });
      if (!decision.allowed) {
        throw new HttpError(
          429,
          "RATE_LIMITED",
          decision.limiterUnavailable
            ? "submissions are temporarily unavailable — please retry shortly"
            : "too many submissions — please retry shortly",
        );
      }

      if (!originAllowed(form.allowedOrigins, req.headers.origin)) {
        throw new HttpError(403, "ORIGIN_NOT_ALLOWED", "this origin may not submit to this form");
      }

      const body = publicLeadBody.parse(req.body);
      const correlationId = req.id;

      // Honeypot: answer exactly as a real submission would and write nothing.
      if (body._hp !== undefined && body._hp.trim() !== "") {
        req.log.info(
          { formId: form.id, tenantId: form.tenantId, correlationId },
          "public lead submission dropped by honeypot",
        );
        return reply.code(202).send(publicAcceptedSchema.parse({ status: "accepted", correlationId }));
      }

      // Consent gate. 422 (business rule), not 400: the payload is well-formed, it is
      // the lawful basis for processing that is missing.
      if (form.requireConsent && body.consent !== true) {
        throw new HttpError(
          422,
          "CONSENT_REQUIRED",
          "explicit marketing consent is required by this form",
        );
      }

      const identity = submissionIdentity(body);

      /**
       * `contactId` is DETERMINISTIC on (tenant, form, normalised identity). It is used
       * ONLY as the primary key when the consumer finds nothing to update, and it is
       * what makes a phone-only prospect converge on one row: there is no blind index
       * over phone, so the consumer cannot look that lead up — but a deterministic PK
       * means the second submission collides with the first row instead of creating a
       * twin. `commandId` folds the tenant in, so the same identity under two tenants
       * cannot derive one id.
       */
      const contactId = commandId(
        anonymousContext(
          form.tenantId,
          correlationId,
          ...(identity !== null ? ([`${formKey}:${identity}`] as const) : ([] as const)),
        ),
        `${COMMANDS.publicLeadCapture}:contact`,
      );

      /**
       * `messageId` is deliberately RANDOM per submission, even though the contact id
       * is not.
       *
       * It used to be derived from (formKey, identity) too, which made the endpoint
       * permanently idempotent for that pair: the same prospect returning three months
       * later through a different campaign published a command whose messageId was
       * already in `_inbox.processed`, so `markProcessed` swallowed it and the new
       * attribution was silently discarded. That directly contradicts the acceptance
       * criterion — "creates or UPDATES a lead and records attribution".
       *
       * Each submission is therefore its own event. Convergence on one row is the
       * consumer's create-or-update (email blind index, then the deterministic PK),
       * not message deduplication, and `markProcessed` still does its real job of
       * making a REDELIVERY of one submission idempotent. A double-clicked form
       * publishes two commands: the first creates, the second updates the same row.
       *
       * No client-supplied idempotency key is honoured on this path either — an
       * anonymous caller must not be able to choose an inbox key and pre-poison it so
       * that a later genuine submission is dropped as an already-processed replay.
       */
      const messageId = randomUUID();

      /**
       * Consent is stamped SERVER-SIDE at the moment of submission (DPDP Act 2023 wants
       * a demonstrable record of WHEN consent was given). The validator has no
       * `consentDate` field at all, so there is no client value to prefer or to have to
       * remember to ignore. `date` column → 'YYYY-MM-DD' in UTC, matching the
       * timestamptz-everywhere/UTC convention.
       */
      const consentDate = new Date().toISOString().slice(0, 10);

      await queue.publish(COMMANDS.publicLeadCapture, {
        messageId,
        type: COMMANDS.publicLeadCapture,
        tenantId: form.tenantId,
        actorId: ANONYMOUS_ACTOR_ID,
        correlationId,
        schemaVersion: "1.0",
        payload: {
          contactId,
          formId: form.id,
          tenantId: form.tenantId,
          name: body.name.trim(),
          ...(body.email !== undefined ? { email: body.email.trim() } : {}),
          ...(body.phone !== undefined ? { phone: body.phone.trim() } : {}),
          ...(body.company !== undefined ? { company: body.company } : {}),
          ...(body.city !== undefined ? { city: body.city } : {}),
          ...(body.designation !== undefined ? { designation: body.designation } : {}),
          // Recorded as submitted. When the form does not require consent and the
          // prospect said nothing, that is `false` — absence of consent, not consent.
          consent: body.consent === true,
          // Only meaningful when consent is true; sent unconditionally so the consumer
          // never has to invent a date, and never reads one from a caller.
          consentDate,
          // Precedence: what the prospect's form declared, then the form's default,
          // then the generic label. Never null, so campaign reporting can always
          // attribute the row to a channel.
          leadSource: body.source ?? form.defaultLeadSource ?? DEFAULT_PUBLIC_LEAD_SOURCE,
          utm: {
            ...(body.utm?.source !== undefined ? { source: body.utm.source } : {}),
            ...(body.utm?.medium !== undefined ? { medium: body.utm.medium } : {}),
            ...(body.utm?.campaign !== undefined ? { campaign: body.utm.campaign } : {}),
            ...(body.utm?.term !== undefined ? { term: body.utm.term } : {}),
            ...(body.utm?.content !== undefined ? { content: body.utm.content } : {}),
          },
          // Body first so a single form can serve several campaigns via its URL,
          // falling back to the campaign the form is permanently tied to.
          ...(body.campaignId !== undefined
            ? { campaignId: body.campaignId }
            : form.campaignId !== null
              ? { campaignId: form.campaignId }
              : {}),
        },
      });

      // Ids only. Never a submitted value (no name/email/phone), and never the form key
      // — that is a bearer secret in a URL, and `formId` identifies the same form for
      // any operator who needs to correlate. tenantId is an id, not PII.
      req.log.info(
        { formId: form.id, tenantId: form.tenantId, correlationId },
        "public lead submission accepted",
      );
      return reply.code(202).send(publicAcceptedSchema.parse({ status: "accepted", correlationId }));
    },
  );
}
