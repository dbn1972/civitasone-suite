/**
 * Cross-service domain event consumer.
 *
 * Subscribes to domain events from other services (HRMS, Finance, Procurement,
 * Helpdesk, Citizen, Audit) and routes them into the notification delivery
 * pipeline via the existing sendNotification command.
 *
 * Flow: EventEnvelope → idempotency check → resolve template → determine
 * recipients → enqueue sendNotification command with channel preferences.
 */
import { pino } from "pino";
import type { Queue, CommandEnvelope } from "@civitasone/queue";
import { NOTIFICATION_SEND, buildNotificationPayload } from "@civitasone/events";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { CONSUMED_EVENTS } from "../../topics.js";
import { getTemplateForEvent, interpolate } from "./templates.js";
import { tenantScoped } from "../../shared/tenant-queue.js";

const log = pino({ name: "domain-events-consumer" });

// ─── Payload types for consumed events ───────────────────────────────────────

type LeaveApprovedPayload = {
  leaveId: string;
  employeeId: string;
  employeeName?: string;
  leaveType?: string;
  fromDate?: string;
  toDate?: string;
  days?: number;
  approverName?: string;
  approverId?: string;
};

type LeaveAppliedPayload = {
  leaveId: string;
  employeeId: string;
  employeeName?: string;
  employeeDesignation?: string;
  leaveType?: string;
  fromDate?: string;
  toDate?: string;
  days?: number;
  approverId: string;
  approverName?: string;
};

type SanctionApprovedPayload = {
  sanctionId: string;
  sanctionNo?: string;
  amount?: string;
  hoaCode?: string;
  ddoId: string;
  ddoName?: string;
};

type PaymentMadePayload = {
  paymentId: string;
  paymentRef?: string;
  amount?: string;
  payeeId: string;
  payeeName?: string;
};

type BillPassedPayload = {
  billId: string;
  billNo?: string;
  amount?: string;
  creatorId: string;
  creatorName?: string;
};

type GrnAcceptedPayload = {
  grnId: string;
  grnNo?: string;
  poNo?: string;
  originatorId: string;
  originatorName?: string;
};

type TicketCreatedPayload = {
  ticketId: string;
  ticketNo?: string;
  subject?: string;
  priority?: string;
  agentId: string;
  agentName?: string;
  raisedBy?: string;
};

type TicketEscalatedPayload = {
  ticketId: string;
  ticketNo?: string;
  subject?: string;
  priority?: string;
  escalationManagerId: string;
  escalationManagerName?: string;
  agentName?: string;
  escalationReason?: string;
};

type CitizenRequestCreatedPayload = {
  requestId: string;
  requestNo?: string;
  subject?: string;
  citizenId: string;
  citizenName?: string;
  slaHours?: string;
  trackingLink?: string;
};

type AuditParaIssuedPayload = {
  paraId: string;
  paraNo?: string;
  subject?: string;
  departmentId?: string;
  departmentName?: string;
  departmentHeadId: string;
  departmentHeadName?: string;
  dueDate?: string;
};

// ─── Visitor security/safety event payloads (role-recipient) ──────────────

/**
 * Desk/role recipient for visitor security alerts. The delivery pipeline resolves
 * this against the tenant taken from the message envelope (see enqueue below), so
 * the alert reaches the tenant's security control room rather than any per-person
 * id. This mirrors the recipient convention used by visitor-service's already-
 * notifying watchlist/capacity alerts (recipient: "security_control_room").
 */
const SECURITY_DESK = "security_control_room";

/**
 * Role recipient for tenant-wide release-notes broadcasts (LOOP 2). Resolved
 * against the message-envelope tenant by the delivery pipeline, so the release
 * note reaches the tenant's user audience rather than any single person id.
 */
const BROADCAST_AUDIENCE = "all_users";
/** Role recipient for contract lifecycle alerts — resolved per tenant by the delivery pipeline. */
const CONTRACT_DESK = "contract_management_desk";

