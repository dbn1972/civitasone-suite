/**
 * tenant-settings routes (GAP-ADMIN-SETTINGS-01/-05/-06).
 *   GET   /v1/admin/settings                  -> all four sections + logo metadata (secrets masked)
 *   PATCH /v1/admin/settings/:section         -> partial update (publishes a command, 202)
 *   POST  /v1/admin/settings/email/test       -> queue a test email to a recipient (202)
 *   GET   /v1/admin/settings/logo             -> the stored logo as base64 JSON (404 when none)
 *   POST  /v1/admin/settings/logo             -> replace the logo (PNG/JPEG, bounded size)
 *   DELETE /v1/admin/settings/logo            -> remove the logo
 * Every route is tenant_admin or higher and tenant-scoped (RLS + explicit WHERE).
 */
import { createHash } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { resolveContext, requireRole, HttpError, TENANT_ADMIN_ROLES } from "../../shared/context.js";
import { cache } from "../../shared/infra.js";
import { scopedRead } from "../../shared/db.js";
import * as commands from "./commands.js";
import { settingsCacheKey } from "./consumer.js";
import { settingsSections, tenantLogos } from "./schema.js";
import {
  PATCH_SCHEMAS, SETTINGS_SECTIONS, decodeLogo, emailTestBody, logoBody, logoMaxBytes, sectionParam,
  type SettingsSection,
} from "./validators.js";

const ROLES = [...TENANT_ADMIN_ROLES];
// A 150 KB image is ~200 KB of base64 plus the JSON wrapper.
const LOGO_BODY_LIMIT = 300_000;

function parse<T>(schema: z.ZodType<T, z.ZodTypeDef, any>, data: unknown): T {
  const r = schema.safeParse(data);
  if (!r.success) {
    const msg = r.error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; ");
    throw new HttpError(400, "VALIDATION_FAILED", msg);
  }
  return r.data;
}

type Snapshot = {
  sections: Record<SettingsSection, { configured: boolean; values: Record<string, unknown>; version: number; updatedAt: string | null }>;
  hasSmtpPassword: boolean;
  logo: { present: boolean; contentType: string | null; sizeBytes: number | null; sha256: string | null; updatedAt: string | null };
};

async function loadSnapshot(tenantId: string): Promise<Snapshot> {
  const loaded = await cache.getOrLoad<Snapshot>(settingsCacheKey(tenantId), async () => {
    const [rows, logos] = await scopedRead(async (tx) => [
      await tx.select().from(settingsSections).where(eq(settingsSections.tenantId, tenantId)),
      await tx.select({
        contentType: tenantLogos.contentType, sizeBytes: tenantLogos.sizeBytes, sha256: tenantLogos.sha256, updatedAt: tenantLogos.updatedAt,
      }).from(tenantLogos).where(eq(tenantLogos.tenantId, tenantId)),
    ] as const);
    const sections = Object.fromEntries(
      SETTINGS_SECTIONS.map((s) => [s, { configured: false, values: {}, version: 0, updatedAt: null }]),
    ) as Snapshot["sections"];
    let hasSmtpPassword = false;
    for (const r of rows) {
      const s = r.section as SettingsSection;
      if (!(SETTINGS_SECTIONS as readonly string[]).includes(s)) continue;
      sections[s] = { configured: true, values: r.values, version: r.version, updatedAt: r.updatedAt.toISOString() };
      if (s === "email" && r.secretCiphertext) hasSmtpPassword = true;
    }
    const l = logos[0];
    return {
      sections,
      hasSmtpPassword,
      logo: l
        ? { present: true, contentType: l.contentType, sizeBytes: l.sizeBytes, sha256: l.sha256, updatedAt: l.updatedAt.toISOString() }
        : { present: false, contentType: null, sizeBytes: null, sha256: null, updatedAt: null },
    };
  });
  if (!loaded) throw new HttpError(503, "UNAVAILABLE", "settings are temporarily unavailable");
  return loaded;
}

