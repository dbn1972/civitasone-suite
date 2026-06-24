import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue, cache } from "../../shared/infra.js";
import { COMMANDS, RESOURCE } from "../../topics.js";
import { hasAnyRole } from "@civitasone/auth";
import { HttpError } from "../../shared/context.js";
import {
  createExportBody, MAX_EXPORT_WINDOW_DAYS, PII_EXPORT_ROLES,
} from "./validators.js";
import { z } from "zod";

export type Accepted = { id: string; status: string; correlationId: string };
type CreateExportBody = z.infer<typeof createExportBody>;

export async function requestExport(ctx: RequestContext, body: CreateExportBody): Promise<Accepted> {
  const from = new Date(body.from);
  const to = new Date(body.to);

  // P1-5: validate + cap the export window before accepting.
  if (to.getTime() <= from.getTime()) {
    throw new HttpError(400, "INVALID_WINDOW", "'to' must be after 'from'");
  }
  const windowDays = (to.getTime() - from.getTime()) / 86_400_000;
  if (windowDays > MAX_EXPORT_WINDOW_DAYS) {
    throw new HttpError(422, "WINDOW_TOO_LARGE", `export window ${Math.ceil(windowDays)}d exceeds max ${MAX_EXPORT_WINDOW_DAYS}d`);
  }

  // P1-5: bulk PII export restricted to audit_admin+.
  if (body.includePii && !hasAnyRole(ctx, PII_EXPORT_ROLES)) {
    throw new HttpError(403, "PII_EXPORT_FORBIDDEN", `bulk PII export requires one of: ${PII_EXPORT_ROLES.join(", ")}`);
  }

  const id = randomUUID();
  await queue.publish(COMMANDS.exportCreate, {
    messageId: id,
    type: COMMANDS.exportCreate,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: {
      id, tenantId: ctx.tenantId, from: body.from, to: body.to, format: body.format,
      includePii: body.includePii, roles: ctx.roles,
    },
  });
  await cache.put(cache.makeKey(ctx.tenantId, RESOURCE.export, id), {
    id, status: "pending", format: body.format, periodFrom: body.from, periodTo: body.to,
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}
