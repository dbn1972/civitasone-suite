import type { Queue } from "@civitasone/queue";
import * as repo from "../devices/repo.js";

type FeedRule = {
  topic: string;
  mailbox: string;
  entityId: (payload: Record<string, unknown>) => string | null;
  /** 03-T7: owner for user-private mailboxes (e.g. notifications). */
  ownerId?: (payload: Record<string, unknown>) => string | null;
};

const ownerFromRecipient = (p: Record<string, unknown>): string | null =>
  String(p.recipientId ?? p.userId ?? "") || null;

const FEED_RULES: FeedRule[] = [
  { topic: "hrms.employee.created", mailbox: "employees", entityId: (p) => String(p.employeeId ?? "") || null },
  { topic: "hrms.leave.applied", mailbox: "leave_requests", entityId: (p) => String(p.leaveAppId ?? "") || null },
  { topic: "hrms.leave.approved", mailbox: "leave_requests", entityId: (p) => String(p.leaveAppId ?? "") || null },
  { topic: "hrms.attendance.marked", mailbox: "attendance", entityId: (p) => `${p.employeeId}:${p.attendanceDate}` },
  { topic: "finance.payment.made", mailbox: "payments", entityId: (p) => String(p.paymentId ?? "") || null },
  { topic: "finance.gl.posted", mailbox: "journals", entityId: (p) => String(p.journalId ?? "") || null },
  { topic: "procurement.indent.approved", mailbox: "indents", entityId: (p) => String(p.indentId ?? p.id ?? "") || null },
  { topic: "procurement.po.approved", mailbox: "purchase_orders", entityId: (p) => String(p.poId ?? p.id ?? "") || null },
  { topic: "workflow.instance.created", mailbox: "approvals", entityId: (p) => String(p.instanceId ?? p.taskId ?? "") || null },
  { topic: "crm.contact.created", mailbox: "crm_contacts", entityId: (p) => String(p.contactId ?? "") || null },
  { topic: "crm.deal.created", mailbox: "crm_deals", entityId: (p) => String(p.dealId ?? "") || null },
  { topic: "helpdesk.ticket.created", mailbox: "helpdesk_tickets", entityId: (p) => String(p.ticketId ?? "") || null },
  { topic: "project.project.created", mailbox: "projects", entityId: (p) => String(p.projectId ?? "") || null },
  { topic: "estab.file.created", mailbox: "estab_files", entityId: (p) => String(p.fileId ?? p.id ?? "") || null },
  { topic: "estab.file.moved", mailbox: "estab_files", entityId: (p) => String(p.fileId ?? "") || null },
  { topic: "analytics.query.run.completed", mailbox: "mis_metrics", entityId: (p) => String(p.queryRunId ?? p.id ?? "") || null },
  // payroll
  { topic: "payroll.run.approved", mailbox: "payments", entityId: (p) => String(p.runId ?? p.id ?? "") || null },
  { topic: "payroll.loan.disbursed", mailbox: "payments", entityId: (p) => String(p.loanId ?? p.id ?? "") || null },
  // stock
  { topic: "stock.entry.created", mailbox: "indents", entityId: (p) => String(p.entryId ?? p.id ?? "") || null },
  { topic: "stock.stock.negative_rejected", mailbox: "indents", entityId: (p) => String(p.itemId ?? p.entryId ?? "") || null },
  // grant
  { topic: "grant.scheme.created", mailbox: "applications", entityId: (p) => String(p.schemeId ?? p.id ?? "") || null },
  { topic: "grant.application.approved", mailbox: "applications", entityId: (p) => String(p.applicationId ?? p.id ?? "") || null },
  { topic: "grant.application.rejected", mailbox: "applications", entityId: (p) => String(p.applicationId ?? p.id ?? "") || null },
  { topic: "grant.disbursement.completed", mailbox: "payments", entityId: (p) => String(p.disbursementId ?? p.id ?? "") || null },
  { topic: "grant.beneficiary.created", mailbox: "applications", entityId: (p) => String(p.beneficiaryId ?? p.id ?? "") || null },
  // citizen
  { topic: "citizen.application.approved", mailbox: "applications", entityId: (p) => String(p.applicationId ?? p.id ?? "") || null },
  { topic: "citizen.application.sla_breached", mailbox: "applications", entityId: (p) => String(p.applicationId ?? p.id ?? "") || null },
  { topic: "citizen.grievance.resolved", mailbox: "grievances", entityId: (p) => String(p.grievanceId ?? p.id ?? "") || null },
  { topic: "citizen.grievance.escalated", mailbox: "grievances", entityId: (p) => String(p.grievanceId ?? p.id ?? "") || null },
  { topic: "citizen.rti.filed", mailbox: "applications", entityId: (p) => String(p.rtiId ?? p.id ?? "") || null },
  // notification
  { topic: "notification.delivered", mailbox: "notifications", entityId: (p) => String(p.deliveryId ?? p.notificationId ?? p.id ?? "") || null, ownerId: ownerFromRecipient },
  { topic: "notification.failed", mailbox: "notifications", entityId: (p) => String(p.deliveryId ?? p.notificationId ?? p.id ?? "") || null, ownerId: ownerFromRecipient },
  { topic: "notification.delivery.permanently_failed", mailbox: "notifications", entityId: (p) => String(p.deliveryId ?? p.notificationId ?? p.id ?? "") || null, ownerId: ownerFromRecipient },
];

export function registerSyncFeederConsumers(queue: Queue): void {
  for (const rule of FEED_RULES) {
    queue.subscribe(rule.topic, async (msg) => {
      const payload = msg.payload as Record<string, unknown>;
      const entityId = rule.entityId(payload);
      if (!entityId) return;
      await repo.appendChangelog({
        tenantId: msg.tenantId,
        mailbox: rule.mailbox,
        entityId,
        operation: "upsert",
        payload,
        ownerUserId: rule.ownerId ? rule.ownerId(payload) : null,
      });
    });
  }
}
