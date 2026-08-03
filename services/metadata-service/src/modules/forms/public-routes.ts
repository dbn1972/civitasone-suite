/**
 * ██ PUBLIC, UNAUTHENTICATED ROUTES — LM-002 lead capture from web forms ██
 *
 * EVERY route in this file is reachable WITHOUT a JWT (`config.public = true`
 * makes @civitasone/auth's onRequest hook skip verification). This file exists
 * as a separate plugin for exactly one reason: so a reviewer can see the entire
 * unauthenticated surface of metadata-service in one place. Do not add an
 * authenticated route here, and do not add a route here without reading the
 * threat model below.
 *
 *   POST /v1/metadata/public/tenants/:tenantId/forms/:formKey/submissions
 *   GET  /v1/metadata/public/tenants/:tenantId/forms/:formKey
 *
 * ════════════════════════════════════════════════════════════════════════════
 * THREAT MODEL
 * ════════════════════════════════════════════════════════════════════════════
 *
 * 1. CROSS-TENANT WRITE — the one that matters most.
 *    The tenant is taken from the URL PATH and from nowhere else. The request
 *    body is `.strict()`, so a body carrying `tenantId` is a 400, not an
 *    override. No header is consulted. Critically, the path tenant alone is not
 *    sufficient: the 64-hex `formKey` is looked up INSIDE a transaction already
 *    scoped to that tenant (`withTenant`), under RLS ENABLE+FORCE with a
 *    NOBYPASSRLS role. So a caller must present a (tenantId, formKey) pair that
 *    genuinely exists together. Pointing tenant B at tenant A's key returns the
 *    same generic 404 as a key that never existed. `formKey` is 32 bytes of
 *    crypto randomness, so it cannot be guessed or enumerated.
 *
 * 2. SPAM / OPEN RELAY.
 *    Per-IP and per-form fixed-window rate limits run BEFORE any database work
 *    (see ./rate-limit.ts). They are in-process, therefore PER POD, not
 *    fleet-wide — a gateway rule is a required follow-up and is documented as
 *    such. Nothing here sends mail or makes an outbound call, so a successful
 *    submission cannot be turned into a relay: it writes one row and emits one
 *    event.
 *
 * 3. STORED XSS.
 *    No raw HTML is stored. Values containing markup, HTML entities or
 *    javascript:/data: URLs are REFUSED at the boundary rather than sanitised,
 *    because sanitising means owning an allow-list forever (see ./lead-domain.ts).
 *
 * 4. REFLECTION.
 *    No submitted value ever appears in a response. Rejections are reported as
 *    reason codes plus server-declared field names only; a name that came from
 *    the request is reduced to its reason code
 *    (`publicSafeRejectionSummary`). Zod issues are reduced to paths.
 *
 * 5. RESOURCE EXHAUSTION.
 *    Hard bounds: 32 KiB body (Fastify per-route `bodyLimit` → 413), 100 answer
 *    fields, 2000 chars per answer, 200 chars per UTM value, and fixed-size
 *    contact fields. The rate limiter itself is bounded and fails closed.
 *
 * 6. PII EXPOSURE.
 *    Name, email, phone and the answers blob are written through
 *    `encryptedText()` (AES-256-GCM). Only the submission id is logged — never a
 *    field value, never the IP alongside the contact data. The emitted event
 *    carries no PII at all (see src/topics.ts).
 *
 * 7. UNAPPROVED FORMS.
 *    A submission is only accepted against a form version whose status is
 *    `published`, i.e. one that passed FRM-07 maker-checker. A draft or
 *    superseded version returns the generic 404.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { HttpError } from "../../shared/context.js";
import { DetailedHttpError, registerStandardErrorHandler } from "../../shared/api-errors.js";
import { withTenant, type Tx } from "../../shared/scope.js";
import { queue } from "../../shared/infra.js";
import { ANONYMOUS_ACTOR_ID, COMMANDS } from "../../topics.js";
import { fieldDefinitions, layoutDefinitions } from "../entities/schema.js";
import { formPublicEndpoints, formVersions } from "./schema.js";
import { applyVisibility, resolveCascadeOptions, validateFormSubmission } from "./domain.js";
import type { FieldDef } from "../rules/domain.js";
import {
  MAX_ANSWER_COUNT,
  MAX_BODY_BYTES,
  MAX_UTM_LENGTH,
  checkAnswers,
  checkScalar,
  checkUtm,
  publicSafeRejectionSummary,
  utmFromUrl,
  type UtmParams,
} from "./lead-domain.js";
import { publicSubmissionFormLimiter, publicSubmissionIpLimiter } from "./rate-limit.js";

/**
 * ONE error for every resolution failure. An anonymous caller learns nothing
 * about whether the tenant exists, whether the key exists, whether it belongs to
 * a different tenant, or whether the form is merely unpublished. Same code, same
 * message, same status, every time.
 */
