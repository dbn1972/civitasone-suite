/**
 * Authenticated forms-engine routes.
 *
 *   FRM-04 / FRM-05 — configuration and server-side resolution
 *     GET   /v1/metadata/forms/:layoutId/versions            list versions
 *     POST  /v1/metadata/forms/:layoutId/versions            create a draft version
 *     GET   /v1/metadata/form-versions/:id                   read one version
 *     PATCH /v1/metadata/form-versions/:id                   edit a DRAFT version
 *     POST  /v1/metadata/form-versions/:id/resolve           resolve visibility + cascade options
 *
 *   FRM-07 — maker-checker publish
 *     POST  /v1/metadata/form-versions/:id/submit            draft -> pending_approval
 *     POST  /v1/metadata/form-versions/:id/approve           pending_approval -> published
 *     POST  /v1/metadata/form-versions/:id/reject            pending_approval -> draft
 *     POST  /v1/metadata/form-versions/:id/revise            new draft copied from any version
 *
 *   LM-002 — public endpoint administration and lead read-back
 *     POST  /v1/metadata/form-versions/:id/public-endpoints  mint an opaque public key
 *     GET   /v1/metadata/form-versions/:id/submissions       list captured leads (masked PII)
 *
 * A "form" is an existing `metadata.layout_definitions` row — the form builder
 * this service already has. These routes add versioning and rule configuration
 * on top of it; the fields themselves still come from `field_definitions`.
 *
 * Every rule set is validated at DEFINITION time: a cyclic cascade rule set is
 * refused 422 here, so no citizen ever meets an unresolvable form at render
 * time. Cycle detection lives in the pure `findCascadeCycle` / `validateCascadeRules`
 * functions in ./domain.ts.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { randomBytes } from "node:crypto";
import { eq, and, desc, sql } from "drizzle-orm";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { withTenant, type Tx } from "../../shared/scope.js";
import { registerStandardErrorHandler } from "../../shared/api-errors.js";
import { ADMIN, DATA } from "../../shared/roles.js";
import { enqueue } from "../../shared/outbox.js";
import { EVENTS } from "../../topics.js";
import { mutateForm } from "./commands.js";
import { fieldDefinitions, layoutDefinitions } from "../entities/schema.js";
import { maskEmail, maskPhone } from "../../shared/pii-crypto.js";
import { formPublicEndpoints, formSubmissions, formVersions } from "./schema.js";
import {
  resolveCascadeOptions,
  validateCascadeRules,
  validateVisibilityRules,
  applyVisibility,
  type CascadeRule,
  type VisibilityRule,
} from "./domain.js";
import {
  assertEditable,
  canApprove,
  canReject,
  canSubmit,
  nextVersionNumber,
  type FormVersionState,
  type TransitionResult,
} from "./publish-domain.js";

// ── Request schemas ──────────────────────────────────────────────────────────

const cascadeRuleSchema = z.object({
  field: z.string().min(1).max(128),
  dependsOn: z.string().min(1).max(128),
  options: z.record(z.array(z.string().min(1).max(256)).max(500)),
});

const visibilityRuleSchema = z.object({
  field: z.string().min(1).max(128),
  showWhen: z.string().min(1).max(2000),
});

const createVersionSchema = z
  .object({
    visibilityRules: z.array(visibilityRuleSchema).max(200).default([]),
    cascadeRules: z.array(cascadeRuleSchema).max(200).default([]),
  })
  .strict();

const patchVersionSchema = z
  .object({
    visibilityRules: z.array(visibilityRuleSchema).max(200).optional(),
    cascadeRules: z.array(cascadeRuleSchema).max(200).optional(),
  })
  .strict();

const idParam = z.object({ id: z.string().uuid() });
const layoutParam = z.object({ layoutId: z.string().uuid() });

/** `limit` is required on every list, capped at 200 (API standard). */
const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200),
  offset: z.coerce.number().int().min(0).default(0),
});

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Turn a pure-domain refusal into the service's HttpError. */
function assertAllowed(result: TransitionResult): void {
  if (!result.ok) throw new HttpError(result.status, result.code, result.message);
}

