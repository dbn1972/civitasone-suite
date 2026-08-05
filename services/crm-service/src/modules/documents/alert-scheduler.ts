/**
 * DM-002 document-alert scheduler.
 *
 * A worker-side interval (overlap-guarded like the AC-005 task-escalation
 * scheduler) that every cycle, per tenant:
 *   (a) finds subjects MISSING a mandatory document type, and
 *   (b) finds current documents that are EXPIRED or expiring within N days,
 * emitting a `crm.document.alert` (+ audit) for each with the details.
 *
 * The missing/expiring DECISIONS are the pure `alert-domain` functions (unit
 * tested); this file is only DB plumbing. Cross-tenant discovery uses
 * `crm.list_document_alert_tenants()` (SECURITY DEFINER), exactly like the
 * task-escalation scheduler's tenant lister.
 *
 * `case` subjects live in helpdesk-service, so they cannot be enumerated here for
 * the MISSING check — only their expiry is watched (their rows live in crm.documents).
 */
import { pino } from "pino";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { runWithTenant } from "@civitasone/db";
import { db, sqlClient } from "../../shared/db.js";
import { enqueue } from "../../shared/outbox.js";
import { EVENTS } from "../../topics.js";
import {
  findMissingMandatory,
  findExpiringDocuments,
  type SubjectDocs,
  type ExpiringDocLike,
} from "./alert-domain.js";

const log = pino({ name: "crm-document-alert-scheduler" });
const AUDIT = "audit.event.record";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** subject_type → the CRM table its subjects live in (case is cross-service: excluded). */
const SUBJECT_TABLE: Record<string, string> = {
  lead: "crm.contacts",
  contact: "crm.contacts",
  account: "crm.accounts",
  opportunity: "crm.deals",
  quotation: "crm.quotations",
};

function expiryHorizonDays(): number {
  const n = Number(process.env.CRM_DOC_EXPIRY_ALERT_DAYS ?? 30);
  return Number.isFinite(n) && n >= 0 ? n : 30;
}

interface MandatoryType {
  appliesTo: string;
  code: string;
}

async function mandatoryTypes(tx: Tx, tenantId: string): Promise<MandatoryType[]> {
  const rows = (await tx.execute(sql`
    SELECT applies_to AS "appliesTo", code FROM crm.document_types
    WHERE tenant_id = ${tenantId} AND enabled = true AND mandatory = true
  `)) as unknown as Array<{ appliesTo: string; code: string }>;
  return rows.map((r) => ({ appliesTo: r.appliesTo, code: r.code }));
}

/** Current, non-deleted doc-type codes each subject of `subjectType` already has. */
async function subjectDocs(tx: Tx, tenantId: string, subjectType: string): Promise<SubjectDocs[]> {
  const table = SUBJECT_TABLE[subjectType];
  if (!table) return [];
  let subjectRows: Array<{ id: string }> = [];
  try {
    subjectRows = (await tx.execute(sql`
      SELECT id FROM ${sql.raw(table)} WHERE tenant_id = ${tenantId}
    `)) as unknown as Array<{ id: string }>;
  } catch (err) {
    log.warn({ err, table }, "subject enumeration failed; skipping subject_type");
    return [];
  }
  const docRows = (await tx.execute(sql`
    SELECT subject_id AS "subjectId", doc_type AS "docType" FROM crm.documents
    WHERE tenant_id = ${tenantId} AND subject_type = ${subjectType}
      AND is_current = true AND deleted_at IS NULL AND doc_type IS NOT NULL
  `)) as unknown as Array<{ subjectId: string; docType: string }>;
  const bySubject = new Map<string, string[]>();
  for (const r of docRows) {
    const arr = bySubject.get(r.subjectId) ?? [];
    arr.push(r.docType);
    bySubject.set(r.subjectId, arr);
  }
  return subjectRows.map((s) => ({ subjectId: s.id, docTypeCodes: bySubject.get(s.id) ?? [] }));
}