type VisitorSecurityIncidentPayload = {
  incidentType?: string;
  type?: string;
  severity?: string;
  locationId?: string;
  passId?: string;
  visitRequestId?: string;
};

type VisitorScanBlacklistPayload = {
  sessionId?: string;
  ocrResultId?: string;
  idDocumentType?: string;
};

type VisitorTailgatingPayload = {
  passId?: string;
  gateId?: string;
  passageCount?: number;
  tolerance?: number;
  eventTimestamp?: string;
};

type VisitorAntiPassbackPayload = {
  passId?: string;
  gateId?: string;
  direction?: string;
  lastKnownDirection?: string;
  eventTimestamp?: string;
};

type VisitorEmergencyUnlockPayload = {
  locationId?: string;
  reason?: string;
  deviceCount?: number;
  triggeredAt?: string;
};

// ─── Admin release-notes broadcast payload (LOOP 2) ───────────────────────

/**
 * LOOP 2 — admin-service change management emits notification.broadcast.send on a
 * successful release with notes to publish. There is no single per-person target:
 * the release note fans out to the tenant's user audience. We address it to a
 * role recipient (BROADCAST_AUDIENCE) resolved per tenant by the delivery pipeline,
 * mirroring the visitor security-desk role-recipient convention above.
 */
type BroadcastSendPayload = {
  channel?: string;
  changeId?: string;
  title?: string;
  releaseNotes?: string;
  affectedServices?: string[];
};

type ContractExpiryAlertPayload = {
  contractId?: string;
  contractNo?: string;
  title?: string;
  endDate?: string;
  daysRemaining?: number;
};

// ─── Recipient resolution ────────────────────────────────────────────────────

type ResolvedNotification = {
  recipientId: string;
  recipient: string;
  variables: Record<string, string>;
};