/**
 * The test email goes out through the platform sender to ANY address the admin types, so it is
 * throttled: at most 1 per tenant per cooldown window (default 60 s) and 5 per actor per hour.
 * Atomic counters (cache.incr), so a burst of parallel requests cannot all pass.
 */
const TENANT_COOLDOWN_S = () => Number(process.env.EMAIL_TEST_TENANT_COOLDOWN_S ?? 60);
const ACTOR_HOURLY_MAX = () => Number(process.env.EMAIL_TEST_ACTOR_HOURLY_MAX ?? 5);
async function enforceEmailTestLimits(tenantId: string, actorId: string): Promise<void> {
  const perTenant = await cache.incr(cache.makeKey(tenantId, "email_test", "tenant_cooldown"), TENANT_COOLDOWN_S());
  if (perTenant > 1) {
    throw new HttpError(429, "RATE_LIMITED", `a test email was just requested for this office; wait ${TENANT_COOLDOWN_S()} seconds`);
  }
  const perActor = await cache.incr(cache.makeKey(actorId, "email_test", "actor_hour"), 3600);
  if (perActor > ACTOR_HOURLY_MAX()) {
    throw new HttpError(429, "RATE_LIMITED", `at most ${ACTOR_HOURLY_MAX()} test emails per hour per administrator`);
  }
}

export async function tenantSettingsRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/admin/settings", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const snap = await loadSnapshot(ctx.tenantId);
    // The SMTP password is write-only: only whether one is stored is ever returned.
    const email = { ...snap.sections.email, values: { ...snap.sections.email.values, hasPassword: snap.hasSmtpPassword } };
    return reply.send({ data: { ...snap.sections, email, logo: snap.logo } });
  });

  app.get("/v1/admin/settings/logo", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const rows = await scopedRead((tx) => tx.select().from(tenantLogos).where(eq(tenantLogos.tenantId, ctx.tenantId)));
    const row = rows[0];
    if (!row) throw new HttpError(404, "NOT_FOUND", "no logo has been uploaded");
    return reply.send({
      data: {
        contentType: row.contentType, sizeBytes: row.sizeBytes, sha256: row.sha256,
        updatedAt: row.updatedAt.toISOString(), dataBase64: Buffer.from(row.data).toString("base64"),
      },
    });
  });

  app.post("/v1/admin/settings/logo", { bodyLimit: LOGO_BODY_LIMIT }, async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const body = parse(logoBody, req.body);
    const decoded = decodeLogo(body.contentType, body.dataBase64);
    if (!decoded.ok) {
      throw new HttpError(422, "INVALID_LOGO", `${decoded.reason} (PNG or JPEG, at most ${logoMaxBytes()} bytes)`);
    }
    const sha = createHash("sha256").update(decoded.bytes).digest("hex");
    return reply.code(202).send(await commands.logoSet(ctx, body.contentType, body.dataBase64, sha, decoded.bytes.length));
  });

  app.delete("/v1/admin/settings/logo", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    return reply.code(202).send(await commands.logoRemove(ctx));
  });

  app.post("/v1/admin/settings/email/test", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const body = parse(emailTestBody, req.body ?? {});
    const snap = await loadSnapshot(ctx.tenantId);
    const email = snap.sections.email.values;
    if (!snap.sections.email.configured || !email.smtpHost || !email.fromEmail) {
      throw new HttpError(409, "EMAIL_NOT_CONFIGURED", "save the SMTP host and the From email before sending a test");
    }
    await enforceEmailTestLimits(ctx.tenantId, ctx.actorId);
    return reply.code(202).send(await commands.emailTest(ctx, body.recipient));
  });

  app.patch("/v1/admin/settings/:section", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const { section } = parse(sectionParam, req.params);
    const patch = parse(PATCH_SCHEMAS[section] as z.ZodType<Record<string, unknown>, z.ZodTypeDef, any>, req.body);
    if (Object.keys(patch).length === 0) throw new HttpError(400, "VALIDATION_FAILED", "at least one field is required");
    return reply.code(202).send(await commands.settingsUpdate(ctx, section, patch));
  });
}
