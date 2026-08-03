import type { Queue } from "@civitasone/queue";
import { pino } from "pino";
import { and, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS } from "../../topics.js";
import * as repo from "./repo.js";
import { complianceControls, controlEvidence, vaptScans } from "./schema.js";

const log = pino({ name: "security-compliance-consumer" });
const AUDIT = "audit.event.record";

const BASELINE: Array<{ controlKey: string; framework: string; title: string; description: string }> = [
  { controlKey: "CC6.1", framework: "SOC2", title: "Logical Access Controls", description: "Row-level security + RBAC enforce least-privilege access." },
  { controlKey: "CC6.6", framework: "SOC2", title: "Encryption at Rest", description: "PII columns encrypted (AES-256-GCM)." },
  { controlKey: "CC6.7", framework: "SOC2", title: "Encryption in Transit", description: "TLS enforced at the gateway; HSTS on responses." },
  { controlKey: "CC7.2", framework: "SOC2", title: "System Monitoring", description: "Structured logs, traces and metrics on all services." },
  { controlKey: "CC7.3", framework: "SOC2", title: "Change Management", description: "PR workflow with CI gates (typecheck/lint/test/coverage)." },
  { controlKey: "CC8.1", framework: "SOC2", title: "Vulnerability Management", description: "VAPT report ingestion + dependency audit in CI." },
  { controlKey: "A.9.2.1", framework: "ISO27001", title: "User Registration & De-registration", description: "SCIM lifecycle with deprovisioning." },
  { controlKey: "A.12.4.1", framework: "ISO27001", title: "Event Logging", description: "Tamper-evident audit event stream." },
  { controlKey: "DPDP-7", framework: "DPDP", title: "Reasonable Security Safeguards", description: "§8(5) safeguards to prevent personal data breach." },
  { controlKey: "DPDP-8", framework: "DPDP", title: "Breach Notification", description: "§8(6) notify the Board and affected data principals." },
];

async function audit(tx: Parameters<typeof enqueue>[0], msg: { tenantId: string; actorId: string; correlationId: string }, action: string, resourceType: string, resourceId: string) {
  await enqueue(tx, {
    topic: AUDIT, eventType: AUDIT, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
    payload: { service: "admin", action, resourceType, resourceId, outcome: "success" },
  });
}

/**
 * VAPT scan consumer + compliance control writes.
 * NOTE: vapt_scans / compliance tables are FORCE-RLS; register via tenant-scoped queue.
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

  q.subscribe(COMMANDS.vaptReportIngest, async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string; targetServices: string[]; scanType: string;
      critical: number; high: number; medium: number; low: number;
    };
    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        const findings = p.critical + p.high + p.medium + p.low;
        await tx.insert(vaptScans).values({
          id: p.id, tenantId: p.tenantId, targetServices: p.targetServices, scanType: p.scanType,
          status: "completed", findingsCount: findings, critical: p.critical, high: p.high,
          medium: p.medium, low: p.low, startedAt: new Date(), completedAt: new Date(), createdBy: msg.actorId,
        });
        await audit(tx, msg, "vapt_report_ingested", "vapt_scan", p.id);
      });
    } catch (err) { log.error({ err, messageId: msg.messageId }, "vaptReportIngest failed"); throw err; }
  });

  q.subscribe(COMMANDS.complianceControlsSeed, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string };
    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        const existing = await tx.select({ k: complianceControls.controlKey, f: complianceControls.framework })
          .from(complianceControls).where(eq(complianceControls.tenantId, p.tenantId));
        const seen = new Set(existing.map((r) => `${r.f}:${r.k}`));
        for (const b of BASELINE.filter((x) => !seen.has(`${x.framework}:${x.controlKey}`))) {
          await tx.insert(complianceControls).values({
            id: randomUUID(), tenantId: p.tenantId, controlKey: b.controlKey, framework: b.framework,
            title: b.title, description: b.description, status: "not_tested",
            createdBy: msg.actorId, updatedBy: msg.actorId,
          });
        }
        await audit(tx, msg, "seed_controls", "compliance_control", p.tenantId);
      });
    } catch (err) { log.error({ err, messageId: msg.messageId }, "complianceControlsSeed failed"); throw err; }
  });

  q.subscribe(COMMANDS.complianceControlCreate, async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string; controlKey: string; framework: string;
      title: string; description?: string; owner?: string;
    };
    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        await tx.insert(complianceControls).values({
          id: p.id, tenantId: p.tenantId, controlKey: p.controlKey, framework: p.framework,
          title: p.title, description: p.description ?? null, owner: p.owner ?? null,
          status: "not_tested", createdBy: msg.actorId, updatedBy: msg.actorId,
        });
        await audit(tx, msg, "create_control", "compliance_control", p.id);
      });
    } catch (err) { log.error({ err, messageId: msg.messageId }, "complianceControlCreate failed"); throw err; }
  });

  q.subscribe(COMMANDS.complianceControlUpdate, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; status?: string; owner?: string };
    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        const ctrl = await repo.findControlTx(tx, p.tenantId, p.id);
        if (!ctrl) return;
        const patch: Record<string, unknown> = { updatedAt: new Date(), updatedBy: msg.actorId, version: ctrl.version + 1 };
        if (p.owner !== undefined) patch.owner = p.owner;
        if (p.status !== undefined) {
          patch.status = p.status;
          if (p.status === "pass" || p.status === "fail") patch.lastTestedAt = new Date();
        }
        await tx.update(complianceControls).set(patch).where(and(eq(complianceControls.tenantId, p.tenantId), eq(complianceControls.id, p.id)));
        await audit(tx, msg, "test_control", "compliance_control", p.id);
      });
    } catch (err) { log.error({ err, messageId: msg.messageId }, "complianceControlUpdate failed"); throw err; }
  });

  q.subscribe(COMMANDS.complianceEvidenceAttach, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; controlId: string; kind: string; reference?: string; note?: string };
    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        const ctrl = await repo.findControlTx(tx, p.tenantId, p.controlId);
        if (!ctrl) return;
        await tx.insert(controlEvidence).values({
          id: p.id, tenantId: p.tenantId, controlId: p.controlId, kind: p.kind,
          reference: p.reference ?? null, note: p.note ?? null, createdBy: msg.actorId,
        });
        await audit(tx, msg, "attach_evidence", "compliance_control", p.controlId);
      });
    } catch (err) { log.error({ err, messageId: msg.messageId }, "complianceEvidenceAttach failed"); throw err; }
  });
}
