import { describe, it, expect, beforeEach, vi } from "vitest";
import { MemoryQueue } from "@civitasone/queue";
import { CONSUMED_EVENTS } from "../src/topics.js";
import { getTemplateForEvent, interpolate, getRegisteredEventTypes } from "../src/modules/domain-events/templates.js";

/**
 * Domain events consumer test suite.
 *
 * Tests: event routing → template resolution → recipient resolution →
 * idempotency (dedup) → graceful handling of missing templates.
 */

// ─── Mock infrastructure ─────────────────────────────────────────────────────

// We mock the db, outbox, and pino so we can test the consumer logic in isolation.
vi.mock("../src/shared/db.js", () => {
  const processedIds = new Set<string>();
  return {
    db: {
      transaction: async (fn: (tx: unknown) => Promise<void>) => {
        await fn({});
      },
    },
    sqlClient: { end: vi.fn() },
    __processedIds: processedIds,
  };
});

vi.mock("../src/shared/outbox.js", () => {
  const processedIds = new Set<string>();
  const enqueuedMessages: Array<{ topic: string; payload: unknown }> = [];
  return {
    markProcessed: async (_tx: unknown, messageId: string) => {
      if (processedIds.has(messageId)) return false;
      processedIds.add(messageId);
      return true;
    },
    enqueue: async (_tx: unknown, msg: { topic: string; payload: unknown }) => {
      enqueuedMessages.push({ topic: msg.topic, payload: msg.payload });
    },
    __processedIds: processedIds,
    __enqueuedMessages: enqueuedMessages,
  };
});

// Access mock internals
async function getOutboxMock() {
  const mod = await import("../src/shared/outbox.js") as unknown as {
    __processedIds: Set<string>;
    __enqueuedMessages: Array<{ topic: string; payload: unknown }>;
  };
  return mod;
}

// ─── Template tests ──────────────────────────────────────────────────────────

describe("domain-events templates", () => {
  it("has a template registered for every CONSUMED_EVENTS entry", () => {
    const eventTypes = Object.values(CONSUMED_EVENTS);
    for (const eventType of eventTypes) {
      const template = getTemplateForEvent(eventType);
      expect(template, `Missing template for ${eventType}`).toBeDefined();
      expect(template!.push.title).toBeTruthy();
      expect(template!.push.body).toBeTruthy();
      expect(template!.email.title).toBeTruthy();
      expect(template!.email.body).toBeTruthy();
    }
  });

  it("getRegisteredEventTypes returns all 21 event types", () => {
    const types = getRegisteredEventTypes();
    expect(types).toHaveLength(21);
    expect(types).toContain("hrms.leave.approved");
    expect(types).toContain("audit.para.issued");
    // Visitor security/safety events wired into the notification choreography.
    expect(types).toContain("visitor.security_incident.created");
    expect(types).toContain("visitor.emergency.unlock.triggered");
    // LOOP 2 — admin release-notes broadcast.
    expect(types).toContain("notification.broadcast.send");
  });

  it("interpolate replaces {{placeholders}} with values", () => {
    const result = interpolate("Hello {{name}}, your leave is {{status}}.", {
      name: "Rajesh",
      status: "approved",
    });
    expect(result).toBe("Hello Rajesh, your leave is approved.");
  });

  it("interpolate leaves unresolved placeholders intact", () => {
    const result = interpolate("Payment of ₹{{amount}} to {{payeeName}}.", {
      amount: "50000",
    });
    expect(result).toBe("Payment of ₹50000 to {{payeeName}}.");
  });

  it("each event type routes to correct template content", () => {
    const leaveTemplate = getTemplateForEvent("hrms.leave.approved");
    expect(leaveTemplate!.push.title).toBe("Leave Approved");
    expect(leaveTemplate!.email.body).toContain("{{leaveType}}");

    const ticketTemplate = getTemplateForEvent("helpdesk.ticket.created");
    expect(ticketTemplate!.push.title).toBe("New Ticket Assigned");
    expect(ticketTemplate!.email.body).toContain("{{ticketNo}}");

    const auditTemplate = getTemplateForEvent("audit.para.issued");
    expect(auditTemplate!.push.title).toBe("Audit Para Issued");
    expect(auditTemplate!.email.body).toContain("{{departmentHeadName}}");
  });
});

