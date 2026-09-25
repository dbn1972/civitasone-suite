import { redirect } from "next/navigation";

/**
 * /hr/workforce/overtime/new is the orphaned duplicate of /hr/overtime/new.
 *
 * Audit (HRMS peripheral medium findings, item 1): this sub-route renders
 * OvertimeClaimForm, which collects two extra fields the canonical
 * /hr/overtime/new form does not -- a duty-officer/approver picker and a
 * cash-vs-comp-off toggle. Investigated before redirecting (per the audit's
 * instruction not to silently drop real functionality): the POST body both
 * forms send goes to the same endpoint (POST /v1/hrms/overtime-requests),
 * whose Zod schema (services/hrms-service/src/modules/attendance/routes.ts)
 * accepts only { employeeId, requestDate, hoursRequested, reason }, and the
 * hrms_overtime_requests table (attendance/schema.ts) has no column for an
 * approver or a compensation mode. Those two extra fields are sent but
 * silently dropped -- they were never real functionality to preserve, so
 * this is a genuine duplicate, not a case of redirecting away working
 * behavior. OvertimeClaimForm becomes unreferenced dead code as a result
 * (left in place, untouched, same as the appraisals module's backend was
 * left untouched by PR #1571 -- out of scope for a frontend routing fix).
 *
 * /hr/overtime/new is otherwise equivalent (same endpoint, same required
 * fields, its own client-side hours>0 guard mirrored by the HTML
 * min="0.5" input) and is the one reachable from the canonical /hr/overtime
 * page's "New Request" button.
 */
export default function WorkforceOvertimeNewPageRedirect() {
  redirect("/hr/overtime/new");
}
