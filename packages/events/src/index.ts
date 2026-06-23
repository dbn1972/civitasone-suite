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
