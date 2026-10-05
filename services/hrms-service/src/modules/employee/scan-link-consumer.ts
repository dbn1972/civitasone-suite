/**
 * GAP-ADMIN-BULK-SCAN-02 (H-LINK-HR): target side of the packages/scan-link contract for
 * `hr_employee`. Consumes `hrms.scan-link.request` / `hrms.scan-link.unlink.request` published by
 * document-service, and answers with `hrms.scan-link.result` / `hrms.scan-link.unlink.result`
 * (via the outbox, in the SAME transaction as the write).
 *
 * Each handler is ONE transaction: inbox mark + RE-CHECK that the employee exists in the message
 * tenant + the write + the audit.event.record outbox row + the result event. Redelivery is a no-op
 * (markProcessed), and a re-sent command with a new messageId but the same linkId is answered
 * idempotently from the existing row (no second row, no second audit).
 * Audit payloads carry ids, doc type and counts only -- never extracted text or PII values.
 */
import type { Queue } from "@civitasone/queue";
import { and, eq, sql } from "drizzle-orm";
import {
  LINK_TOPICS, linkRequestSchema, unlinkRequestSchema, scrubReasonText,
  type LinkResult, type UnlinkResult,
} from "@civitasone/scan-link";
import { pino } from "pino";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS } from "../../topics.js";
import { hrmsEmployees } from "./schema.js";
import { hrmsEmployeeScannedDocuments as t } from "./scan-link-schema.js";

const log = pino({ name: "hrms-scan-link" });
const AUDIT = "audit.event.record";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Msg = { messageId: string; tenantId: string; actorId: string; correlationId: string; payload: unknown };
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

function audit(tx: Tx, msg: Msg, action: string, employeeId: string, outcome: "success" | "failure", metadata: Record<string, unknown>) {
  return enqueue(tx, {
    topic: AUDIT, eventType: AUDIT,
    tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
    payload: { service: "hrms", action, resourceType: "employee", resourceId: employeeId, outcome, metadata },
  });
}

function emitResult(tx: Tx, msg: Msg, r: LinkResult) {
  return enqueue(tx, {
    topic: LINK_TOPICS.result("hrms"), eventType: LINK_TOPICS.result("hrms"),
    tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
    payload: r,
  });
}

function emitUnlinkResult(tx: Tx, msg: Msg, r: UnlinkResult) {
  return enqueue(tx, {
    topic: LINK_TOPICS.unlinkResult("hrms"), eventType: LINK_TOPICS.unlinkResult("hrms"),
    tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
    payload: r,
  });
}

/** True iff the employee exists in the message tenant (explicit tenant predicate + FORCE RLS). */
async function employeeExists(tx: Tx, tenantId: string, employeeId: string): Promise<boolean> {
  if (!UUID_RE.test(employeeId)) return false;
  const rows = await tx.select({ id: hrmsEmployees.id }).from(hrmsEmployees)
    .where(and(eq(hrmsEmployees.id, employeeId), eq(hrmsEmployees.tenantId, tenantId))).limit(1);
  return rows.length > 0;
}

export async function handleLinkRequest(msg: Msg): Promise<void> {
  const parsed = linkRequestSchema.safeParse(msg.payload);
  if (!parsed.success) {
    // Malformed command: no linkId to answer on, and a retry cannot fix it. Drop with a log line.
    log.warn({ messageId: msg.messageId, issues: parsed.error.issues.length }, "scan-link.request invalid payload dropped");
    return;
  }
  const p = parsed.data;
  await db.transaction(async (tx) => {
    if (!(await markProcessed(tx, msg.messageId))) return;
    const base = { linkId: p.linkId, target: p.target, targetId: p.targetId, documentId: p.document.documentId } as const;
    if (p.target !== "hr_employee") {
      await emitResult(tx, msg, { ...base, status: "rejected", reason: "UNSUPPORTED_TARGET" });
      return;
    }
    // Maker != checker, re-checked on the TARGET side (defence in depth; the document side enforces it too).
    // approvedBy is null only when filing maker-checker is off, in which case there is no checker to compare.
    if (p.approvedBy !== null && p.approvedBy === p.requestedBy) {
      if (UUID_RE.test(p.targetId)) {
        await audit(tx, msg, "scan_link", p.targetId, "failure",
          { linkId: p.linkId, documentId: p.document.documentId, reason: "MAKER_CHECKER_VIOLATION" });
      }
      await emitResult(tx, msg, { ...base, status: "rejected", reason: "MAKER_CHECKER_VIOLATION" });
      return;
    }
    if (!(await employeeExists(tx, msg.tenantId, p.targetId))) {
      if (UUID_RE.test(p.targetId)) {
        await audit(tx, msg, "scan_link", p.targetId, "failure",
          { linkId: p.linkId, documentId: p.document.documentId, reason: "TARGET_NOT_FOUND" });
      }
      await emitResult(tx, msg, { ...base, status: "rejected", reason: "TARGET_NOT_FOUND" });
      return;
    }
    // Same linkId already applied (document-service re-sent with a fresh messageId): answer from the row.
    const [existing] = await tx.select({ state: t.state, employeeId: t.employeeId }).from(t)
      .where(and(eq(t.tenantId, msg.tenantId), eq(t.linkId, p.linkId))).limit(1);
    if (existing) {
      if (existing.state === "linked" && existing.employeeId === p.targetId) {
        await emitResult(tx, msg, { ...base, status: "linked", reason: null });
      } else {
        await emitResult(tx, msg, { ...base, status: "rejected", reason: "LINK_ALREADY_USED" });
      }
      return;
    }
    // The same document may be actively linked to an employee only once.
    const [dup] = await tx.select({ id: t.id }).from(t)
      .where(and(eq(t.tenantId, msg.tenantId), eq(t.employeeId, p.targetId), eq(t.documentId, p.document.documentId), eq(t.state, "linked"))).limit(1);
    if (dup) {
      await emitResult(tx, msg, { ...base, status: "rejected", reason: "DOCUMENT_ALREADY_LINKED" });
      return;
    }
    const d = p.document;
    await tx.insert(t).values({
      tenantId: msg.tenantId, employeeId: p.targetId,
      documentId: d.documentId, batchId: d.batchId, fileName: d.fileName, mimeType: d.mimeType,
      docType: d.docType, pageCount: d.pageCount,
      ocrConfidence: d.ocrConfidence == null ? null : d.ocrConfidence.toFixed(3),
      piiFlags: d.piiFlags, textPreviewMasked: d.textPreviewMasked,
      linkId: p.linkId, linkedBy: p.requestedBy, approvedBy: p.approvedBy,
      filedAt: new Date(d.filedAt), state: "linked",
      createdBy: msg.actorId, updatedBy: msg.actorId,
    });
    await audit(tx, msg, "scan_link", p.targetId, "success", {
      linkId: p.linkId, documentId: d.documentId, batchId: d.batchId, docType: d.docType,
      pageCount: d.pageCount, piiFlagTypes: d.piiFlags, requestedBy: p.requestedBy, approvedBy: p.approvedBy,
    });
    await emitResult(tx, msg, { ...base, status: "linked", reason: null });
  });
}