async function expiringCandidates(tx: Tx, tenantId: string): Promise<ExpiringDocLike[]> {
  const rows = (await tx.execute(sql`
    SELECT id, subject_type AS "subjectType", subject_id AS "subjectId",
           doc_type AS "docType", expiry_date AS "expiryDate"
    FROM crm.documents
    WHERE tenant_id = ${tenantId} AND is_current = true AND deleted_at IS NULL
      AND expiry_date IS NOT NULL
  `)) as unknown as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    documentId: r.id as string,
    subjectType: r.subjectType as string,
    subjectId: r.subjectId as string,
    docTypeCode: (r.docType ?? null) as string | null,
    expiryDate: (r.expiryDate ?? null) as string | null,
  }));
}

/** Run the alert cycle for one tenant. Returns how many alerts were emitted. */
export async function runTenantDocumentAlerts(tenantId: string, now: Date = new Date()): Promise<number> {
  return (await runWithTenant(tenantId, () =>
    db.transaction(async (tx) => {
      let emitted = 0;
      const emit = async (payload: Record<string, unknown>, action: string, resourceId: string): Promise<void> => {
        await enqueue(tx, {
          topic: EVENTS.documentAlert, eventType: EVENTS.documentAlert,
          tenantId, actorId: tenantId, correlationId: randomUUID(), payload,
        });
        await enqueue(tx, {
          topic: AUDIT, eventType: AUDIT,
          tenantId, actorId: tenantId, correlationId: randomUUID(),
          payload: { service: "crm", action, resourceType: "document", resourceId, outcome: "success", metadata: payload },
        });
        emitted += 1;
      };

      // (a) Missing mandatory documents, per applies_to subject_type.
      const mand = await mandatoryTypes(tx, tenantId);
      const bySubjectType = new Map<string, string[]>();
      for (const m of mand) {
        const arr = bySubjectType.get(m.appliesTo) ?? [];
        arr.push(m.code);
        bySubjectType.set(m.appliesTo, arr);
      }
      for (const [subjectType, codes] of bySubjectType) {
        if (!SUBJECT_TABLE[subjectType]) continue; // case excluded — cannot enumerate
        const subjects = await subjectDocs(tx, tenantId, subjectType);
        for (const miss of findMissingMandatory(subjectType, codes, subjects)) {
          await emit(
            { alertType: "mandatory_missing", subjectType: miss.subjectType, subjectId: miss.subjectId, docTypeCode: miss.docTypeCode },
            "document_alert_mandatory_missing",
            miss.subjectId,
          );
        }
      }

      // (b) Expired / expiring documents.
      const expiring = findExpiringDocuments(await expiringCandidates(tx, tenantId), now, expiryHorizonDays());
      for (const e of expiring) {
        await emit(
          {
            alertType: e.expired ? "expired" : "expiring",
            subjectType: e.subjectType, subjectId: e.subjectId,
            documentId: e.documentId, docTypeCode: e.docTypeCode,
            expiryDate: e.expiryDate, daysUntilExpiry: e.daysUntilExpiry,
          },
          e.expired ? "document_alert_expired" : "document_alert_expiring",
          e.documentId,
        );
      }

      return emitted;
    }),
  )) as number;
}

/** One full cycle across every tenant with enabled types or dated documents. */
export async function runDocumentAlertCycle(now: Date = new Date()): Promise<number> {
  const rows = (await sqlClient`SELECT tenant_id FROM crm.list_document_alert_tenants()`) as unknown as Array<{ tenant_id: string }>;
  let total = 0;
  for (const r of rows) {
    try {
      total += await runTenantDocumentAlerts(r.tenant_id, now);
    } catch (err) {
      log.error({ err, tenantId: r.tenant_id }, "tenant document-alert cycle failed");
    }
  }
  return total;
}

/** Start the periodic scheduler, overlap-guarded like the task-escalation one. */
export function startDocumentAlertScheduler(intervalMs = 3_600_000): NodeJS.Timeout {
  let running = false;
  return setInterval(() => {
    if (running) return;
    running = true;
    runDocumentAlertCycle()
      .then((n) => { if (n > 0) log.info({ alerts: n }, "document-alert cycle complete"); })
      .catch((err) => log.error({ err }, "document-alert cycle failed"))
      .finally(() => { running = false; });
  }, intervalMs);
}
