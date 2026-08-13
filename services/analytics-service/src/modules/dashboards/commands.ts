/**
 * dashboards command handlers (WRITE PATH).
 * Access control is enforced synchronously here (read current state → decide);
 * the durable write + optimistic version CAS happen in the consumer.
 */
import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue, cache } from "../../shared/infra.js";
import { COMMANDS, DASHBOARD_RESOURCE } from "../../topics.js";
import { HttpError } from "../../shared/context.js";
import * as repo from "./repo.js";
import { canEdit, canShare } from "./access.js";
import type {
  CreateDashboardBody,
  UpdateDashboardBody,
  AddWidgetBody,
  ShareDashboardBody,
} from "./validators.js";
import type { DashboardView } from "./schema.js";

export type Accepted = { id: string; status: string; correlationId: string };

function publish(ctx: RequestContext, type: string, id: string, payload: Record<string, unknown>) {
  return queue.publish(type, {
    messageId: id,
    type,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload,
  });
}

async function loadOr404(ctx: RequestContext, id: string): Promise<DashboardView> {
  const d = await repo.findById(id, ctx.tenantId);
  if (!d) throw new HttpError(404, "NOT_FOUND", "dashboard not found");
  return d;
}

export async function createDashboard(ctx: RequestContext, body: CreateDashboardBody): Promise<Accepted> {
  const id = randomUUID();
  const projected: DashboardView = {
    id,
    tenantId: ctx.tenantId,
    name: body.name,
    description: body.description ?? null,
    status: "active",
    ownerId: ctx.actorId,
    visibility: body.visibility,
    layout: body.layout,
    version: 1,
  };
  await cache.put(cache.makeKey(ctx.tenantId, DASHBOARD_RESOURCE, id), projected);
  await publish(ctx, COMMANDS.createDashboard, id, { ...projected });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function updateDashboard(
  ctx: RequestContext,
  id: string,
  body: UpdateDashboardBody,
): Promise<Accepted> {
  const current = await loadOr404(ctx, id);
  const shares = await repo.listShares(id, ctx.tenantId);
  if (!canEdit(ctx, current, shares)) {
    throw new HttpError(403, "FORBIDDEN", "you do not have edit access to this dashboard");
  }
  await publish(ctx, COMMANDS.updateDashboard, randomUUID(), {
    dashboardId: id,
    expectedVersion: body.expectedVersion,
    patch: {
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.description !== undefined ? { description: body.description } : {}),
      ...(body.status !== undefined ? { status: body.status } : {}),
      ...(body.visibility !== undefined ? { visibility: body.visibility } : {}),
      ...(body.layout !== undefined ? { layout: body.layout } : {}),
    },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function addWidget(ctx: RequestContext, id: string, body: AddWidgetBody): Promise<Accepted> {
  const current = await loadOr404(ctx, id);
  const shares = await repo.listShares(id, ctx.tenantId);
  if (!canEdit(ctx, current, shares)) {
    throw new HttpError(403, "FORBIDDEN", "you do not have edit access to this dashboard");
  }
  const widgetId = randomUUID();
  await publish(ctx, COMMANDS.addWidget, widgetId, {
    widgetId,
    dashboardId: id,
    title: body.title,
    vizType: body.vizType,
    spec: body.spec,
    position: body.position,
  });
  return { id: widgetId, status: "accepted", correlationId: ctx.correlationId };
}

export async function shareDashboard(
  ctx: RequestContext,
  id: string,
  body: ShareDashboardBody,
): Promise<Accepted> {
  const current = await loadOr404(ctx, id);
  if (!canShare(ctx, current)) {
    throw new HttpError(403, "FORBIDDEN", "only the owner or an admin may share this dashboard");
  }
  const shareId = randomUUID();
  await publish(ctx, COMMANDS.shareDashboard, shareId, {
    shareId,
    dashboardId: id,
    principalId: body.principalId,
    access: body.access,
  });
  return { id: shareId, status: "accepted", correlationId: ctx.correlationId };
}

export async function deleteDashboard(ctx: RequestContext, dashboardId: string): Promise<Accepted> {
  await loadOr404(ctx, dashboardId);
  await publish(ctx, COMMANDS.deleteDashboard, randomUUID(), { dashboardId });
  return { id: dashboardId, status: "accepted", correlationId: ctx.correlationId };
}
