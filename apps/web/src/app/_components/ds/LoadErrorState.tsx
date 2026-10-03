import { PermissionDenied } from "../PermissionDenied";
import { RefreshErrorState } from "./RefreshErrorState";
import { humanErrorForStatus, type HumanError } from "@/lib/messages";
import type { LoaderResult } from "@/app/_data/apiClient";

export interface LoadErrorStateProps {
  /**
   * The failed `fetchJson()` loader's result (or just the `status` /
   * `errorMessage` slice of it). `errorMessage` (the backend's own text) is never rendered; it is only forwarded to PermissionDenied, which logs it in development.
   */
  result: Pick<LoaderResult<unknown>, "status" | "errorMessage"> & { errorCode?: string };
  /** Plain noun for the generic "couldn't load X, try again" copy (toHumanError's `area`). */
  area: string;
  /**
   * Where "Go back" should navigate for a genuine transient failure -- and,
   * additively (GAP-HR-ID-CARDS-07), also threaded through to the 403
   * branch's PermissionDenied so a live access-restricted response gets the
   * same sensible destination instead of always defaulting to /dashboard.
   */
  backHref?: string;
  /** Paired with `backHref` for the 403 branch's PermissionDenied link text; ignored by the transient-failure branch. */
  backLabel?: string;
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
export function LoadErrorState({ result, area, backHref, backLabel, module }: LoadErrorStateProps) {
  if (result.status === 403) {
    return (
      <PermissionDenied
        module={module ?? area}
        reason={result.errorMessage}
        code={result.errorCode}
        {...(backHref ? { backHref } : {})}
        {...(backLabel ? { backLabel } : {})}
      />
    );
  }
  // Standard, status-aware copy (apps/web/docs/ERROR-MESSAGES.md). Retry for every
  // failure except 401 (sign in again instead) -- 403 is handled above.
  const error: HumanError = {
    ...humanErrorForStatus(result.status, { area, intent: "load", code: result.errorCode }),
    actions: result.status === 401 ? ["signin", "help"] : ["retry", "back", "help"],
  };
  return (
    <RefreshErrorState
      error={error}
      backHref={backHref}
      source={{ status: result.status, code: result.errorCode, area }}
    />
  );
}
