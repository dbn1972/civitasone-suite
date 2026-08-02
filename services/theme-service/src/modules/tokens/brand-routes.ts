import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import { ZodError } from "zod";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import { sendAccepted } from "@civitasone/schemas/validate";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { cache } from "../../shared/infra.js";
import { db } from "../../shared/db.js";
import { brandPresets, type BrandConfigRow } from "./schema.js";
import { BRAND_RESOURCE, DEFAULTS } from "./brand-defaults.js";
import { upsertBrandBody, applyPresetBody } from "./validators.js";
import * as brandRepo from "./brand-repo.js";
import * as commands from "./commands.js";

const ADMIN_ROLES = ["theme_admin", "super_admin"];

function resolveTenantId(req: { headers: Record<string, string | string[] | undefined> }): string {
  const tenantId = req.headers["x-tenant-id"] as string | undefined;
  if (!tenantId) throw new HttpError(400, "MISSING_TENANT", "x-tenant-id header is required");
  return tenantId;
}

function buildCssVars(config: BrandConfigRow | typeof DEFAULTS & { tenantId?: string }): string {
  let css = `:root {
  --color-primary: ${config.colorPrimary};
  --color-primary-fg: ${config.colorPrimaryFg};
  --color-secondary: ${config.colorSecondary};
  --color-accent: ${config.colorAccent};
  --color-background: ${config.colorBackground};
  --color-surface: ${config.colorSurface};
  --color-border: ${config.colorBorder};
  --color-text: ${config.colorText};
  --color-muted: ${config.colorMuted};
  --color-success: ${config.colorSuccess};
  --color-warning: ${config.colorWarning};
  --color-error: ${config.colorError};
  --font-family: ${config.fontFamily};
  --font-family-mono: ${config.fontFamilyMono};
  --sidebar-style: ${config.sidebarStyle};
  --header-style: ${config.headerStyle};
  --border-radius: ${config.borderRadius};
}`;
  const custom = "customCss" in config ? (config as { customCss?: string | null }).customCss : null;
  if (custom) {
    css += "\n" + sanitizeCss(custom);
  }
  return css;
}

/**
 * Sanitize user-supplied CSS to prevent injection attacks.
 * Removes dangerous constructs: @import, url(), expression(), javascript:, behavior, -moz-binding.
 */
function sanitizeCss(raw: string): string {
  let css = raw;
  css = css.replace(/expression\s*\([^)]*\)/gi, "/* [sanitized] */");
  css = css.replace(/@import\b[^;]*/gi, "/* [sanitized] */");
  css = css.replace(/url\s*\([^)]*\)/gi, "/* [sanitized] */");
  css = css.replace(/javascript\s*:/gi, "/* [sanitized] */");
  css = css.replace(/behavior\s*:/gi, "/* [sanitized] */");
  css = css.replace(/-moz-binding\s*:/gi, "/* [sanitized] */");
  css = css.replace(/<!--|-->/g, "");
  return css;
}

export async function brandRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/themes/brand", async (req, reply) => {
    const tenantId = resolveTenantId(req);
    const config = await cache.getOrLoad<BrandConfigRow>(
      cache.makeKey(tenantId, BRAND_RESOURCE, "config"),
      () => brandRepo.findByTenant(tenantId),
      60,
    );
    return reply.send(config ?? { tenantId, ...DEFAULTS });
  });

  app.put("/v1/themes/brand", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const body = upsertBrandBody.parse(req.body);
    sendAccepted(reply, acceptedResponseSchema, await commands.upsertBrandConfig(ctx, body));
  });

  app.get("/v1/themes/brand/presets", async (_req, reply) => {
    const rows = await cache.getOrLoad(
      cache.makeKey("global", BRAND_RESOURCE, "presets"),
      async () => db.select().from(brandPresets),
      60,
    );
    return reply.send(rows ?? []);
  });

  app.post("/v1/themes/brand/apply-preset", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { code } = applyPresetBody.parse(req.body);

    const presetRows = await db.select().from(brandPresets).where(eq(brandPresets.code, code)).limit(1);
    const preset = presetRows[0];
    if (!preset) throw new HttpError(404, "PRESET_NOT_FOUND", `preset '${code}' not found`);

    sendAccepted(reply, acceptedResponseSchema, await commands.applyBrandPreset(ctx, preset));
  });

  app.get("/v1/themes/brand/css", async (req, reply) => {
    const tenantId = resolveTenantId(req);
    const config = await cache.getOrLoad<BrandConfigRow>(
      cache.makeKey(tenantId, BRAND_RESOURCE, "config"),
      () => brandRepo.findByTenant(tenantId),
      60,
    );
    const css = buildCssVars(config ?? { tenantId, ...DEFAULTS });
    return reply
      .header("Content-Type", "text/css")
      .header("Cache-Control", "public, max-age=60")
      .send(css);
  });

  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) {
      return reply.code(400).send({
        code: "VALIDATION_FAILED",
        message: "invalid request",
        correlationId,
        retryable: false,
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
