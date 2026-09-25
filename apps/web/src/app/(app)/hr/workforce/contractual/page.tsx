import { redirect } from "next/navigation";

/**
 * /hr/workforce/contractual is the orphaned duplicate of /hr/contractual.
 *
 * Audit (HRMS peripheral medium findings, item 1): seven duplicate
 * `/hr/workforce/*` <-> `/hr/*` page pairs exist under this directory, all
 * reachable only via the app's route manifest / direct URL entry, never via
 * any in-app control. /hr/contractual is the canonical page: the HR hub
 * (apps/web/src/app/(app)/hr/page.tsx, "Workforce" category) links it
 * directly as `{ title: t("contractual"), href: "/hr/contractual" }`.
 * /hr/workforce/contractual has zero inbound links anywhere in the repo
 * (grepped the whole tree, not just apps/web) -- nothing links, redirects,
 * or navigates here. Both pages were last touched by the same commit
 * (#1548, a blanket WCAG sweep), so recency does not distinguish them; the
 * nav-link evidence is unambiguous and consistent with the other six pairs
 * in this same audit finding.
 *
 * Redirecting, not deleting, mirrors the /hr/appraisals -> /hr/apar
 * precedent (PR #1571): the smaller, safer fix that closes the "two
 * disconnected screens" gap without touching backend data, the route's
 * history/bookmarks, or any non-web consumer of the underlying API.
 */
export default function WorkforceContractualPageRedirect() {
  redirect("/hr/contractual");
}
