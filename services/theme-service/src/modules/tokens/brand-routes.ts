import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { cache } from "../../shared/infra.js";
import { db } from "../../shared/db.js";
import { brandConfig, brandPresets, type BrandConfigRow } from "./schema.js";

const BRAND_RESOURCE = "brand";
const ADMIN_ROLES = ["theme_admin", "super_admin"];

/* ---------- defaults (returned when no row exists) ---------- */
const DEFAULTS: Omit<BrandConfigRow, "tenantId" | "createdAt" | "updatedAt" | "createdBy" | "updatedBy"> = {
  appName: "CivitasOne",
  tagline: null,
  logoUrl: null,
  logoDarkUrl: null,
  faviconUrl: null,
  loginBgUrl: null,
  footerText: null,
  poweredBy: "Powered by CivitasOne",
  colorPrimary: "#1e40af",
  colorPrimaryFg: "#ffffff",
  colorSecondary: "#64748b",
  colorAccent: "#f59e0b",
  colorBackground: "#ffffff",
  colorSurface: "#f8fafc",
  colorBorder: "#e2e8f0",
  colorText: "#1e293b",
  colorMuted: "#64748b",
  colorSuccess: "#16a34a",
  colorWarning: "#d97706",
  colorError: "#dc2626",
  fontFamily: "Inter, system-ui, sans-serif",
  fontFamilyMono: "JetBrains Mono, monospace",
  sidebarStyle: "default",
  headerStyle: "default",
  borderRadius: "0.5rem",
  customCss: null,
  version: 1,
};

/* ---------- validation ---------- */
const upsertBrandBody = z.object({
  appName: z.string().min(1).max(128).optional(),
  tagline: z.string().max(256).nullable().optional(),
  logoUrl: z.string().url().max(2048).nullable().optional(),
  logoDarkUrl: z.string().url().max(2048).nullable().optional(),
  faviconUrl: z.string().url().max(2048).nullable().optional(),
  loginBgUrl: z.string().url().max(2048).nullable().optional(),
  footerText: z.string().max(512).nullable().optional(),
  poweredBy: z.string().max(128).nullable().optional(),
  colorPrimary: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  colorPrimaryFg: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  colorSecondary: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  colorAccent: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  colorBackground: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  colorSurface: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  colorBorder: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  colorText: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  colorMuted: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  colorSuccess: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  colorWarning: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  colorError: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  fontFamily: z.string().max(256).optional(),
  fontFamilyMono: z.string().max(256).optional(),
  sidebarStyle: z.enum(["default", "compact", "expanded"]).optional(),
  headerStyle: z.enum(["default", "minimal", "branded"]).optional(),
  borderRadius: z.string().max(32).optional(),
  customCss: z.string().max(16384).nullable().optional(),
});

const applyPresetBody = z.object({
  code: z.string().min(1).max(64),
});

/* ---------- helpers ---------- */

/** Strip undefined keys so Drizzle doesn't choke with exactOptionalPropertyTypes. */
function stripUndefined<T extends Record<string, unknown>>(obj: T): { [K in keyof T as T[K] extends undefined ? never : K]: T[K] } {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as never;
}

function resolveTenantId(req: { headers: Record<string, string | string[] | undefined> }): string {
  const tenantId = req.headers["x-tenant-id"] as string | undefined;
  if (!tenantId) throw new HttpError(400, "MISSING_TENANT", "x-tenant-id header is required");
  return tenantId;
}

async function loadBrandConfig(tenantId: string): Promise<BrandConfigRow | null> {
  const rows = await db.select().from(brandConfig).where(eq(brandConfig.tenantId, tenantId)).limit(1);
  return rows[0] ?? null;
}

