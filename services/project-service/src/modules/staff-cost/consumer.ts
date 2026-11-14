/**
 * S8 G7: receive project cost TOTALS from payroll (payroll.project_cost.posted).
 *
 * The payload is one aggregate snapshot per (project, cost month): there is no employee id
 * and no per-person amount in it, and this table has no column that could hold
 * one. That is the structural half of "a project manager never sees individual
 * pay" - the data is not in this service to leak. Idempotent: the snapshot is
 * upserted by (project, cost month) and ignored when older than the stored one,
 * and the inbox drops duplicate deliveries.
 */
import type { Queue } from "@civitasone/queue";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../shared/db.js";
import { markProcessed } from "../../shared/outbox.js";
import { tenantScoped } from "../../shared/tenant-queue.js";
import { CONSUMED_EVENTS } from "../../topics.js";

const digits = z.string().regex(/^-?\d{1,18}$/);
/** One absolute snapshot per (project, cost month): totals and a head COUNT. No employee id can be in it. */
export const projectCostPostedPayload = z.object({
  asOf: z.string().datetime(),
  minCohort: z.number().int().min(2),
  postings: z.array(z.object({
    projectId: z.string().uuid(),
    costMonth: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
    grossMinor: digits, employerCostMinor: digits, totalCostMinor: digits,
    cohort: z.number().int().min(0),
  }).strict().refine((x) => BigInt(x.totalCostMinor) === BigInt(x.grossMinor) + BigInt(x.employerCostMinor), "total must equal gross + employer")),
}).strict();

export function registerStaffCostConsumers(queue: Queue): void {
  queue = tenantScoped(queue);
  queue.subscribe(CONSUMED_EVENTS.projectCostPosted, async (msg) => {
    const parsed = projectCostPostedPayload.safeParse(msg.payload);
    if (!parsed.success) return; // not ours / malformed: nothing to store, never throw a poison message back
    const p = parsed.data;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      for (const x of p.postings) {
        // a snapshot replaces the previous one, unless it is older than what is stored (out-of-order delivery)
        await tx.execute(sql`
          INSERT INTO project.project_staff_cost_postings
            (tenant_id, project_id, cost_month, gross_minor, employer_cost_minor, total_cost_minor, cohort, min_cohort, as_of)
          VALUES (${msg.tenantId}::uuid, ${x.projectId}::uuid, ${x.costMonth}, ${x.grossMinor}::bigint, ${x.employerCostMinor}::bigint,
                  ${x.totalCostMinor}::bigint, ${x.cohort}, ${p.minCohort}, ${p.asOf}::timestamptz)
          ON CONFLICT (tenant_id, project_id, cost_month) DO UPDATE
            SET gross_minor = EXCLUDED.gross_minor, employer_cost_minor = EXCLUDED.employer_cost_minor,
                total_cost_minor = EXCLUDED.total_cost_minor, cohort = EXCLUDED.cohort, min_cohort = EXCLUDED.min_cohort,
                as_of = EXCLUDED.as_of, received_at = now()
            WHERE project.project_staff_cost_postings.as_of <= EXCLUDED.as_of`);
      }
    });
  });
}