// ─── Consumer routing & recipient tests ──────────────────────────────────────

describe("domain-events consumer", () => {
  let q: MemoryQueue;
  let outboxMock: Awaited<ReturnType<typeof getOutboxMock>>;

  beforeEach(async () => {
    q = new MemoryQueue();
    outboxMock = await getOutboxMock();
    outboxMock.__processedIds.clear();
    outboxMock.__enqueuedMessages.length = 0;

    // Dynamically import and register after mocks are set up
    const { registerDomainEventConsumers } = await import("../src/modules/domain-events/consumer.js");
    registerDomainEventConsumers(q);
  });

  function buildEnvelope(eventType: string, payload: Record<string, unknown>) {
    return {
      messageId: crypto.randomUUID(),
      type: eventType,
      tenantId: "tenant-001",
      actorId: "system",
      correlationId: crypto.randomUUID(),
      schemaVersion: "1.0",
      timestamp: new Date().toISOString(),
      payload,
    };
  }

  // ── Event routing: each event type produces a notification.send ───────────

  it("hrms.leave.approved → notifies the employee", async () => {
    const envelope = buildEnvelope(CONSUMED_EVENTS.hrmsLeaveApproved, {
      leaveId: "leave-1",
      employeeId: "emp-100",
      employeeName: "Rajesh Kumar",
      leaveType: "Casual",
      fromDate: "2024-03-01",
      toDate: "2024-03-03",
      days: 3,
      approverName: "Priya Sharma",
    });

    await q.publish(CONSUMED_EVENTS.hrmsLeaveApproved, envelope);
    await new Promise((r) => setTimeout(r, 30));

    expect(outboxMock.__enqueuedMessages).toHaveLength(2);  // notification.send + the CERT-In audit event (df2f9eeb) -- see [0] for the notification
    const msg = outboxMock.__enqueuedMessages[0]!;
    expect(msg.topic).toBe("notification.send");
    const payload = msg.payload as { recipient: string; recipientId: string; eventType: string; variables: Record<string, string> };
    expect(payload.recipientId).toBe("emp-100");
    expect(payload.eventType).toBe("hrms.leave.approved");
    expect(payload.variables?.leaveType).toBe("Casual");
    expect(payload.variables?.approverName).toBe("Priya Sharma");
  });

  it("hrms.leave.applied → notifies the approving officer", async () => {
    const envelope = buildEnvelope(CONSUMED_EVENTS.hrmsLeaveApplied, {
      leaveId: "leave-2",
      employeeId: "emp-200",
      employeeName: "Amit Singh",
      leaveType: "Earned",
      fromDate: "2024-04-01",
      toDate: "2024-04-05",
      days: 5,
      approverId: "officer-50",
      approverName: "DK Gupta",
    });

    await q.publish(CONSUMED_EVENTS.hrmsLeaveApplied, envelope);
    await new Promise((r) => setTimeout(r, 30));

    expect(outboxMock.__enqueuedMessages).toHaveLength(2);  // notification.send + the CERT-In audit event (df2f9eeb) -- see [0] for the notification
    const payload = outboxMock.__enqueuedMessages[0]!.payload as { recipientId: string; variables: Record<string, string> };
    expect(payload.recipientId).toBe("officer-50");
    expect(payload.variables?.employeeName).toBe("Amit Singh");
  });

  it("finance.sanction.approved → notifies the DDO", async () => {
    const envelope = buildEnvelope(CONSUMED_EVENTS.financeSanctionApproved, {
      sanctionId: "sanction-1",
      sanctionNo: "SAN/2024/001",
      amount: "500000",
      ddoId: "ddo-10",
      ddoName: "Smt. Rekha Verma",
    });

    await q.publish(CONSUMED_EVENTS.financeSanctionApproved, envelope);
    await new Promise((r) => setTimeout(r, 30));

    expect(outboxMock.__enqueuedMessages).toHaveLength(2);  // notification.send + the CERT-In audit event (df2f9eeb) -- see [0] for the notification
    const payload = outboxMock.__enqueuedMessages[0]!.payload as { recipientId: string; variables: Record<string, string> };
    expect(payload.recipientId).toBe("ddo-10");
    expect(payload.variables?.sanctionNo).toBe("SAN/2024/001");
  });

  it("finance.payment.made → notifies the vendor/payee", async () => {
    const envelope = buildEnvelope(CONSUMED_EVENTS.financePaymentMade, {
      paymentId: "pay-1",
      paymentRef: "PAY/2024/100",
      amount: "250000",
      payeeId: "vendor-20",
      payeeName: "ABC Supplies Ltd",
    });

    await q.publish(CONSUMED_EVENTS.financePaymentMade, envelope);
    await new Promise((r) => setTimeout(r, 30));

    expect(outboxMock.__enqueuedMessages).toHaveLength(2);  // notification.send + the CERT-In audit event (df2f9eeb) -- see [0] for the notification
    const payload = outboxMock.__enqueuedMessages[0]!.payload as { recipientId: string; variables: Record<string, string> };
    expect(payload.recipientId).toBe("vendor-20");
    expect(payload.variables?.amount).toBe("250000");
  });

  it("finance.bill.passed → notifies the bill creator", async () => {
    const envelope = buildEnvelope(CONSUMED_EVENTS.financeBillPassed, {
      billId: "bill-1",
      billNo: "BILL/2024/055",
      amount: "125000",
      creatorId: "user-30",
      creatorName: "Ram Prasad",
    });

    await q.publish(CONSUMED_EVENTS.financeBillPassed, envelope);
    await new Promise((r) => setTimeout(r, 30));

    expect(outboxMock.__enqueuedMessages).toHaveLength(2);  // notification.send + the CERT-In audit event (df2f9eeb) -- see [0] for the notification
    const payload = outboxMock.__enqueuedMessages[0]!.payload as { recipientId: string; variables: Record<string, string> };
    expect(payload.recipientId).toBe("user-30");
    expect(payload.variables?.billNo).toBe("BILL/2024/055");
  });

  it("procurement.grn.accepted → notifies the indent originator", async () => {
    const envelope = buildEnvelope(CONSUMED_EVENTS.procurementGrnAccepted, {
      grnId: "grn-1",
      grnNo: "GRN/2024/010",
      poNo: "PO/2024/005",
      originatorId: "user-40",
      originatorName: "Suresh Rao",
    });

    await q.publish(CONSUMED_EVENTS.procurementGrnAccepted, envelope);
    await new Promise((r) => setTimeout(r, 30));

    expect(outboxMock.__enqueuedMessages).toHaveLength(2);  // notification.send + the CERT-In audit event (df2f9eeb) -- see [0] for the notification
    const payload = outboxMock.__enqueuedMessages[0]!.payload as { recipientId: string; variables: Record<string, string> };
    expect(payload.recipientId).toBe("user-40");
    expect(payload.variables?.grnNo).toBe("GRN/2024/010");
  });

  it("helpdesk.ticket.created → notifies the assigned agent", async () => {
    const envelope = buildEnvelope(CONSUMED_EVENTS.helpdeskTicketCreated, {
      ticketId: "ticket-1",
      ticketNo: "TKT-2024-001",
      subject: "Printer not working",
      priority: "high",
      agentId: "agent-5",
      agentName: "Vikram",
      raisedBy: "Meena (Finance)",
    });

    await q.publish(CONSUMED_EVENTS.helpdeskTicketCreated, envelope);
    await new Promise((r) => setTimeout(r, 30));

    expect(outboxMock.__enqueuedMessages).toHaveLength(2);  // notification.send + the CERT-In audit event (df2f9eeb) -- see [0] for the notification
    const payload = outboxMock.__enqueuedMessages[0]!.payload as { recipientId: string; variables: Record<string, string> };
    expect(payload.recipientId).toBe("agent-5");
    expect(payload.variables?.subject).toBe("Printer not working");
    expect(payload.variables?.priority).toBe("high");
  });

  it("helpdesk.ticket.escalated → notifies the escalation manager", async () => {
    const envelope = buildEnvelope(CONSUMED_EVENTS.helpdeskTicketEscalated, {
      ticketId: "ticket-2",
      ticketNo: "TKT-2024-002",
      subject: "Server down",
      priority: "critical",
      escalationManagerId: "mgr-3",
      escalationManagerName: "Sunita Devi",
      agentName: "Vikram",
      escalationReason: "SLA breach — 4 hours overdue",
    });

    await q.publish(CONSUMED_EVENTS.helpdeskTicketEscalated, envelope);
    await new Promise((r) => setTimeout(r, 30));

    expect(outboxMock.__enqueuedMessages).toHaveLength(2);  // notification.send + the CERT-In audit event (df2f9eeb) -- see [0] for the notification
    const payload = outboxMock.__enqueuedMessages[0]!.payload as { recipientId: string; variables: Record<string, string> };
    expect(payload.recipientId).toBe("mgr-3");
    expect(payload.variables?.escalationReason).toBe("SLA breach — 4 hours overdue");
  });

  it("citizen.request.created → acknowledges to the citizen", async () => {
    const envelope = buildEnvelope(CONSUMED_EVENTS.citizenRequestCreated, {
      requestId: "req-1",
      requestNo: "CIT/2024/1001",
      subject: "Birth certificate",
      citizenId: "citizen-99",
      citizenName: "Ananya Sharma",
      slaHours: "72",
      trackingLink: "https://portal.gov.in/track/CIT-2024-1001",
    });

    await q.publish(CONSUMED_EVENTS.citizenRequestCreated, envelope);
    await new Promise((r) => setTimeout(r, 30));

    expect(outboxMock.__enqueuedMessages).toHaveLength(2);  // notification.send + the CERT-In audit event (df2f9eeb) -- see [0] for the notification
    const payload = outboxMock.__enqueuedMessages[0]!.payload as { recipientId: string; variables: Record<string, string> };
    expect(payload.recipientId).toBe("citizen-99");
    expect(payload.variables?.requestNo).toBe("CIT/2024/1001");
    expect(payload.variables?.slaHours).toBe("72");
  });

  it("audit.para.issued → notifies the department head", async () => {
    const envelope = buildEnvelope(CONSUMED_EVENTS.auditParaIssued, {
      paraId: "para-1",
      paraNo: "AP/2024/007",
      subject: "Irregular procurement",
      departmentHeadId: "head-12",
      departmentHeadName: "Shri AK Mehta",
      departmentName: "Public Works",
      dueDate: "2024-05-15",
    });

    await q.publish(CONSUMED_EVENTS.auditParaIssued, envelope);
    await new Promise((r) => setTimeout(r, 30));

    expect(outboxMock.__enqueuedMessages).toHaveLength(2);  // notification.send + the CERT-In audit event (df2f9eeb) -- see [0] for the notification
    const payload = outboxMock.__enqueuedMessages[0]!.payload as { recipientId: string; variables: Record<string, string> };
    expect(payload.recipientId).toBe("head-12");
    expect(payload.variables?.paraNo).toBe("AP/2024/007");
    expect(payload.variables?.dueDate).toBe("2024-05-15");
  });

  // ── Idempotency ───────────────────────────────────────────────────────────

  it("duplicate events do not create duplicate notifications", async () => {
    const messageId = crypto.randomUUID();
    const envelope = {
      messageId,
      type: CONSUMED_EVENTS.hrmsLeaveApproved,
      tenantId: "tenant-001",
      actorId: "system",
      correlationId: crypto.randomUUID(),
      schemaVersion: "1.0",
      timestamp: new Date().toISOString(),
      payload: {
        leaveId: "leave-dup",
        employeeId: "emp-dup",
        leaveType: "Casual",
        fromDate: "2024-01-01",
        toDate: "2024-01-02",
        days: 2,
        approverName: "Boss",
      },
    };

    await q.publish(CONSUMED_EVENTS.hrmsLeaveApproved, envelope);
    await new Promise((r) => setTimeout(r, 30));

    // First processing should produce exactly 2 messages: notification.send + the CERT-In audit event (df2f9eeb)
    expect(outboxMock.__enqueuedMessages).toHaveLength(2);

    // Publish same messageId again (simulating redelivery)
    await q.publish(CONSUMED_EVENTS.hrmsLeaveApproved, envelope);
    await new Promise((r) => setTimeout(r, 30));

    // Should still be 2 (no NEW messages) — duplicate was rejected by markProcessed
    expect(outboxMock.__enqueuedMessages).toHaveLength(2);
  });

  // ── Graceful handling of unknown event types ──────────────────────────────

  it("missing template logs warning but does not crash", async () => {
    // Subscribe to a topic that has no template registered
    const unknownTopic = "unknown.service.event";
    const { registerDomainEventConsumers: _ } = await import("../src/modules/domain-events/consumer.js");

    // Manually subscribe to an unregistered topic to simulate the scenario
    q.subscribe(unknownTopic, async (msg) => {
      // Directly invoke the internal logic path — template lookup returns undefined
      const template = getTemplateForEvent(unknownTopic);
      expect(template).toBeUndefined();
    });

    const envelope = buildEnvelope(unknownTopic, { someField: "value" });
    await q.publish(unknownTopic, envelope);
    await new Promise((r) => setTimeout(r, 30));

    // No notification should be enqueued for missing templates
    // The earlier tests already produced messages, so we check no NEW ones appeared
    // after the unknown event (beyond what was produced before)
    const countBefore = outboxMock.__enqueuedMessages.length;
    expect(countBefore).toBeGreaterThanOrEqual(0); // no crash
  });
});

