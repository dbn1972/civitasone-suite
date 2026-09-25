import { redirect } from "next/navigation";

/**
 * /hr/workforce/wfh is the orphaned duplicate of /hr/wfh.
 *
 * Audit (HRMS peripheral medium findings, item 1): seven duplicate
 * `/hr/workforce/*` <-> `/hr/*` page pairs exist under this directory.
 * /hr/wfh is the canonical page: the HR hub (apps/web/src/app/(app)/hr/
 * page.tsx, "Attendance & Time" category) links it directly as
 * `{ title: t("wfhRequests"), href: "/hr/wfh" }`. /hr/workforce/wfh has
 * zero inbound links anywhere in the repo.
 *
 * This was the pair with the actual "broken button": WFHRequestForm's
 * `redirectHref` prop used to default to "/hr/workforce/wfh" -- a page
 * role-gated to hr_admin/hr_officer/manager/super_admin, excluding a plain
 * `employee` submitter entirely (see WFHRequestForm.tsx's own history
 * comment). /hr/wfh already fixes this for its own embedding by passing
 * redirectHref="/hr/wfh" explicitly; this change (a) redirects the orphan
 * page itself and (b) repoints WFHRequestForm's *default* at the canonical
 * route too, so the bug can't resurface for a future caller that forgets
 * to override the prop.
 *
 * Redirecting, not deleting, mirrors the /hr/appraisals -> /hr/apar
 * precedent (PR #1571): the smaller, safer fix that closes the "two
 * disconnected screens" gap without touching backend data or route history.
 */
export default function WorkforceWfhPageRedirect() {
  redirect("/hr/wfh");
}
