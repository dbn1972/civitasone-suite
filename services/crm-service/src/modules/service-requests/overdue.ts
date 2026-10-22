/**
 * GAP-CRM-SERVICE-REQUESTS-03 -- the single definition of "overdue" for service
 * requests, shared by the register list and its audited CSV export so the two can
 * never disagree about which rows an `overdue=true` filter keeps.
 *
 * A request is overdue when it has a due date in the past AND is still workable
 * (open / in_progress / pending). A resolved, closed or cancelled request is never
 * overdue however old its due date, and a request with no due date never is.
 */
import { z } from "zod";
import { sql } from "drizzle-orm";

/** Query flag: accepts true/1/false/0, anything else is a 400; absent means "not filtered". */
export const overdueFlag = z
  .enum(["true", "1", "false", "0"])
  .optional()
  .transform((v) => v === "true" || v === "1");

/** SQL predicate (alias `r` = crm.service_requests) keeping only overdue, workable requests. */
export function overdueClause() {
  return sql`AND r.due_at IS NOT NULL AND r.due_at < now() AND r.status IN ('open', 'in_progress', 'pending')`;
}
