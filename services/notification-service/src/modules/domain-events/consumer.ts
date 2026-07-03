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
  const eventTopics = Object.values(CONSUMED_EVENTS);

  for (const topic of eventTopics) {
    queue.subscribe(topic, async (msg) => {
      await handleDomainEvent(msg);
    });
  }

  log.info({ topics: eventTopics }, "Domain event consumers registered");
}
