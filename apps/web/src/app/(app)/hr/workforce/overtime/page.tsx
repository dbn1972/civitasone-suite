import { redirect } from "next/navigation";

/**
 * /hr/workforce/overtime is the orphaned duplicate of /hr/overtime.
 *
 * Audit (HRMS peripheral medium findings, item 1): seven duplicate
 * `/hr/workforce/*` <-> `/hr/*` page pairs exist under this directory.
 * /hr/overtime is the canonical page: the HR hub (apps/web/src/app/(app)/hr/
 * page.tsx, "Leave" category) links it directly as `{ title: t("overtime"),
 * href: "/hr/overtime" }`, and it was the more recently maintained of the
 * pair -- PR #1554 (overtime approve/reject state-reversal guard + the
 * "overtime page fabricated stats" fix, 2026-09-24 23:47) touched only the
 * canonical page, after the blanket #1548 WCAG sweep that is the orphan's
 * only other history. /hr/workforce/overtime has zero inbound links
 * anywhere in the repo except its own OvertimeClaimForm sub-component (see
 * hr/workforce/overtime/new/page.tsx, redirected separately alongside this
 * page for the same reason).
 *
 * Redirecting, not deleting, mirrors the /hr/appraisals -> /hr/apar
 * precedent (PR #1571): the smaller, safer fix that closes the "two
 * disconnected screens" gap without touching backend data or route history.
 */
export default function WorkforceOvertimePageRedirect() {
  redirect("/hr/overtime");
}
