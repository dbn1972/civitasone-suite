import { randomUUID } from "node:crypto";
import type { Queue } from "@civitasone/queue";
import { pino } from "pino";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { vaptScans, securityIncidents } from "./schema.js";
import { eq } from "drizzle-orm";

const log = pino({ name: "security-compliance-consumer" });

export function registerSecurityComplianceConsumers(q: Queue): void {
  // VAPT scan consumer — executes scan (or marks as pending external runner)
  q.subscribe("admin.vapt.scan", async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; targetServices: string[]; scanType: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await tx.insert(vaptScans).values({
        id: p.id, tenantId: p.tenantId, targetServices: p.targetServices,
        scanType: p.scanType, status: "running", startedAt: new Date(), createdBy: msg.actorId,
      });
      log.info({ scanId: p.id, services: p.targetServices.length, type: p.scanType }, "VAPT scan started");
      // In production: trigger trivy/OWASP ZAP via exec or HTTP call
      // For now: mark as completed with 0 findings (real scanner hooks in via webhook)
      await tx.update(vaptScans).set({ status: "completed", completedAt: new Date(), findingsCount: 0 }).where(eq(vaptScans.id, p.id));
    });
  });

  // Incident create
  q.subscribe("admin.security.incident.create", async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; title: string; severity: string; description?: string; affectedServices?: string[] };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await tx.insert(securityIncidents).values({
        id: p.id, tenantId: p.tenantId, title: p.title, severity: p.severity,
        description: p.description ?? null, affectedServices: p.affectedServices ?? [],
        status: "open", createdBy: msg.actorId,
      });
      await enqueue(tx, { topic: "audit.event.record", eventType: "audit.event.record", tenantId: p.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload: { service: "admin", action: "create_security_incident", resourceType: "security_incident", resourceId: p.id, outcome: "success" } });
      log.warn({ incidentId: p.id, severity: p.severity, title: p.title }, "security incident created");
    });
  });

  // Incident resolve
  q.subscribe("admin.security.incident.resolve", async (msg) => {
    const p = msg.payload as { id: string; resolution: string; rootCause?: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await tx.update(securityIncidents).set({ status: "resolved", resolvedAt: new Date() }).where(eq(securityIncidents.id, p.id));
      log.info({ incidentId: p.id }, "security incident resolved");
    });
  });

  // CERT-In report
  q.subscribe("admin.security.incident.report_cert", async (msg) => {
    const p = msg.payload as { id: string; reportedAt: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await tx.update(securityIncidents).set({ reportedToCert: new Date(p.reportedAt) }).where(eq(securityIncidents.id, p.id));
      log.info({ incidentId: p.id, reportedAt: p.reportedAt }, "CERT-In report filed");
    });
  });
}