function toState(row: {
  status: string;
  createdBy: string;
  submittedBy: string | null;
  publishedBy: string | null;
}): FormVersionState {
  return {
    status: row.status as FormVersionState["status"],
    createdBy: row.createdBy,
    submittedBy: row.submittedBy,
    publishedBy: row.publishedBy,
  };
}

async function loadVersion(tx: Tx, tenantId: string, id: string) {
  const rows = await tx
    .select()
    .from(formVersions)
    .where(and(eq(formVersions.id, id), eq(formVersions.tenantId, tenantId)))
    .limit(1);
  const row = rows[0];
  if (!row) throw new HttpError(404, "NOT_FOUND", "Form version not found");
  return row;
}

/** Field api-names declared on the entity that owns this form. */
async function formFieldNames(tx: Tx, tenantId: string, layoutDefId: string): Promise<string[]> {
  const layouts = await tx
    .select()
    .from(layoutDefinitions)
    .where(and(eq(layoutDefinitions.id, layoutDefId), eq(layoutDefinitions.tenantId, tenantId)))
    .limit(1);
  const layout = layouts[0];
  if (!layout) throw new HttpError(404, "NOT_FOUND", "Form (layout) not found");
  const fields = await tx
    .select({ apiName: fieldDefinitions.apiName })
    .from(fieldDefinitions)
    .where(and(eq(fieldDefinitions.entityDefId, layout.entityDefId), eq(fieldDefinitions.tenantId, tenantId)));
  return fields.map((f) => f.apiName);
}

/**
 * Validate a rule set against the form's real fields. Cycles and unknown field
 * references are business-rule violations, hence 422 — the request was
 * well-formed, the configuration is not satisfiable.
 */
function assertRulesValid(
  cascadeRules: CascadeRule[],
  visibilityRules: VisibilityRule[],
  knownFields: string[],
): void {
  const cascade = validateCascadeRules(cascadeRules, knownFields);
  const visibility = validateVisibilityRules(visibilityRules, knownFields);
  const errors = [...cascade.errors, ...visibility];
  if (errors.length > 0) {
    throw new HttpError(
      422,
      cascade.cycle ? "CASCADE_CYCLE" : "FORM_RULES_INVALID",
      errors.join("; "),
    );
  }
}

// ── Routes ───────────────────────────────────────────────────────────────────

