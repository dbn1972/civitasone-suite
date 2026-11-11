/**
 * S8 G7: receive project cost TOTALS from payroll (payroll.project_cost.posted).
 *
 * The payload is aggregates by (project, cost month): there is no employee id
 * and no per-person amount in it, and this table has no column that could hold
 * one. That is the structural half of "a project manager never sees individual
 * pay" - the data is not in this service to leak. Idempotent: the posting is
 * upserted by (project, cost month, kind, source), and the inbox drops
 * duplicate deliveries.
 */
import type { Queue } from "@civitasone/queue";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../shared/db.js";
import { markProcessed } from "../../shared/outbox.js";
import { tenantScoped } from "../../shared/tenant-queue.js";
import { CONSUMED_EVENTS } from "../../topics.js";

const digits = z.string().regex(/^-?\d{1,18}$/);
export const projectCostPostedPayload = z.object({
  kind: z.enum(["run", "reclass"]),
  sourceId: z.string().uuid(),
  postings: z.array(z.object({
    projectId: z.string().uuid(),
    costMonth: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
    grossMinor: digits, employerCostMinor: digits, totalCostMinor: digits,
    headcount: z.number().int().min(0),
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
        await tx.execute(sql`
          INSERT INTO project.project_staff_cost_postings
            (tenant_id, project_id, cost_month, kind, source_id, gross_minor, employer_cost_minor, total_cost_minor, headcount)
          VALUES (${msg.tenantId}::uuid, ${x.projectId}::uuid, ${x.costMonth}, ${p.kind}, ${p.sourceId}::uuid,
                  ${x.grossMinor}::bigint, ${x.employerCostMinor}::bigint, ${x.totalCostMinor}::bigint, ${x.headcount})
          ON CONFLICT (tenant_id, project_id, cost_month, kind, source_id) DO UPDATE
            SET gross_minor = EXCLUDED.gross_minor, employer_cost_minor = EXCLUDED.employer_cost_minor,
                total_cost_minor = EXCLUDED.total_cost_minor, headcount = EXCLUDED.headcount, received_at = now()`);
      }
    });
  });
}
