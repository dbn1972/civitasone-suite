import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue, cache } from "../../shared/infra.js";
import { COMMANDS, RESOURCE } from "../../topics.js";
import type { CreateTokenBody, UpsertBrandBody } from "./validators.js";
import type { TokenView, BrandConfigRow, BrandPresetRow } from "./schema.js";
import { BRAND_RESOURCE, DEFAULTS } from "./brand-defaults.js";
import * as brandRepo from "./brand-repo.js";

export type Accepted = { id: string; status: string; correlationId: string };

function stripUndefined<T extends Record<string, unknown>>(obj: T): { [K in keyof T as T[K] extends undefined ? never : K]: T[K] } {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as never;
}

function brandConfigKey(tenantId: string): string {
  return cache.makeKey(tenantId, BRAND_RESOURCE, "config");
}

function presetValuesFrom(preset: BrandPresetRow): Pick<
  BrandConfigRow,
  "colorPrimary" | "colorSecondary" | "colorAccent" | "colorBackground" | "colorSurface" | "fontFamily" | "sidebarStyle"
> {
  return {
    colorPrimary: preset.colorPrimary,
    colorSecondary: preset.colorSecondary,
    colorAccent: preset.colorAccent,
    colorBackground: preset.colorBackground,
    colorSurface: preset.colorSurface,
    fontFamily: preset.fontFamily,
    sidebarStyle: preset.sidebarStyle,
  };
}

function projectBrandConfig(
  tenantId: string,
  actorId: string,
  existing: BrandConfigRow | null,
  patch: Partial<BrandConfigRow>,
): { projected: BrandConfigRow; isCreate: boolean } {
  const now = new Date();
  if (existing) {
    return {
      isCreate: false,
      projected: {
        ...existing,
        ...patch,
        tenantId,
        updatedAt: now,
        updatedBy: actorId,
        version: existing.version + 1,
      },
    };
  }
  return {
    isCreate: true,
    projected: {
      tenantId,
      ...DEFAULTS,
      ...patch,
      createdAt: now,
      updatedAt: now,
      createdBy: actorId,
      updatedBy: actorId,
      version: 1,
    },
  };
}

export type UpsertBrandConfigPayload = {
  projected: BrandConfigRow;
  isCreate: boolean;
};

export type ApplyBrandPresetPayload = {
  projected: BrandConfigRow;
  isCreate: boolean;
  presetCode: string;
};

export async function createToken(ctx: RequestContext, body: CreateTokenBody): Promise<Accepted> {
  const id = randomUUID();
  const projected: TokenView = {
    id,
    tenantId: ctx.tenantId,
    name: body.name,
    value: body.value,
    category: body.category ?? null,
    status: "active",
    version: 1,
  };

  await cache.put(cache.makeKey(ctx.tenantId, RESOURCE, id), projected);
  await queue.publish(COMMANDS.createToken, {
    messageId: id,
    type: COMMANDS.createToken,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: projected,
  });

  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function upsertBrandConfig(ctx: RequestContext, body: UpsertBrandBody): Promise<Accepted> {
  const id = randomUUID();
  const cleaned = stripUndefined(body) as Partial<BrandConfigRow>;
  const existing = await brandRepo.findByTenant(ctx.tenantId);
  const { projected, isCreate } = projectBrandConfig(ctx.tenantId, ctx.actorId, existing, cleaned);

  await cache.put(brandConfigKey(ctx.tenantId), projected);
  await queue.publish(COMMANDS.upsertBrandConfig, {
    messageId: id,
    type: COMMANDS.upsertBrandConfig,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { projected, isCreate } satisfies UpsertBrandConfigPayload,
  });

  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function applyBrandPreset(ctx: RequestContext, preset: BrandPresetRow): Promise<Accepted> {
  const id = randomUUID();
  const existing = await brandRepo.findByTenant(ctx.tenantId);
  const { projected, isCreate } = projectBrandConfig(
    ctx.tenantId,
    ctx.actorId,
    existing,
    presetValuesFrom(preset),
  );

  await cache.put(brandConfigKey(ctx.tenantId), projected);
  await queue.publish(COMMANDS.applyBrandPreset, {
    messageId: id,
    type: COMMANDS.applyBrandPreset,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { projected, isCreate, presetCode: preset.code } satisfies ApplyBrandPresetPayload,
  });

  return { id, status: "accepted", correlationId: ctx.correlationId };
}