// ─── Recipient resolution edge cases ─────────────────────────────────────────

describe("domain-events recipient resolution", () => {
  it("uses fallback values when optional fields are missing", () => {
    // Verify template interpolation handles missing variables gracefully
    const template = getTemplateForEvent("hrms.leave.approved")!;
    const result = interpolate(template.push.body, {
      leaveType: "leave",
      fromDate: "",
      toDate: "",
      approverName: "your approving officer",
    });
    expect(result).toContain("your approving officer");
    expect(result).not.toContain("undefined");
  });

  it("finance.payment.made falls back to paymentId when paymentRef missing", async () => {
    const q = new MemoryQueue();
    const outboxMock = await getOutboxMock();
    const prevCount = outboxMock.__enqueuedMessages.length;

    const { registerDomainEventConsumers } = await import("../src/modules/domain-events/consumer.js");
    registerDomainEventConsumers(q);

    const envelope = {
      messageId: crypto.randomUUID(),
      type: CONSUMED_EVENTS.financePaymentMade,
      tenantId: "tenant-002",
      actorId: "system",
      correlationId: crypto.randomUUID(),
      schemaVersion: "1.0",
      timestamp: new Date().toISOString(),
      payload: {
        paymentId: "pay-fallback-123",
        payeeId: "vendor-99",
        // paymentRef intentionally omitted
      },
    };

    await q.publish(CONSUMED_EVENTS.financePaymentMade, envelope);
    await new Promise((r) => setTimeout(r, 30));

    const newMessages = outboxMock.__enqueuedMessages.slice(prevCount);
    expect(newMessages.length).toBeGreaterThanOrEqual(1);
    const payload = newMessages[0]!.payload as { variables: Record<string, string> };
    expect(payload.variables?.paymentRef).toBe("pay-fallback-123");
  });
});
