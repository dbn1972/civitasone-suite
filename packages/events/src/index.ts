/**
 * @civitasone/events
 * Canonical domain event contracts for inter-service async communication.
 * Services must only publish and consume through these contracts (Vol 3, Section 9).
 * Queue/topic names must include: environment.service.event-type
 */

// ─── Event naming convention ─────────────────────────────────────────────────
// {env}.{service}.{entity}.{action}
// e.g. prod.identity.user.created, prod.finance.gl_entry.posted

export type EventEnvelope<T = unknown> = {
  eventId: string;
  eventType: string;         // e.g. "identity.user.created"
  tenantId: string;
  correlationId: string;
  actorId: string;
  timestamp: string;         // UTC ISO 8601
  schemaVersion: string;     // e.g. "1.0"
  payload: T;
};

// ─── Identity events ─────────────────────────────────────────────────────────

export type UserCreatedPayload = { userId: string; email: string; roles: string[] };
export type UserSuspendedPayload = { userId: string; reason: string };
export type SessionRevokedPayload = { sessionId: string; userId: string };

// ─── Tenant events ───────────────────────────────────────────────────────────

export type TenantActivatedPayload = { tenantId: string; plan: string };
export type TenantSuspendedPayload = { tenantId: string; reason: string };
export type TenantCreatedPayload = { tenantId: string; plan: string };
export type TenantUpdatedPayload = { tenantId: string };

// Command names (write-path intents) owned by tenant-service.
export const TENANT_COMMANDS = {
  create: "tenant.tenant.create",
  update: "tenant.tenant.update",
  suspend: "tenant.tenant.suspend",
} as const;

// Event names (post-commit facts) emitted by tenant-service.
export const TENANT_EVENTS = {
  created: "tenant.tenant.created",
  updated: "tenant.tenant.updated",
  suspended: "tenant.tenant.suspended",
} as const;

// ─── Finance events ──────────────────────────────────────────────────────────

export type GlEntryPostedPayload = { entryId: string; accountId: string; amount: number; currency: string };
export type BudgetExceededPayload = { budgetId: string; requested: number; available: number };
export type PaymentApprovedPayload = { paymentId: string; amount: number; currency: string };

// ─── Procurement events ──────────────────────────────────────────────────────

export type PurchaseOrderApprovedPayload = { orderId: string; supplierId: string; amount: number };
export type GoodsReceivedPayload = { receiptId: string; orderId: string; items: Array<{ itemId: string; qty: number }> };

// ─── HRMS events ─────────────────────────────────────────────────────────────

export type PayrollRunCompletedPayload = { runId: string; period: string; employeeCount: number };
export type LeaveApprovedPayload = { leaveId: string; employeeId: string; days: number };

// ─── Helpdesk events ─────────────────────────────────────────────────────────

export type TicketCreatedPayload = { ticketId: string; subject: string; priority: string };
export type SlaBreachedPayload = { ticketId: string; slaId: string; breachedAt: string };

// ─── Audit events ────────────────────────────────────────────────────────────

export type AuditEventPayload = {
  service: string;
  action: string;
  resourceType: string;
  resourceId: string;
  outcome: "success" | "failure";
  metadata?: Record<string, unknown>;
};

// ─── Asset events ────────────────────────────────────────────────────────────
export type AssetRegisteredPayload = { assetId: string; assetCode: string; category: string; value: number };
export type AssetDepreciatedPayload = { assetId: string; period: string; amount: number };
export type AssetDisposedPayload = { assetId: string; disposalMethod: string; saleValue: number };

// ─── Stock events ────────────────────────────────────────────────────────────
export type StockReceivedPayload = { receiptId: string; skuId: string; qty: number; warehouseId: string };
export type StockIssuedPayload = { issueId: string; skuId: string; qty: number; issuedTo: string };
export type StockAdjustedPayload = { adjustmentId: string; skuId: string; qtyDelta: number; reason: string };

// ─── Grant events ────────────────────────────────────────────────────────────
export type GrantDisbursedPayload = { disbursementId: string; grantId: string; amount: number; installment: number };
export type GrantUcSubmittedPayload = { ucId: string; grantId: string; amount: number; period: string };
export type GrantClosedPayload = { grantId: string; reason: string };

// ─── Contract events ─────────────────────────────────────────────────────────
export type ContractSignedPayload = { contractId: string; vendorId: string; value: number; startDate: string };
export type ContractAmendedPayload = { contractId: string; amendmentNo: number; revisedValue: number };
export type ContractClosedPayload = { contractId: string; closeReason: string };