function notFound(): never {
  throw new HttpError(404, "NOT_FOUND", "form not found");
}

/** Path params. Both are validated shapes, not free strings. */
const pathParams = z.object({
  tenantId: z.string().uuid(),
  /** Exactly 64 lowercase hex chars — matches the column CHECK constraint. */
  formKey: z.string().regex(/^[0-9a-f]{64}$/),
});

/**
 * Submission body. `.strict()` throughout: an unexpected key is a 400. That is
 * what makes `tenantId`-in-the-body impossible rather than merely ignored.
 */
const submissionBody = z
  .object({
    contact: z
      .object({
        name: z.string().min(1).max(200),
        email: z.string().email().max(320).optional(),
        phone: z.string().min(4).max(32).optional(),
      })
      .strict(),
    answers: z.record(z.unknown()).default({}),
    utm: z
      .object({
        source: z.string().max(MAX_UTM_LENGTH).optional(),
        medium: z.string().max(MAX_UTM_LENGTH).optional(),
        campaign: z.string().max(MAX_UTM_LENGTH).optional(),
        term: z.string().max(MAX_UTM_LENGTH).optional(),
        content: z.string().max(MAX_UTM_LENGTH).optional(),
      })
      .strict()
      .optional(),
    /** Optional landing URL; UTM is parsed from it when `utm` is not supplied. */
    landingUrl: z.string().max(2048).optional(),
  })
  .strict();

interface ResolvedForm {
  endpointId: string;
  formVersionId: string;
  fields: FieldDef[];
  visibilityRules: ReturnType<typeof toVersionRules>["visibilityRules"];
  cascadeRules: ReturnType<typeof toVersionRules>["cascadeRules"];
}

function toVersionRules(row: { visibilityRules: unknown; cascadeRules: unknown }) {
  return {
    visibilityRules: row.visibilityRules as import("./domain.js").VisibilityRule[],
    cascadeRules: row.cascadeRules as import("./domain.js").CascadeRule[],
  };
}

/**
 * Resolve (tenantId from the path, formKey from the path) → the published form
 * version and its fields. Runs entirely inside the tenant-scoped transaction, so
 * RLS is the backstop for the join conditions rather than the only guard.
 */
async function resolvePublicForm(tx: Tx, tenantId: string, formKey: string): Promise<ResolvedForm> {
  const endpoints = await tx
    .select()
    .from(formPublicEndpoints)
    .where(
      and(
        eq(formPublicEndpoints.publicKey, formKey),
        eq(formPublicEndpoints.tenantId, tenantId),
        eq(formPublicEndpoints.isActive, true),
      ),
    )
    .limit(1);
  const endpoint = endpoints[0];
  if (!endpoint) notFound();

  const versions = await tx
    .select()
    .from(formVersions)
    .where(
      and(
        eq(formVersions.id, endpoint.formVersionId),
        eq(formVersions.tenantId, tenantId),
        // Only an approved (published) definition may accept public traffic.
        eq(formVersions.status, "published"),
      ),
    )
    .limit(1);
  const version = versions[0];
  if (!version) notFound();

  const layouts = await tx
    .select()
    .from(layoutDefinitions)
    .where(and(eq(layoutDefinitions.id, version.layoutDefId), eq(layoutDefinitions.tenantId, tenantId)))
    .limit(1);
  const layout = layouts[0];
  if (!layout) notFound();

  const fieldRows = await tx
    .select()
    .from(fieldDefinitions)
    .where(
      and(eq(fieldDefinitions.entityDefId, layout.entityDefId), eq(fieldDefinitions.tenantId, tenantId)),
    );

  const fields: FieldDef[] = fieldRows
    .filter((f) => f.isActive)
    .map((f) => ({
      apiName: f.apiName,
      fieldType: f.fieldType,
      isRequired: f.isRequired,
      label: f.label,
      ...(Array.isArray(f.picklistValues) ? { picklistValues: f.picklistValues as string[] } : {}),
    }));

  return {
    endpointId: endpoint.id,
    formVersionId: version.id,
    ...toVersionRules(version),
    fields,
  };
}

