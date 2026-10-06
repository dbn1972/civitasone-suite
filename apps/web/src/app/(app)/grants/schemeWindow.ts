/**
 * Pure helpers for a grant scheme's application window. No server-only imports,
 * so both the (server) scheme detail page and the (client) apply form can use
 * them. The grant-service remains the authority on whether an application is
 * actually accepted; these only drive honest UI (GAP-GRANTS-SCHEMES-DETAIL-05 /
 * GAP-GRANTS-SCHEMES-DETAIL-APPLY-03).
 */

export type SchemeWindow = {
  status: string;
  openAt?: string | null;
  closeAt?: string | null;
};

export type WindowState =
  | { accepting: true }
  | { accepting: false; reason: "not-open" | "before-open" | "after-close"; at?: string | null };

/**
 * Whether the scheme is currently accepting applications: it must be "open"
 * AND (if a window is set) `now` must be within [openAt, closeAt]. Window edges
 * are compared as instants; a bare date is treated as midnight UTC which is the
 * same ordering the backend uses.
 */
export function schemeWindowState(scheme: SchemeWindow, now: Date = new Date()): WindowState {
  if (scheme.status !== "open") return { accepting: false, reason: "not-open" };
  const nowMs = now.getTime();
  if (scheme.openAt) {
    const openMs = new Date(scheme.openAt).getTime();
    if (Number.isFinite(openMs) && nowMs < openMs) {
      return { accepting: false, reason: "before-open", at: scheme.openAt };
    }
  }
  if (scheme.closeAt) {
    const closeMs = new Date(scheme.closeAt).getTime();
    if (Number.isFinite(closeMs) && nowMs > closeMs) {
      return { accepting: false, reason: "after-close", at: scheme.closeAt };
    }
  }
  return { accepting: true };
}

export function isAcceptingApplications(scheme: SchemeWindow, now: Date = new Date()): boolean {
  return schemeWindowState(scheme, now).accepting;
}
