import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue, cache } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import type { UpsertBrandingBody } from "./validators.js";
import type { TenantBrandingView } from "./schema.js";

export type Accepted = { id: string; status: string; correlationId: string };

const RESOURCE = "branding";

export async function upsertBranding(ctx: RequestContext, body: UpsertBrandingBody): Promise<Accepted> {
  const id = randomUUID();
  const projected: TenantBrandingView = {
    id,
    tenantId: ctx.tenantId,
    logoS3Key: body.logoS3Key ?? null,
    faviconS3Key: body.faviconS3Key ?? null,
    appName: body.appName ?? "CivitasOne",
    primaryColor: body.primaryColor ?? "#1e40af",
    accentColor: body.accentColor ?? "#f59e0b",
    footerText: body.footerText ?? null,
    version: 1,
  };

  await cache.put(cache.makeKey(ctx.tenantId, RESOURCE, id), projected);
  await queue.publish(COMMANDS.upsertBranding, {
    messageId: id,
    type: COMMANDS.upsertBranding,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: projected,
  });

  return { id, status: "accepted", correlationId: ctx.correlationId };
}
