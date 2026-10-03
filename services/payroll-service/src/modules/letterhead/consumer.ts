/** Letterhead upsert consumer: inbox dedup -> upsert -> outbox event + audit, one transaction. */
import type { Queue } from "@civitasone/queue";
import { sql } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import type { LetterheadInput } from "./routes.js";

const AUDIT = "audit.event.record";

export function registerLetterheadConsumers(queue: Queue): void {
  queue.subscribe(COMMANDS.letterheadUpsert, async (msg) => {
    const p = msg.payload as LetterheadInput & { tenantId: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const prev = (await tx.execute(sql`
        SELECT org_name, ddo_code FROM payroll.payroll_letterhead WHERE tenant_id = ${p.tenantId}::uuid FOR UPDATE
      `)) as unknown as Array<{ org_name: string; ddo_code: string | null }>;
      await tx.execute(sql`
        INSERT INTO payroll.payroll_letterhead
          (tenant_id, org_name, department, ddo_name, ddo_code, address, signatory_title, show_signature_block, updated_by)
        VALUES (${p.tenantId}::uuid, ${p.orgName}, ${p.department}, ${p.ddoName}, ${p.ddoCode},
                ${p.address}, ${p.signatoryTitle}, ${p.showSignatureBlock}, ${msg.actorId}::uuid)
        ON CONFLICT (tenant_id) DO UPDATE SET
          org_name = EXCLUDED.org_name, department = EXCLUDED.department, ddo_name = EXCLUDED.ddo_name,
          ddo_code = EXCLUDED.ddo_code, address = EXCLUDED.address, signatory_title = EXCLUDED.signatory_title,
          show_signature_block = EXCLUDED.show_signature_block, updated_at = now(), updated_by = EXCLUDED.updated_by,
          version = payroll.payroll_letterhead.version + 1
      `);
      await enqueue(tx, {
        topic: EVENTS.letterheadUpserted, eventType: EVENTS.letterheadUpserted,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { orgName: p.orgName },
      });
      await enqueue(tx, {
        topic: AUDIT, eventType: AUDIT,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: {
          service: "payroll", action: prev[0] ? "update" : "create", resourceType: "payroll_letterhead", resourceId: p.tenantId,
          outcome: "success",
          detail: { orgName: p.orgName, ddoCode: p.ddoCode, showSignatureBlock: p.showSignatureBlock, previousOrgName: prev[0]?.org_name ?? null },
        },
      });
    });
  });
}
