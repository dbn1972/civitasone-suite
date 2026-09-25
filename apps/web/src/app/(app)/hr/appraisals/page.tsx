import { redirect } from "next/navigation";

/**
 * /hr/appraisals is the orphaned predecessor of /hr/apar.
 *
 * Audit (HRMS peripheral high-findings, item 3): two independent, unlinked
 * "Appraisals" screens existed. /hr/apar is the real, currently-maintained
 * one -- the HR hub's "Appraisals" nav card links there (see
 * apps/web/src/app/(app)/hr/page.tsx: `{ title: t("appraisals"), href:
 * "/hr/apar", ... }`), it implements the actual multi-stage SPARROW/APAR
 * government workflow (self-appraisal -> Reporting Officer -> Reviewing
 * Authority -> Accepting Authority, with disclosure and representation), and
 * it carries a defense-in-depth role gate mirroring the backend's own
 * ACTOR_ROLES. /hr/appraisals had zero inbound links anywhere in the app
 * (grepped the whole apps/web/src tree -- only its own /new sub-route links
 * to it), no role gate at all, and a status model (pending/in_review/
 * completed) that predates and is narrower than the vocabulary
 * migrations/0017_apar_workflow.sql widened the SAME underlying
 * appraisal.hrms_appraisals row's status column to support -- so a manager
 * landing here via a stale link or bookmark would see an incomplete, stale
 * picture of a real appraisal that has since moved into APAR's richer
 * pipeline.
 *
 * The backend module (routes.ts + feedback-routes.ts, still registered in
 * services/hrms-service/src/app.ts) and its data model are deliberately left
 * untouched: /hr/apar's supplementary tables (hrms_apar_scores,
 * hrms_apar_stage_history, in modules/apar/schema.ts) reference the SAME
 * core appraisal.hrms_appraisals rows this module owns (modules/appraisals/
 * schema.ts), so there is no unique data path stranded behind this redirect
 * -- and ruling out every non-web consumer of the raw API (mobile, reports,
 * the 360-feedback/calibration/bell-curve/rating-appeal tables neither web
 * page surfaces) is out of scope for what should be the smaller, safer of
 * the two fixes on offer here. A frontend-only redirect closes the
 * "two disconnected screens" gap without touching data.
 */
export default function AppraisalsPageRedirect() {
  redirect("/hr/apar");
}