function resolveRecipients(eventType: string, payload: Record<string, unknown>): ResolvedNotification[] {
  switch (eventType) {
    case CONSUMED_EVENTS.hrmsLeaveApproved: {
      const p = payload as LeaveApprovedPayload;
      return [{
        recipientId: p.employeeId,
        recipient: p.employeeId,
        variables: {
          leaveType: p.leaveType ?? "leave",
          fromDate: p.fromDate ?? "",
          toDate: p.toDate ?? "",
          days: String(p.days ?? ""),
          approverName: p.approverName ?? "your approving officer",
          employeeName: p.employeeName ?? "",
        },
      }];
    }

    case CONSUMED_EVENTS.hrmsLeaveApplied: {
      const p = payload as LeaveAppliedPayload;
      return [{
        recipientId: p.approverId,
        recipient: p.approverId,
        variables: {
          employeeName: p.employeeName ?? "An employee",
          employeeDesignation: p.employeeDesignation ?? "",
          leaveType: p.leaveType ?? "leave",
          fromDate: p.fromDate ?? "",
          toDate: p.toDate ?? "",
          days: String(p.days ?? ""),
          approverName: p.approverName ?? "",
        },
      }];
    }

    case CONSUMED_EVENTS.financeSanctionApproved: {
      const p = payload as SanctionApprovedPayload;
      return [{
        recipientId: p.ddoId,
        recipient: p.ddoId,
        variables: {
          sanctionNo: p.sanctionNo ?? p.sanctionId,
          amount: p.amount ?? "",
          hoaCode: p.hoaCode ?? "",
          ddoName: p.ddoName ?? "",
        },
      }];
    }

    case CONSUMED_EVENTS.financePaymentMade: {
      const p = payload as PaymentMadePayload;
      return [{
        recipientId: p.payeeId,
        recipient: p.payeeId,
        variables: {
          paymentRef: p.paymentRef ?? p.paymentId,
          amount: p.amount ?? "",
          payeeName: p.payeeName ?? "",
        },
      }];
    }

    case CONSUMED_EVENTS.financeBillPassed: {
      const p = payload as BillPassedPayload;
      return [{
        recipientId: p.creatorId,
        recipient: p.creatorId,
        variables: {
          billNo: p.billNo ?? p.billId,
          amount: p.amount ?? "",
          creatorName: p.creatorName ?? "",
        },
      }];
    }

    case CONSUMED_EVENTS.procurementGrnAccepted: {
      const p = payload as GrnAcceptedPayload;
      return [{
        recipientId: p.originatorId,
        recipient: p.originatorId,
        variables: {
          grnNo: p.grnNo ?? p.grnId,
          poNo: p.poNo ?? "",
          originatorName: p.originatorName ?? "",
        },
      }];
    }

    case CONSUMED_EVENTS.helpdeskTicketCreated: {
      const p = payload as TicketCreatedPayload;
      return [{
        recipientId: p.agentId,
        recipient: p.agentId,
        variables: {
          ticketNo: p.ticketNo ?? p.ticketId,
          subject: p.subject ?? "",
          priority: p.priority ?? "normal",
          agentName: p.agentName ?? "",
          raisedBy: p.raisedBy ?? "",
        },
      }];
    }

    case CONSUMED_EVENTS.helpdeskTicketEscalated: {
      const p = payload as TicketEscalatedPayload;
      return [{
        recipientId: p.escalationManagerId,
        recipient: p.escalationManagerId,
        variables: {
          ticketNo: p.ticketNo ?? p.ticketId,
          subject: p.subject ?? "",
          priority: p.priority ?? "normal",
          escalationManagerName: p.escalationManagerName ?? "",
          agentName: p.agentName ?? "",
          escalationReason: p.escalationReason ?? "SLA breach",
        },
      }];
    }

    case CONSUMED_EVENTS.citizenRequestCreated: {
      const p = payload as CitizenRequestCreatedPayload;
      return [{
        recipientId: p.citizenId,
        recipient: p.citizenId,
        variables: {
          requestNo: p.requestNo ?? p.requestId,
          subject: p.subject ?? "",
          citizenName: p.citizenName ?? "Citizen",
          slaHours: p.slaHours ?? "48",
          trackingLink: p.trackingLink ?? "",
        },
      }];
    }

    case CONSUMED_EVENTS.auditParaIssued: {
      const p = payload as AuditParaIssuedPayload;
      return [{
        recipientId: p.departmentHeadId,
        recipient: p.departmentHeadId,
        variables: {
          paraNo: p.paraNo ?? p.paraId,
          subject: p.subject ?? "",
          departmentName: p.departmentName ?? "",
          departmentHeadName: p.departmentHeadName ?? "",
          dueDate: p.dueDate ?? "",
        },
      }];
    }

    case CONSUMED_EVENTS.visitorSecurityIncidentCreated: {
      const p = payload as VisitorSecurityIncidentPayload;
      return [{
        recipientId: SECURITY_DESK,
        recipient: SECURITY_DESK,
        variables: {
          incidentType: p.incidentType ?? p.type ?? "security_incident",
          severity: p.severity ?? "high",
          locationId: p.locationId ?? "",
          reference: p.visitRequestId ?? p.passId ?? "",
        },
      }];
    }

    case CONSUMED_EVENTS.visitorScanBlacklistMatch: {
      const p = payload as VisitorScanBlacklistPayload;
      return [{
        recipientId: SECURITY_DESK,
        recipient: SECURITY_DESK,
        variables: {
          idDocumentType: p.idDocumentType ?? "identity document",
          sessionId: p.sessionId ?? "",
        },
      }];
    }

    case CONSUMED_EVENTS.visitorTailgatingDetected: {
      const p = payload as VisitorTailgatingPayload;
      return [{
        recipientId: SECURITY_DESK,
        recipient: SECURITY_DESK,
        variables: {
          gateId: p.gateId ?? "",
          passId: p.passId ?? "",
          passageCount: String(p.passageCount ?? ""),
          tolerance: String(p.tolerance ?? ""),
        },
      }];
    }

    case CONSUMED_EVENTS.visitorAntiPassbackViolation: {
      const p = payload as VisitorAntiPassbackPayload;
      return [{
        recipientId: SECURITY_DESK,
        recipient: SECURITY_DESK,
        variables: {
          gateId: p.gateId ?? "",
          passId: p.passId ?? "",
          direction: p.direction ?? "",
          lastKnownDirection: p.lastKnownDirection ?? "",
        },
      }];
    }

    case CONSUMED_EVENTS.visitorEmergencyUnlockTriggered: {
      const p = payload as VisitorEmergencyUnlockPayload;
      return [{
        recipientId: SECURITY_DESK,
        recipient: SECURITY_DESK,
        variables: {
          locationId: p.locationId ?? "",
          reason: p.reason ?? "emergency",
          deviceCount: String(p.deviceCount ?? ""),
          triggeredAt: p.triggeredAt ?? "",
        },
      }];
    }

    case CONSUMED_EVENTS.notificationBroadcastSend: {
      const p = payload as BroadcastSendPayload;
      return [{
        recipientId: BROADCAST_AUDIENCE,
        recipient: BROADCAST_AUDIENCE,
        variables: {
          title: p.title ?? "Platform Update",
          releaseNotes: p.releaseNotes ?? "",
          affectedServices: Array.isArray(p.affectedServices) ? p.affectedServices.join(", ") : "",
          changeId: p.changeId ?? "",
          channel: p.channel ?? "release_notes",
        },
      }];
    }

    case CONSUMED_EVENTS.contractExpiryAlert: {
      const p = payload as ContractExpiryAlertPayload;
      return [{
        recipientId: CONTRACT_DESK,
        recipient: CONTRACT_DESK,
        variables: {
          contractNo: p.contractNo ?? p.contractId ?? "",
          contractTitle: p.title ? ` (${p.title})` : "",
          endDate: p.endDate ?? "",
          daysRemaining: String(p.daysRemaining ?? ""),
        },
      }];
    }

    default:
      return [];
  }
}

