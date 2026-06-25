/**
 * Dashboard access control — pure decision functions (no I/O), so they are
 * exhaustively unit-testable. Two independent gates:
 *
 *   1. TENANT ISOLATION: a dashboard from another tenant is invisible, full
 *      stop — even to an admin. This mirrors the always-on tenant predicate in
 *      the query builder; defence in depth.
 *   2. OWNERSHIP / SHARING: within a tenant, the owner has full control; admins
 *      can view/manage; other users get the access explicitly granted via a
 *      share row (view | edit) and only when visibility is 'shared'.
 */
import { hasAnyRole } from "@civitasone/auth";
import type { RequestContext } from "@civitasone/types";
import type { DashboardView, ShareView } from "./schema.js";

export const ADMIN_ROLES = ["analytics_admin", "super_admin"];

function sameTenant(ctx: RequestContext, d: Pick<DashboardView, "tenantId">): boolean {
  return d.tenantId === ctx.tenantId;
}

function isOwner(ctx: RequestContext, d: Pick<DashboardView, "ownerId">): boolean {
  return !!d.ownerId && d.ownerId === ctx.actorId;
}

function shareFor(ctx: RequestContext, shares: ShareView[]): ShareView | undefined {
  return shares.find((s) => s.principalId === ctx.actorId);
}

export function canView(ctx: RequestContext, d: DashboardView, shares: ShareView[] = []): boolean {
  if (!sameTenant(ctx, d)) return false;
  if (isOwner(ctx, d)) return true;
  if (hasAnyRole(ctx, ADMIN_ROLES)) return true;
  if (d.visibility === "shared" && shareFor(ctx, shares)) return true;
  return false;
}

export function canEdit(ctx: RequestContext, d: DashboardView, shares: ShareView[] = []): boolean {
  if (!sameTenant(ctx, d)) return false;
  if (isOwner(ctx, d)) return true;
  if (hasAnyRole(ctx, ADMIN_ROLES)) return true;
  const share = shareFor(ctx, shares);
  return d.visibility === "shared" && share?.access === "edit";
}

/** Only the owner or an admin may change sharing/visibility. */
export function canShare(ctx: RequestContext, d: DashboardView): boolean {
  if (!sameTenant(ctx, d)) return false;
  return isOwner(ctx, d) || hasAnyRole(ctx, ADMIN_ROLES);
}
