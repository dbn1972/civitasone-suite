import { PermissionDenied } from "../PermissionDenied";
import { RefreshErrorState } from "./RefreshErrorState";
import { toHumanError } from "@/lib/messages";
import type { LoaderResult } from "@/app/_data/apiClient";

export interface LoadErrorStateProps {
  /**
   * The failed `fetchJson()` loader's result (or just the `status` /
   * `errorMessage` slice of it). Only these two fields are read.
   */
  result: Pick<LoaderResult<unknown>, "status" | "errorMessage">;
  /** Plain noun for the generic "couldn't load X, try again" copy (toHumanError's `area`). */
  area: string;
  /** Where "Go back" should navigate for a genuine transient failure. */
  backHref?: string;
  /** Overrides `PermissionDenied`'s `module` copy for the fallback (no backend reason) case; defaults to `area`. */
  module?: string;
  /**
   * A static required-roles list for pages that already know one (a plain
   * role-gate 403). Only used as a fallback when the backend didn't send its
   * own `errorMessage` — a live, request-specific reason is always more
   * accurate than a hardcoded guess (e.g. an ownership-scoped 403 like
   * "managers may only view their own direct reports' records" has no
   * fixed roles list at all).
   */
  requiredRoles?: string[];
}

/**
 * Renders the right failure state for a failed `fetchJson()` loader call.
 *
 * Before this existed, every one of these pages collapsed EVERY failure —
 * network error, 5xx, timeout, AND a 403 authorization boundary — into the
 * same `source === "error"` boolean, and rendered the same generic
 * "Couldn't load — showing nothing. This is usually temporary — try again"
 * message with a retry button for all of them. That's actively wrong for a
 * 403: retrying a permanent authorization decision can never succeed. See
 * docs/BACKLOG.md's UX-01x screen-by-screen finding (hr/employees/[id],
 * hr/transfer, hr/promotion, hr/dpc, hr/service-book, hr/succession).
 *
 * A 403 gets the same honest "Access restricted" treatment the codebase
 * already uses elsewhere for role-gated pages (`PermissionDenied`) — but
 * fed from the backend's own live response instead of a hardcoded guess,
 * since some of these routes reject on a static role check and others on a
 * per-record ownership check (e.g. "not one of your direct reports") that
 * only the backend can actually evaluate. Every other failure still gets
 * the existing generic retry copy unchanged.
 */
export function LoadErrorState({ result, area, backHref, module, requiredRoles }: LoadErrorStateProps) {
  if (result.status === 403) {
    return (
      <PermissionDenied
        module={module ?? area}
        reason={result.errorMessage}
        requiredRoles={result.errorMessage ? undefined : requiredRoles}
      />
    );
  }
  return <RefreshErrorState error={toHumanError("load", { area })} backHref={backHref} />;
}