// ─── Project events ──────────────────────────────────────────────────────────
export type ProjectCreatedPayload = { projectId: string; name: string; budget: number; startDate: string };
export type MilestoneCompletedPayload = { milestoneId: string; projectId: string; name: string };
export type ProjectClosedPayload = { projectId: string; status: string };

// ─── Legal events ────────────────────────────────────────────────────────────
export type CaseFiledPayload = { caseId: string; caseNo: string; court: string; filedDate: string };
export type HearingScheduledPayload = { hearingId: string; caseId: string; date: string; court: string };
export type CaseClosedPayload = { caseId: string; outcome: string };

// ─── Citizen events ──────────────────────────────────────────────────────────
export type CitizenRequestCreatedPayload = { requestId: string; type: string; citizenId: string };
export type CitizenRequestResolvedPayload = { requestId: string; resolution: string };
export type RtiRequestFiledPayload = { rtiId: string; subject: string; citizenId: string };

// ─── CRM events ──────────────────────────────────────────────────────────────
export type ContactCreatedPayload = { contactId: string; name: string; type: string };
export type DealWonPayload = { dealId: string; contactId: string; value: number };
export type DealLostPayload = { dealId: string; contactId: string; reason: string };

// ─── Workflow events ─────────────────────────────────────────────────────────
export type TaskAssignedPayload = { taskId: string; assigneeId: string; workflowId: string };
export type TaskCompletedPayload = { taskId: string; completedBy: string; outcome: string };
export type WorkflowCompletedPayload = { workflowId: string; status: string; completedAt: string };

// ─── Billing events ──────────────────────────────────────────────────────────
export type InvoiceGeneratedPayload = { invoiceId: string; tenantId: string; amount: number; period: string };
export type PaymentReceivedPayload = { paymentId: string; invoiceId: string; amount: number; method: string };

// ─── Notification events ─────────────────────────────────────────────────────
export type NotificationDeliveredPayload = { notificationId: string; channel: string; recipientId: string };
export type NotificationFailedPayload = { notificationId: string; channel: string; reason: string };

// ─── Search index events ─────────────────────────────────────────────────────
/**
 * Cross-module search index update event. Published by all services via the
 * outbox when entities are created, updated, or soft-deleted. Consumed by a
 * centralized search consumer that writes to Meilisearch/OpenSearch.
 *
 * Topic: search.index.update
 * Event type: search.index.updated
 */
export type SearchIndexUpdatePayload = {
  /** Entity UUID. */
  id: string;
  /** Tenant isolation key. */
  tenantId: string;
  /** Source module (e.g. "hrms", "finance", "procurement"). */
  module: string;
  /** Primary display name. */
  name: string;
  /** Reference number (employee no, bill no, etc.). */
  refNumber: string | null;
  /** Description or summary. */
  description: string | null;
  /** Current entity status. */
  status: string;
  /** Whether to index/update or remove from index. */
  action: "upsert" | "delete";
};

export const SEARCH_INDEX = {
  topic: "search.index.update",
  eventType: "search.index.updated",
} as const;

// ─── Payroll events ──────────────────────────────────────────────────────────
export type PayrollRunApprovedPayload = { runId: string; period: string; totalNet: number; employeeCount: number };
export type PayrollRunCompletedDetailPayload = { runId: string; period: string; bankFileGenerated: boolean };

// ─── Establishment events ────────────────────────────────────────────────────
export type FileCreatedPayload = { fileId: string; fileNo: string; department: string; subject: string };
export type FileDecidedPayload = { fileId: string; decision: string; decidedBy: string; decidedAt: string };
export type MeetingScheduledPayload = { meetingId: string; date: string; department: string; subject: string };

export {
  eventEnvelopeSchema,
  parseEnvelope,
  type ValidatedEnvelope,
  type ParseEnvelopeResult,
} from "./envelope.js";

export {
  NOTIFICATION_SEND,
  SYSTEM_TEMPLATE_IDS,
  buildNotificationPayload,
  type NotificationSendPayload,
} from "./notification.js";

export {
  FINANCE_CHALLAN_CREATE,
  BILLING_INVOICE_CREATE,
  MUNICIPAL_FEE_RECEIPT_HEAD_CODE,
  MUNICIPAL_EVENT_TYPES,
  buildMunicipalFeeChallanPayload,
  buildMunicipalStatusNotification,
  municipalDecisionNotificationEventType,
  type MunicipalFeeChallanPayload,
} from "./municipal-cross.js";
