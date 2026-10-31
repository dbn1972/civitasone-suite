/**
 * inspection-service: reports module — command consumers.
 *
 * UAT FQ9 #23: POST /v1/inspection/reports published `inspection.report.create` (202) but nothing
 * subscribed, so every report was dropped (queue_publish_no_subscribers) and the table stayed empty.
 *
 * Follows the CivitasOne CQRS consumer contract: markProcessed (idempotency) → insert → audit via the
 * outbox, all in one transaction. (Report reads are not cached, so there is nothing to invalidate.)
 *
 * UAT bundle 8 F63: submit / approve / observation.add were published by the routes (202) with no
 * subscriber, so a report could never leave `draft` and observations were never written. They are
 * handled below with the same contract (the outbox event is the audit record, as for create; no
 * new domain topics, since nothing subscribes to them yet). Invalid transitions, a missing report and a maker-checker
 * violation are NonRetryableError (dead-lettered, never retried); a redelivery that finds the report
 * already in the target state is a no-op.
 */
import { NonRetryableError, type Queue } from "@civitasone/queue";
import { and, eq, sql } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { toDomainError } from "../../shared/errors.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import {
  DomainError, OBSERVABLE_STATUSES, assertMakerCheckerForReportApproval, assertValidReportTransition, reportMakers,
} from "./domain.js";
import { inspectionReports, observations } from "./schema.js";

const AUDIT_TOPIC = "audit.event.record";
export const REPORT_CREATE_TOPIC = "inspection.report.create";
export const REPORT_SUBMIT_TOPIC = "inspection.report.submit";
export const REPORT_APPROVE_TOPIC = "inspection.report.approve";
export const REPORT_OBSERVATION_ADD_TOPIC = "inspection.report.observation.add";

export interface ReportCreatePayload {
  id: string;
  tenantId: string;
  inspectorId: string;
  inspectionId: string;
  entityId: string;
  reportType?: string | undefined;
  summary?: string | undefined;
  recommendations?: string | undefined;
  overallGrade?: string | undefined;
}

export interface ReportTransitionPayload {
  id: string;
  tenantId: string;
  approverId?: string | undefined;
}

export interface ObservationAddPayload {
  id: string;
  tenantId: string;
  reportId: string;
  category: string;
  severity: "critical" | "major" | "minor" | "observation";
  description: string;
  location?: string | undefined;
  evidenceIds?: string[] | undefined;
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function lockReport(tx: Tx, tenantId: string, id: string) {
  const rows = await tx.select().from(inspectionReports)
    .where(and(eq(inspectionReports.tenantId, tenantId), eq(inspectionReports.id, id)))
    .limit(1)
    .for("update");
  const report = rows[0];
  if (!report) throw new NonRetryableError(`Inspection report ${id} not found for tenant ${tenantId}`);
  return report;
}

export function registerReportsConsumers(queue: Queue): void {
  queue.subscribe<ReportCreatePayload>(REPORT_CREATE_TOPIC, async (msg) => {
    const p = msg.payload;

    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;

      await tx.insert(inspectionReports).values({
        id: p.id,
        tenantId: msg.tenantId,
        inspectionId: p.inspectionId,
        entityId: p.entityId,
        inspectorId: p.inspectorId,
        reportType: p.reportType ?? "standard",
        status: "draft",
        summary: p.summary ?? null,
        recommendations: p.recommendations ?? null,
        overallGrade: p.overallGrade ?? null,
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
      });

      await enqueue(tx, {
        topic: AUDIT_TOPIC,
        eventType: AUDIT_TOPIC,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: {
          action: "inspection_report.created",
          resourceType: "inspection_report",
          resourceId: p.id,
          details: { inspectionId: p.inspectionId, entityId: p.entityId, reportType: p.reportType ?? "standard" },
        },
      });
    });
  });

  // ─── submit: draft → submitted ───────────────────────────────────────────
  queue.subscribe<ReportTransitionPayload>(REPORT_SUBMIT_TOPIC, async (msg) => {
    const p = msg.payload;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const report = await lockReport(tx, msg.tenantId, p.id);
      if (report.status === "submitted") return; // redelivery under a fresh messageId
      try { assertValidReportTransition(report.status, "submitted"); } catch (err) { toDomainError(err, DomainError); }

      const now = new Date();
      await tx.update(inspectionReports)
        .set({
          status: "submitted", submittedAt: now, submittedBy: msg.actorId, updatedAt: now, updatedBy: msg.actorId,
          version: sql`${inspectionReports.version} + 1`,
        })
        .where(and(eq(inspectionReports.tenantId, msg.tenantId), eq(inspectionReports.id, p.id)));

      await enqueue(tx, {
        topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: {
          action: "inspection_report.submitted", resourceType: "inspection_report", resourceId: p.id,
          details: { from: report.status, to: "submitted", submittedBy: msg.actorId },
        },
      });
    });
  });

  // ─── approve: submitted → approved (maker ≠ checker) ─────────────────────
  queue.subscribe<ReportTransitionPayload>(REPORT_APPROVE_TOPIC, async (msg) => {
    const p = msg.payload;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const report = await lockReport(tx, msg.tenantId, p.id);
      if (report.status === "approved") return; // redelivery under a fresh messageId
      try {
        assertValidReportTransition(report.status, "approved");
        assertMakerCheckerForReportApproval(reportMakers(report), msg.actorId);
      } catch (err) { toDomainError(err, DomainError); }

      const now = new Date();
      await tx.update(inspectionReports)
        .set({
          status: "approved", approvedAt: now, approvedBy: msg.actorId, updatedAt: now, updatedBy: msg.actorId,
          version: sql`${inspectionReports.version} + 1`,
        })
        .where(and(eq(inspectionReports.tenantId, msg.tenantId), eq(inspectionReports.id, p.id)));

      await enqueue(tx, {
        topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: {
          action: "inspection_report.approved", resourceType: "inspection_report", resourceId: p.id,
          details: { from: report.status, to: "approved", submittedBy: report.submittedBy ?? report.updatedBy },
        },
      });
    });
  });

  // ─── observation.add ──────────────────────────────────────────────────────
  queue.subscribe<ObservationAddPayload>(REPORT_OBSERVATION_ADD_TOPIC, async (msg) => {
    const p = msg.payload;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      // Lock the parent so a concurrent approve cannot slip an observation onto a finalized report.
      const report = await lockReport(tx, msg.tenantId, p.reportId);
      if (!OBSERVABLE_STATUSES.includes(report.status)) {
        throw new NonRetryableError(`Cannot add observations to inspection report ${p.reportId} in status '${report.status}'`);
      }

      await tx.insert(observations).values({
        id: p.id,
        tenantId: msg.tenantId,
        reportId: p.reportId,
        category: p.category,
        severity: p.severity,
        description: p.description,
        location: p.location ?? null,
        evidenceIds: p.evidenceIds ?? null,
        createdBy: msg.actorId,
      });

      await enqueue(tx, {
        topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: {
          action: "inspection_report.observation_added", resourceType: "inspection_report", resourceId: p.reportId,
          details: { observationId: p.id, category: p.category, severity: p.severity },
        },
      });
    });
  });
}