export async function formRoutes(app: FastifyInstance): Promise<void> {
  // ─── List versions of a form ──────────────────────────────────────────────
  app.get("/v1/metadata/forms/:layoutId/versions", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN);
    const { layoutId } = layoutParam.parse(req.params);
    const q = listQuery.parse(req.query);

    const { rows, total } = await withTenant(ctx.tenantId, async (tx) => {
      const all = await tx
        .select()
        .from(formVersions)
        .where(and(eq(formVersions.layoutDefId, layoutId), eq(formVersions.tenantId, ctx.tenantId)))
        .orderBy(desc(formVersions.versionNumber));
      return { rows: all.slice(q.offset, q.offset + q.limit), total: all.length };
    });

    return reply.send({
      data: rows,
      meta: { page: Math.floor(q.offset / q.limit) + 1, pageSize: q.limit, total },
    });
  });

  // ─── Create a draft version ───────────────────────────────────────────────
  app.post("/v1/metadata/forms/:layoutId/versions", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN);
    const { layoutId } = layoutParam.parse(req.params);
    const body = createVersionSchema.parse(req.body ?? {});

    const prep = await withTenant(ctx.tenantId, async (tx) => {
      const known = await formFieldNames(tx, ctx.tenantId, layoutId);
      assertRulesValid(body.cascadeRules, body.visibilityRules, known);
      const existing = await tx
        .select({ versionNumber: formVersions.versionNumber })
        .from(formVersions)
        .where(and(eq(formVersions.layoutDefId, layoutId), eq(formVersions.tenantId, ctx.tenantId)));
      return { versionNumber: nextVersionNumber(existing.map((e) => e.versionNumber)) };
    });
    return reply.code(202).send({ data: await mutateForm(ctx, "create_version", {
      layoutId, versionNumber: prep.versionNumber,
      visibilityRules: body.visibilityRules, cascadeRules: body.cascadeRules,
    }) });
  });

  // ─── Read one version ─────────────────────────────────────────────────────
  app.get("/v1/metadata/form-versions/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN);
    const { id } = idParam.parse(req.params);
    const row = await withTenant(ctx.tenantId, (tx) => loadVersion(tx, ctx.tenantId, id));
    return reply.send({ data: row });
  });

  // ─── Edit a DRAFT version (published versions are immutable) ──────────────
  app.patch("/v1/metadata/form-versions/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN);
    const { id } = idParam.parse(req.params);
    const body = patchVersionSchema.parse(req.body ?? {});

    const prep = await withTenant(ctx.tenantId, async (tx) => {
      const existing = await loadVersion(tx, ctx.tenantId, id);
      assertAllowed(assertEditable(toState(existing)));
      const cascadeRules = body.cascadeRules ?? existing.cascadeRules;
      const visibilityRules = body.visibilityRules ?? existing.visibilityRules;
      const known = await formFieldNames(tx, ctx.tenantId, existing.layoutDefId);
      assertRulesValid(cascadeRules, visibilityRules, known);
      return { cascadeRules, visibilityRules, version: existing.version };
    });
    return reply.code(202).send({ data: await mutateForm(ctx, "update_version", {
      id, cascadeRules: prep.cascadeRules, visibilityRules: prep.visibilityRules, version: prep.version,
    }) });
  });

  // ─── FRM-07: submit for approval ──────────────────────────────────────────
  app.post("/v1/metadata/form-versions/:id/submit", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN);
    const { id } = idParam.parse(req.params);

    await withTenant(ctx.tenantId, async (tx) => {
      const existing = await loadVersion(tx, ctx.tenantId, id);
      assertAllowed(canSubmit(toState(existing)));
    });
    return reply.code(202).send({ data: await mutateForm(ctx, "submit_version", { id }) });
  });

  // ─── FRM-07: approve + publish (separation of duties) ─────────────────────
  app.post("/v1/metadata/form-versions/:id/approve", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN);
    const { id } = idParam.parse(req.params);

    await withTenant(ctx.tenantId, async (tx) => {
      const existing = await loadVersion(tx, ctx.tenantId, id);
      assertAllowed(canApprove(toState(existing), ctx.actorId));
    });
    return reply.code(202).send({ data: await mutateForm(ctx, "approve_version", { id }) });
  });

  // ─── FRM-07: reject back to draft ─────────────────────────────────────────
  app.post("/v1/metadata/form-versions/:id/reject", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN);
    const { id } = idParam.parse(req.params);
    const body = z.object({ reason: z.string().min(1).max(1000).optional() }).strict().parse(req.body ?? {});

    await withTenant(ctx.tenantId, async (tx) => {
      const existing = await loadVersion(tx, ctx.tenantId, id);
      assertAllowed(canReject(toState(existing)));
    });
    return reply.code(202).send({ data: await mutateForm(ctx, "reject_version", { id, reason: body.reason }) });
  });

  // ─── FRM-07: revise — a published version is never mutated ────────────────
  app.post("/v1/metadata/form-versions/:id/revise", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN);
    const { id } = idParam.parse(req.params);

    const prep = await withTenant(ctx.tenantId, async (tx) => {
      const source = await loadVersion(tx, ctx.tenantId, id);
      const existing = await tx
        .select({ versionNumber: formVersions.versionNumber })
        .from(formVersions)
        .where(
          and(eq(formVersions.layoutDefId, source.layoutDefId), eq(formVersions.tenantId, ctx.tenantId)),
        );
      return {
        layoutId: source.layoutDefId,
        versionNumber: nextVersionNumber(existing.map((e) => e.versionNumber)),
        visibilityRules: source.visibilityRules,
        cascadeRules: source.cascadeRules,
      };
    });
    return reply.code(202).send({ data: await mutateForm(ctx, "revise_version", prep) });
  });

  // ─── FRM-04 / FRM-05: server-side resolution ──────────────────────────────
  // Given the values entered so far, return which fields are visible and which
  // options each cascaded field may offer. The client is told the answer; it
  // does not compute it, and the same functions run again on submit.
  app.post("/v1/metadata/form-versions/:id/resolve", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, DATA);
    const { id } = idParam.parse(req.params);
    const body = z
      .object({ values: z.record(z.unknown()).default({}) })
      .strict()
      .parse(req.body ?? {});

    const data = await withTenant(ctx.tenantId, async (tx) => {
      const version = await loadVersion(tx, ctx.tenantId, id);
      const known = await formFieldNames(tx, ctx.tenantId, version.layoutDefId);
      const visibility = applyVisibility(known, version.visibilityRules, body.values);
      return {
        formVersionId: id,
        status: version.status,
        visible: visibility.visible,
        hidden: visibility.hidden,
        stripped: visibility.stripped,
        cascades: resolveCascadeOptions(version.cascadeRules, visibility.values),
      };
    });
    return reply.send({ data });
  });

  // ─── LM-002: mint a public endpoint for a PUBLISHED version ───────────────
  app.post("/v1/metadata/form-versions/:id/public-endpoints", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN);
    const { id } = idParam.parse(req.params);
    const body = z.object({ label: z.string().min(1).max(256) }).strict().parse(req.body);

    await withTenant(ctx.tenantId, async (tx) => {
      const version = await loadVersion(tx, ctx.tenantId, id);
      if (version.status !== "published") {
        throw new HttpError(
          422,
          "VERSION_NOT_PUBLISHED",
          "only a published form version can be exposed on a public endpoint",
        );
      }
    });
    const publicKey = randomBytes(32).toString("hex");
    const accepted = await mutateForm(ctx, "create_public_endpoint", {
      formVersionId: id, publicKey, label: body.label,
    });
    return reply.code(202).send({
      data: {
        ...accepted,
        publicKey,
        submitUrl: `/v1/metadata/public/tenants/${ctx.tenantId}/forms/${publicKey}/submissions`,
      },
    });
  });

  // ─── LM-002: read back captured leads (masked PII) ────────────────────────
  app.get("/v1/metadata/form-versions/:id/submissions", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, DATA);
    const { id } = idParam.parse(req.params);
    const q = listQuery.parse(req.query);

    const { rows, total } = await withTenant(ctx.tenantId, async (tx) => {
      await loadVersion(tx, ctx.tenantId, id);
      const all = await tx
        .select()
        .from(formSubmissions)
        .where(and(eq(formSubmissions.formVersionId, id), eq(formSubmissions.tenantId, ctx.tenantId)))
        .orderBy(desc(formSubmissions.createdAt));
      return { rows: all.slice(q.offset, q.offset + q.limit), total: all.length };
    });

    // PII is decrypted by encryptedText() on read; it is masked again before it
    // leaves the service. A list view has no need for a full email or phone,
    // and the smaller the number of places cleartext PII appears, the smaller
    // the DPDP blast radius.
    const data = rows.map((r) => ({
      id: r.id,
      formVersionId: r.formVersionId,
      contactName: r.contactName,
      contactEmail: maskEmail(r.contactEmail),
      contactPhone: maskPhone(r.contactPhone),
      utm: {
        source: r.utmSource,
        medium: r.utmMedium,
        campaign: r.utmCampaign,
        term: r.utmTerm,
        content: r.utmContent,
      },
      channel: r.channel,
      strippedFields: r.strippedFields,
      leadStatus: r.leadStatus,
      createdAt: r.createdAt,
    }));

    return reply.send({
      data,
      meta: { page: Math.floor(q.offset / q.limit) + 1, pageSize: q.limit, total },
    });
  });

  registerStandardErrorHandler(app);
}
