import type { Queue } from "@civitasone/queue";
import { pino } from "pino";
import { db } from "../../shared/db.js";
import { markProcessed } from "../../shared/outbox.js";
import { vaptScans } from "./schema.js";

const log = pino({ name: "security-compliance-consumer" });

/**
 * VAPT scan consumer. An internally-queued scan is recorded as `running` then
 * left for a real external scanner (Trivy / OWASP ZAP) to post findings back
 * via POST /v1/admin/security/vapt/reports. We do NOT fabricate findings — the
 * scan sits `running` until a genuine report is ingested. (Incident lifecycle
 * now lives in the dedicated CAP-090 security-incident module.)
 *
 * NOTE: vapt_scans is FORCE-RLS; register this via a tenant-scoped queue (see
 * worker.ts) so the message tenant establishes the app.tenant_id GUC.
 */
export function registerSecurityComplianceConsumers(q: Queue): void {
  q.subscribe("admin.vapt.scan", async (msg: { messageId: string; actorId: string; payload: { id: string; tenantId: string; targetServices: string[]; scanType: string } }) => {
    const p = msg.payload;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await tx.insert(vaptScans).values({
        id: p.id, tenantId: p.tenantId, targetServices: p.targetServices,
        scanType: p.scanType, status: "running", startedAt: new Date(), createdBy: msg.actorId,
      }).onConflictDoNothing();
      log.info({ scanId: p.id, services: p.targetServices.length, type: p.scanType }, "VAPT scan queued; awaiting external report ingestion");
    });
  });
}