/** Apply both rate limits before touching the database. */
function enforceRateLimits(ip: string, formKey: string): void {
  const perIp = publicSubmissionIpLimiter.hit(`ip:${ip}`);
  if (!perIp.allowed) {
    throw new DetailedHttpError(429, "RATE_LIMITED", "too many submissions — please retry later", {
      retryAfterSeconds: perIp.retryAfterSeconds,
    });
  }
  const perForm = publicSubmissionFormLimiter.hit(`form:${formKey}`);
  if (!perForm.allowed) {
    throw new DetailedHttpError(429, "RATE_LIMITED", "this form is receiving too many submissions", {
      retryAfterSeconds: perForm.retryAfterSeconds,
    });
  }
}

export async function publicFormRoutes(app: FastifyInstance): Promise<void> {
  // ─────────────────────────────────────────────────────────────────────────
  // PUBLIC: describe the form so a page can render it.
  // Returns field metadata and rule configuration only — never a submission,
  // never anything about other forms or tenants.
  // ─────────────────────────────────────────────────────────────────────────
  app.get(
    "/v1/metadata/public/tenants/:tenantId/forms/:formKey",
    { config: { public: true }, bodyLimit: MAX_BODY_BYTES },
    async (req, reply) => {
      const { tenantId, formKey } = pathParams.parse(req.params);
      enforceRateLimits(req.ip, formKey);

      const data = await withTenant(tenantId, async (tx) => {
        const form = await resolvePublicForm(tx, tenantId, formKey);
        const visibility = applyVisibility(form.fields.map((f) => f.apiName), form.visibilityRules, {});
        return {
          formVersionId: form.formVersionId,
          fields: form.fields.map((f) => ({
            apiName: f.apiName,
            label: f.label ?? f.apiName,
            fieldType: f.fieldType,
            isRequired: f.isRequired,
            ...(f.picklistValues ? { picklistValues: f.picklistValues } : {}),
          })),
          visibleFields: visibility.visible,
          hiddenFields: visibility.hidden,
          cascades: resolveCascadeOptions(form.cascadeRules, {}),
        };
      });

      return reply.send({ data });
    },
  );

  // ─────────────────────────────────────────────────────────────────────────
  // PUBLIC: capture a lead. The single write on the unauthenticated surface.
  // ─────────────────────────────────────────────────────────────────────────
  app.post(
    "/v1/metadata/public/tenants/:tenantId/forms/:formKey/submissions",
    {
      config: { public: true },
      // Hard body bound enforced by Fastify before the payload is parsed, so an
      // oversized body is rejected without being buffered in full. 413.
      bodyLimit: MAX_BODY_BYTES,
    },
    async (req, reply) => {
      const { tenantId, formKey } = pathParams.parse(req.params);

      // Rate limit FIRST: before parsing the body, before opening a transaction.
      enforceRateLimits(req.ip, formKey);

      const body = submissionBody.parse(req.body);

      // Contact fields get the same markup/control-character treatment as
      // answers — a name is still attacker-controlled text.
      const contactRejections = [
        checkScalar("contact.name", body.contact.name, 200),
        body.contact.email !== undefined ? checkScalar("contact.email", body.contact.email, 320) : null,
        body.contact.phone !== undefined ? checkScalar("contact.phone", body.contact.phone, 32) : null,
      ].filter((r): r is NonNullable<typeof r> => r !== null);

      const utmCheck = checkUtm({
        ...(body.utm ?? {}),
        // Fall back to parsing the landing URL when explicit UTM is absent.
        ...(body.utm === undefined && body.landingUrl !== undefined ? utmFromUrl(body.landingUrl) : {}),
      } as Record<string, unknown>);

      const prepared = await withTenant(tenantId, async (tx) => {
        const form = await resolvePublicForm(tx, tenantId, formKey);
        const declared = form.fields.map((f) => f.apiName);

        const answerCheck = checkAnswers(body.answers, declared);
        const rejections = [...contactRejections, ...utmCheck.rejections, ...answerCheck.rejections];
        if (rejections.length > 0) {
          throw new DetailedHttpError(
            422,
            "SUBMISSION_REJECTED",
            "the submission was rejected",
            publicSafeRejectionSummary(rejections, [...declared, "contact.name", "contact.email", "contact.phone"]),
          );
        }

        const validated = validateFormSubmission(
          form.fields,
          form.visibilityRules,
          form.cascadeRules,
          answerCheck.answers,
        );
        if (validated.errors.length > 0) {
          throw new DetailedHttpError(422, "SUBMISSION_INVALID", "the submission failed validation", {
            reasons: validated.errors,
          });
        }

        return { form, validated, utm: utmCheck.utm };
      });

      const submissionId = randomUUID();
      const utm = prepared.utm;
      await queue.publish(COMMANDS.PUBLIC_FORM_SUBMIT, {
        messageId: submissionId,
        type: COMMANDS.PUBLIC_FORM_SUBMIT,
        tenantId,
        actorId: ANONYMOUS_ACTOR_ID,
        correlationId: req.id,
        schemaVersion: "1.0",
        payload: {
          id: submissionId,
          tenantId,
          formVersionId: prepared.form.formVersionId,
          publicEndpointId: prepared.form.endpointId,
          contactName: body.contact.name.trim(),
          ...(body.contact.email !== undefined ? { contactEmail: body.contact.email.trim() } : {}),
          ...(body.contact.phone !== undefined ? { contactPhone: body.contact.phone.trim() } : {}),
          answers: JSON.stringify(prepared.validated.values),
          utmColumns: utmColumns(utm),
          strippedFields: prepared.validated.stripped,
          actorId: ANONYMOUS_ACTOR_ID,
          leadPayload: {
            submissionId,
            formVersionId: prepared.form.formVersionId,
            tenantId,
            channel: "public_web_form",
            capturedAt: new Date().toISOString(),
            utm,
            answerFieldCount: Object.keys(prepared.validated.values).length,
            hasEmail: body.contact.email !== undefined,
            hasPhone: body.contact.phone !== undefined,
          },
        },
      });

      req.log.info({ submissionId }, "public form submission accepted");
      return reply.code(202).send({ data: { id: submissionId, status: "accepted" } });
    },
  );

  registerStandardErrorHandler(app);
}

/** Map the UTM block onto its columns, omitting absent keys (exactOptionalPropertyTypes). */
function utmColumns(utm: UtmParams): Record<string, string> {
  const cols: Record<string, string> = {};
  if (utm.source !== undefined) cols.utmSource = utm.source;
  if (utm.medium !== undefined) cols.utmMedium = utm.medium;
  if (utm.campaign !== undefined) cols.utmCampaign = utm.campaign;
  if (utm.term !== undefined) cols.utmTerm = utm.term;
  if (utm.content !== undefined) cols.utmContent = utm.content;
  return cols;
}

/** Re-exported for tests and for the admin route that documents the bound. */
export const PUBLIC_SUBMISSION_LIMITS = {
  maxBodyBytes: MAX_BODY_BYTES,
  maxAnswerCount: MAX_ANSWER_COUNT,
  maxUtmLength: MAX_UTM_LENGTH,
} as const;
