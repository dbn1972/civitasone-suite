/**
 * Canonical notification.send payload contract (notification-service deliveries consumer).
 * System template UUIDs are seeded in notification-service/migrations/0003_system_templates.sql
 * and services/notification-service/migrations/0044_municipal_templates.sql (municipal Sec5).
 */

export const NOTIFICATION_SEND = "notification.send" as const;

/** Fixed template IDs — must match 0003_system_templates.sql */
export const SYSTEM_TEMPLATE_IDS = {
  default:                  "00000000-0000-4000-8001-000000000000",
  auditParaIssued:          "00000000-0000-4000-8001-000000000001",
  legalCaseDateSet:         "00000000-0000-4000-8001-000000000002",
  citizenRtiFiled:          "00000000-0000-4000-8001-000000000003",
  citizenApplicationApproved: "00000000-0000-4000-8001-000000000004",
  citizenApplicationSlaBreached: "00000000-0000-4000-8001-000000000005",
  citizenGrievanceResolved: "00000000-0000-4000-8001-000000000006",
  citizenGrievanceEscalated: "00000000-0000-4000-8001-000000000007",
  grantApplicationApproved: "00000000-0000-4000-8001-000000000008",
  grantDisbursementCompleted: "00000000-0000-4000-8001-000000000009",
  grantDisbursementFailed:  "00000000-0000-4000-8001-00000000000a",
  vendorBlacklisted:        "00000000-0000-4000-8001-00000000000b",
  estabRtiCpioAlert:        "00000000-0000-4000-8001-00000000000c",
  hrLeaveApproved:          "00000000-0000-4000-8001-000000000000",
  payrollRunApproved:       "00000000-0000-4000-8001-000000000000",
  /** Municipal Sec5 (17 services) — see 0044_municipal_templates.sql. */
  municipalApplicationSubmitted: "00000000-0000-4000-8002-000000000001",
  municipalFeeDue:           "00000000-0000-4000-8002-000000000002",
  municipalStatusChanged:    "00000000-0000-4000-8002-000000000003",
  municipalPermitIssued:     "00000000-0000-4000-8002-000000000004",
} as const;

const EVENT_TEMPLATE_MAP: Record<string, string> = {
  "audit.para.issued":              SYSTEM_TEMPLATE_IDS.auditParaIssued,
  "legal.case.date_set":            SYSTEM_TEMPLATE_IDS.legalCaseDateSet,
  "citizen.rti.filed":              SYSTEM_TEMPLATE_IDS.citizenRtiFiled,
  "citizen.application.approved":   SYSTEM_TEMPLATE_IDS.citizenApplicationApproved,
  "citizen.application.sla_breached": SYSTEM_TEMPLATE_IDS.citizenApplicationSlaBreached,
  "citizen.grievance.resolved":     SYSTEM_TEMPLATE_IDS.citizenGrievanceResolved,
  "citizen.grievance.escalated":    SYSTEM_TEMPLATE_IDS.citizenGrievanceEscalated,
  "grant.application.approved":     SYSTEM_TEMPLATE_IDS.grantApplicationApproved,
  "grant.disbursement.completed":   SYSTEM_TEMPLATE_IDS.grantDisbursementCompleted,
  "grant.disbursement.failed":      SYSTEM_TEMPLATE_IDS.grantDisbursementFailed,
  "procurement.vendor.blacklisted": SYSTEM_TEMPLATE_IDS.vendorBlacklisted,
  "estab.rti.created":              SYSTEM_TEMPLATE_IDS.estabRtiCpioAlert,
  "hrms.leave.approved":            SYSTEM_TEMPLATE_IDS.hrLeaveApproved,
  "payroll.run.approved":           SYSTEM_TEMPLATE_IDS.payrollRunApproved,
  // Municipal Sec5 (advertisement, vendor, sewerage, shop, trade, animal, fire,
  // crematorium, drainage, event, parking, parks, roadcut, building, refund,
  // market, swm) — canonical event types from packages/events/src/municipal-cross.ts
  // MUNICIPAL_EVENT_TYPES.
  "municipal.application.submitted": SYSTEM_TEMPLATE_IDS.municipalApplicationSubmitted,
  "municipal.fee.due":              SYSTEM_TEMPLATE_IDS.municipalFeeDue,
  "municipal.status.changed":       SYSTEM_TEMPLATE_IDS.municipalStatusChanged,
  "municipal.permit.issued":        SYSTEM_TEMPLATE_IDS.municipalPermitIssued,
};

export type NotificationSendPayload = {
  templateId: string;
  recipient: string;
  recipientId?: string;
  channel?: "email" | "sms" | "push" | "in_app" | "whatsapp";
  eventType: string;
  variables?: Record<string, string>;
};

export function buildNotificationPayload(opts: {
  eventType: string;
  recipient: string;
  recipientId?: string;
  channel?: NotificationSendPayload["channel"];
  /** When set (e.g. pack FN-08 binding), overrides the system EVENT_TEMPLATE_MAP. */
  templateId?: string;
  variables?: Record<string, string>;
}): NotificationSendPayload {
  const templateId =
    opts.templateId ?? EVENT_TEMPLATE_MAP[opts.eventType] ?? SYSTEM_TEMPLATE_IDS.default;
  const payload: NotificationSendPayload = {
    templateId,
    recipient: opts.recipient,
    eventType: opts.eventType,
  };
  if (opts.recipientId) payload.recipientId = opts.recipientId;
  if (opts.channel) payload.channel = opts.channel;
  if (opts.variables) payload.variables = opts.variables;
  return payload;
}
