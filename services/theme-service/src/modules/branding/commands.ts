import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue, cache } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import type { UpsertBrandingBody } from "./validators.js";
import * as repo from "./repo.js";
import type { TenantBrandingRow } from "./schema.js";

export type Accepted = { id: string; status: string; correlationId: string };

const RESOURCE = "branding";

const DEFAULTS = {
  appName: "CivitasOne",
  primaryColor: "#1e40af",
  accentColor: "#f59e0b",
} as const;

function stripUndefined<T extends Record<string, unknown>>(obj: T): { [K in keyof T as T[K] extends undefined ? never : K]: T[K] } {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as never;
}

/**
 * Merge the request body onto the existing row (update) or onto defaults
 * (create). Fields omitted from the body must NOT reset to the hardcoded
 * default on an update — only a genuinely missing row falls back to
 * DEFAULTS. Mirrors tokens/commands.ts's projectBrandConfig for the same
 * per-tenant-singleton shape.
 */
function projectBranding(
  tenantId: string,
  actorId: string,
  existing: TenantBrandingRow | null,
  patch: Partial<TenantBrandingRow>,
): { projected: TenantBrandingRow; isCreate: boolean } {
  const now = new Date();
  if (existing) {
    return {
      isCreate: false,
      projected: { ...existing, ...patch, tenantId, updatedAt: now, updatedBy: actorId, version: existing.version + 1 },
    };
  }
  return {
    isCreate: true,
    projected: {
      id: randomUUID(),
      tenantId,
      logoS3Key: null,
      faviconS3Key: null,
      footerText: null,
      customEmailFrom: null,
      poweredByHidden: false,
      customLoginHtml: null,
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

export type UpsertBrandingPayload = { projected: TenantBrandingRow; isCreate: boolean };

export async function upsertBranding(ctx: RequestContext, body: UpsertBrandingBody): Promise<Accepted> {
  const messageId = randomUUID();
  const existing = await repo.findRowByTenant(ctx.tenantId);
  const { projected, isCreate } = projectBranding(ctx.tenantId, ctx.actorId, existing, stripUndefined(body) as Partial<TenantBrandingRow>);

  await cache.put(cache.makeKey(ctx.tenantId, RESOURCE, projected.id), projected);
  await queue.publish(COMMANDS.upsertBranding, {
    messageId,
    type: COMMANDS.upsertBranding,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { projected, isCreate } satisfies UpsertBrandingPayload,
  });

  return { id: projected.id, status: "accepted", correlationId: ctx.correlationId };
}
