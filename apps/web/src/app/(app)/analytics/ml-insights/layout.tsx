import type { ReactNode } from "react";
import { requireAnyRole, ML_INSIGHTS_READ_ROLES } from "@/lib/auth/roleGuard";

/**
 * GAP2-ANALYTICS-MLINSIGHTS-01: the ML Insights pages live under the
 * /analytics layout (any analytics reader can reach them), but the backing
 * endpoint GET /v1/ml/evaluations only admits ml-service's EVALUATION_ROLES
 * (ml_admin / analytics_admin / super_admin). A plain analytics_user /
 * analytics_viewer who followed the hub's "ML Insights" tile therefore hit a
 * 403 and the page rendered a generic "couldn't load" error with no
 * explanation of the role needed.
 *
 * This route-level gate (mirroring the server set) redirects an unauthorised
 * analytics reader to the dashboard — PermissionDenied-style — BEFORE any
 * fetch, instead of leaving them on a misleading load error. The hub also
 * hides the ML Insights tile for the same roles (analytics/page.tsx). The
 * ml-service remains the authority.
 */
export default function MLInsightsLayout({ children }: { children: ReactNode }) {
  requireAnyRole(ML_INSIGHTS_READ_ROLES);
  return <>{children}</>;
}