function buildCssVars(config: BrandConfigRow | typeof DEFAULTS & { tenantId?: string }): string {
  return `:root {
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
}

/* ---------- routes ---------- */

export async function brandRoutes(app: FastifyInstance): Promise<void> {

  /* GET /v1/themes/brand — PUBLIC, cache-first */
  app.get("/v1/themes/brand", async (req, reply) => {
    const tenantId = resolveTenantId(req);
    const config = await cache.getOrLoad<BrandConfigRow>(
      cache.makeKey(tenantId, BRAND_RESOURCE, "config"),
      () => loadBrandConfig(tenantId),
      60,
    );
    return reply.send(config ?? { tenantId, ...DEFAULTS });
  });

  /* PUT /v1/themes/brand — upsert (theme_admin / super_admin) */
  app.put("/v1/themes/brand", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const body = upsertBrandBody.parse(req.body);
    const cleaned = stripUndefined(body);

    const now = new Date();
    const existing = await loadBrandConfig(ctx.tenantId);

    if (existing) {
      const newVersion = existing.version + 1;
      const setPayload = { ...cleaned, updatedAt: now, updatedBy: ctx.actorId, version: newVersion };
      await db
        .update(brandConfig)
        .set(setPayload as typeof brandConfig.$inferInsert)
        .where(eq(brandConfig.tenantId, ctx.tenantId));

      const updated = { ...existing, ...cleaned, updatedAt: now, updatedBy: ctx.actorId, version: newVersion };
      await cache.invalidateResource(ctx.tenantId, BRAND_RESOURCE);
      return reply.send(updated);
    }

    const row = {
      tenantId: ctx.tenantId,
      ...DEFAULTS,
      ...cleaned,
      createdAt: now,
      updatedAt: now,
      createdBy: ctx.actorId,
      updatedBy: ctx.actorId,
      version: 1,
    } as typeof brandConfig.$inferInsert;
    await db.insert(brandConfig).values(row);
    await cache.invalidateResource(ctx.tenantId, BRAND_RESOURCE);
    return reply.code(201).send(row);
  });

  /* GET /v1/themes/brand/presets — PUBLIC */
  app.get("/v1/themes/brand/presets", async (_req, reply) => {
    const rows = await cache.getOrLoad(
      cache.makeKey("global", BRAND_RESOURCE, "presets"),
      async () => db.select().from(brandPresets),
      60,
    );
    return reply.send(rows ?? []);
  });

  /* POST /v1/themes/brand/apply-preset — theme_admin only */
  app.post("/v1/themes/brand/apply-preset", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { code } = applyPresetBody.parse(req.body);

    const presetRows = await db.select().from(brandPresets).where(eq(brandPresets.code, code)).limit(1);
    const preset = presetRows[0];
    if (!preset) throw new HttpError(404, "PRESET_NOT_FOUND", `preset '${code}' not found`);

    const now = new Date();
    const existing = await loadBrandConfig(ctx.tenantId);

    const presetValues = {
      colorPrimary: preset.colorPrimary,
      colorSecondary: preset.colorSecondary,
      colorAccent: preset.colorAccent,
      colorBackground: preset.colorBackground,
      colorSurface: preset.colorSurface,
      fontFamily: preset.fontFamily,
      sidebarStyle: preset.sidebarStyle,
    };

    if (existing) {
      const newVersion = existing.version + 1;
      await db
        .update(brandConfig)
        .set({ ...presetValues, updatedAt: now, updatedBy: ctx.actorId, version: newVersion })
        .where(eq(brandConfig.tenantId, ctx.tenantId));
    } else {
      await db.insert(brandConfig).values({
        tenantId: ctx.tenantId,
        ...DEFAULTS,
        ...presetValues,
        createdAt: now,
        updatedAt: now,
        createdBy: ctx.actorId,
        updatedBy: ctx.actorId,
        version: 1,
      });
    }

    await cache.invalidateResource(ctx.tenantId, BRAND_RESOURCE);
    return reply.send({ status: "applied", preset: code });
  });

  /* GET /v1/themes/brand/css — PUBLIC, text/css response, cache-first */
  app.get("/v1/themes/brand/css", async (req, reply) => {
    const tenantId = resolveTenantId(req);
    const config = await cache.getOrLoad<BrandConfigRow>(
      cache.makeKey(tenantId, BRAND_RESOURCE, "config"),
      () => loadBrandConfig(tenantId),
      60,
    );
    const css = buildCssVars(config ?? { tenantId, ...DEFAULTS });
    return reply
      .header("Content-Type", "text/css")
      .header("Cache-Control", "public, max-age=60")
      .send(css);
  });
}