export async function handleUnlinkRequest(msg: Msg): Promise<void> {
  const parsed = unlinkRequestSchema.safeParse(msg.payload);
  if (!parsed.success) {
    log.warn({ messageId: msg.messageId, issues: parsed.error.issues.length }, "scan-link.unlink.request invalid payload dropped");
    return;
  }
  const p = parsed.data;
  await db.transaction(async (tx) => {
    if (!(await markProcessed(tx, msg.messageId))) return;
    const res = { linkId: p.linkId, documentId: p.documentId } as const;
    // Length check on the original trimmed input; only the scrubbed text is ever stored or audited (mask tokens are >= 5 chars, so the DB CHECK holds).
    const safeReason = scrubReasonText(p.reason.trim());
    if (p.reason.trim().length < 5) {
      await emitUnlinkResult(tx, msg, { ...res, status: "rejected", reason: "REASON_REQUIRED" });
      return;
    }
    const [row] = await tx.select({ id: t.id, employeeId: t.employeeId, state: t.state, documentId: t.documentId }).from(t)
      .where(and(eq(t.tenantId, msg.tenantId), eq(t.linkId, p.linkId))).limit(1);
    if (!row || row.documentId !== p.documentId || row.employeeId !== p.targetId) {
      await emitUnlinkResult(tx, msg, { ...res, status: "rejected", reason: "LINK_NOT_FOUND" });
      return;
    }
    // Race-safe soft state change: only a still-linked row transitions.
    const updated = await tx.update(t).set({
      state: "unlinked", unlinkReason: safeReason, unlinkedBy: p.requestedBy, unlinkedAt: sql`now()`,
      updatedBy: msg.actorId, updatedAt: sql`now()`, version: sql`${t.version} + 1`,
    }).where(and(eq(t.id, row.id), eq(t.tenantId, msg.tenantId), eq(t.state, "linked"))).returning({ id: t.id });
    if (updated.length === 0) {
      // Already unlinked (re-sent command): idempotent success, no second audit.
      await emitUnlinkResult(tx, msg, { ...res, status: "unlinked", reason: null });
      return;
    }
    await audit(tx, msg, "scan_unlink", row.employeeId, "success", {
      linkId: p.linkId, documentId: p.documentId, reason: safeReason, requestedBy: p.requestedBy,
    });
    await emitUnlinkResult(tx, msg, { ...res, status: "unlinked", reason: null });
  });
}

/** DPDP audit-on-read: one audit event per successful view; actor, employee, document ids, fixed purpose, route. */
export async function handleViewed(msg: Msg): Promise<void> {
  const p = msg.payload as { employeeId: string; documentIds: string[]; route: string };
  await db.transaction(async (tx) => {
    if (!(await markProcessed(tx, msg.messageId))) return;
    await audit(tx, msg, "view_scanned_documents", p.employeeId, "success", {
      purpose: "view_scanned_documents", documentIds: p.documentIds, route: p.route,
    });
  });
}

export function registerScanLinkConsumers(queue: Queue): void {
  queue.subscribe(LINK_TOPICS.request("hrms"), async (msg) => handleLinkRequest(msg as Msg));
  queue.subscribe(LINK_TOPICS.unlinkRequest("hrms"), async (msg) => handleUnlinkRequest(msg as Msg));
  queue.subscribe(COMMANDS.scanLinkDocumentsViewed, async (msg) => handleViewed(msg as Msg));
}