// ─── Main consumer handler ───────────────────────────────────────────────────

async function handleDomainEvent(msg: CommandEnvelope): Promise<void> {
  const eventType = msg.type;
  const template = getTemplateForEvent(eventType);

  if (!template) {
    log.warn({ eventType, messageId: msg.messageId }, "No notification template registered for event type — skipping");
    return;
  }

  const recipients = resolveRecipients(eventType, msg.payload as Record<string, unknown>);
  if (recipients.length === 0) {
    log.warn({ eventType, messageId: msg.messageId }, "No recipients resolved for domain event — skipping");
    return;
  }

  await db.transaction(async (tx) => {
    if (!(await markProcessed(tx, msg.messageId))) return;

    for (const r of recipients) {
      const notificationPayload = buildNotificationPayload({
        eventType,
        recipient: r.recipient,
        recipientId: r.recipientId,
        variables: r.variables,
      });

      await enqueue(tx as Parameters<typeof enqueue>[0], {
        topic: NOTIFICATION_SEND,
        eventType: NOTIFICATION_SEND,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: notificationPayload,
      });
    }
  });

  log.info(
    { eventType, messageId: msg.messageId, recipientCount: recipients.length },
    "Domain event processed — notifications enqueued",
  );
}

// ─── Registration ────────────────────────────────────────────────────────────

export function registerDomainEventConsumers(queue: Queue): void {
  // RLS (#146): every handler must run inside the message's tenant context.
  queue = tenantScoped(queue);
  const eventTopics = Object.values(CONSUMED_EVENTS);

  for (const topic of eventTopics) {
    queue.subscribe(topic, async (msg) => {
      await handleDomainEvent(msg);
    });
  }

  log.info({ topics: eventTopics }, "Domain event consumers registered");
}
