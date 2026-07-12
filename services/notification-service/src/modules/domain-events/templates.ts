/**
 * Notification template registry for cross-service domain events.
 *
 * Maps each consumed event type to title + body templates for push and email channels.
 * Templates use {{placeholder}} syntax; variables are interpolated at delivery time.
 */

export type ChannelTemplate = {
  title: string;
  body: string;
};

export type NotificationTemplate = {
  eventType: string;
  push: ChannelTemplate;
  email: ChannelTemplate;
};

const TEMPLATES: ReadonlyArray<NotificationTemplate> = [
  {
    eventType: "hrms.leave.approved",
    push: {
      title: "Leave Approved",
      body: "Your {{leaveType}} leave from {{fromDate}} to {{toDate}} has been approved by {{approverName}}.",
    },
    email: {
      title: "Leave Application Approved — {{leaveType}}",
      body: "Dear {{employeeName}},\n\nYour {{leaveType}} leave application from {{fromDate}} to {{toDate}} ({{days}} days) has been approved by {{approverName}}.\n\nRegards,\nHR Department",
    },
  },
  {
    eventType: "hrms.leave.applied",
    push: {
      title: "New Leave Application",
      body: "{{employeeName}} has applied for {{leaveType}} leave from {{fromDate}} to {{toDate}}. Action required.",
    },
    email: {
      title: "Leave Application Pending Approval — {{employeeName}}",
      body: "Dear {{approverName}},\n\n{{employeeName}} ({{employeeDesignation}}) has applied for {{leaveType}} leave from {{fromDate}} to {{toDate}} ({{days}} days).\n\nPlease review and take action.\n\nRegards,\nHR System",
    },
  },
  {
    eventType: "finance.sanction.approved",
    push: {
      title: "Sanction Approved",
      body: "Sanction order {{sanctionNo}} for ₹{{amount}} has been approved.",
    },
    email: {
      title: "Sanction Order Approved — {{sanctionNo}}",
      body: "Dear {{ddoName}},\n\nSanction order {{sanctionNo}} for ₹{{amount}} under Head of Account {{hoaCode}} has been approved.\n\nRegards,\nFinance Department",
    },
  },
  {
    eventType: "finance.payment.made",
    push: {
      title: "Payment Processed",
      body: "Payment of ₹{{amount}} (Ref: {{paymentRef}}) has been credited to your account.",
    },
    email: {
      title: "Payment Confirmation — {{paymentRef}}",
      body: "Dear {{payeeName}},\n\nA payment of ₹{{amount}} (Reference: {{paymentRef}}) has been processed and credited to your registered account.\n\nRegards,\nFinance Department",
    },
  },
  {
    eventType: "finance.bill.passed",
    push: {
      title: "Bill Passed",
      body: "Bill {{billNo}} for ₹{{amount}} has been passed for payment.",
    },
    email: {
      title: "Bill Passed for Payment — {{billNo}}",
      body: "Dear {{creatorName}},\n\nBill {{billNo}} for ₹{{amount}} that you submitted has been passed for payment.\n\nRegards,\nFinance Department",
    },
  },
  {
    eventType: "procurement.grn.accepted",
    push: {
      title: "GRN Accepted",
      body: "Goods Receipt Note {{grnNo}} against PO {{poNo}} has been accepted.",
    },
    email: {
      title: "GRN Accepted — {{grnNo}}",
      body: "Dear {{originatorName}},\n\nGoods Receipt Note {{grnNo}} against Purchase Order {{poNo}} has been inspected and accepted.\n\nRegards,\nProcurement Department",
    },
  },
  {
    eventType: "helpdesk.ticket.created",
    push: {
      title: "New Ticket Assigned",
      body: "Ticket #{{ticketNo}} — \"{{subject}}\" ({{priority}}) has been assigned to you.",
    },
    email: {
      title: "New Ticket Assigned — #{{ticketNo}}",
      body: "Dear {{agentName}},\n\nA new {{priority}} priority ticket has been assigned to you:\n\nTicket: #{{ticketNo}}\nSubject: {{subject}}\nRaised by: {{raisedBy}}\n\nPlease attend to this at the earliest.\n\nRegards,\nHelpdesk System",
    },
  },
  {
    eventType: "helpdesk.ticket.escalated",
    push: {
      title: "Ticket Escalated",
      body: "Ticket #{{ticketNo}} — \"{{subject}}\" has been escalated to you.",
    },
    email: {
      title: "Ticket Escalated — #{{ticketNo}}",
      body: "Dear {{escalationManagerName}},\n\nTicket #{{ticketNo}} (\"{{subject}}\") has been escalated due to {{escalationReason}}.\n\nOriginal Agent: {{agentName}}\nPriority: {{priority}}\n\nPlease review and take action.\n\nRegards,\nHelpdesk System",
    },
  },
  {
    eventType: "citizen.request.created",
    push: {
      title: "Request Received",
      body: "Your request #{{requestNo}} has been received. We will respond within {{slaHours}} hours.",
    },
    email: {
      title: "Request Acknowledged — #{{requestNo}}",
      body: "Dear {{citizenName}},\n\nYour request #{{requestNo}} (\"{{subject}}\") has been received and registered.\n\nExpected response time: {{slaHours}} hours.\nTracking link: {{trackingLink}}\n\nRegards,\nCitizen Services",
    },
  },
  {
    eventType: "audit.para.issued",
    push: {
      title: "Audit Para Issued",
      body: "Audit para {{paraNo}} has been issued for your department. Response required by {{dueDate}}.",
    },
    email: {
      title: "Audit Para Issued — {{paraNo}}",
      body: "Dear {{departmentHeadName}},\n\nAudit para {{paraNo}} has been issued for {{departmentName}}.\n\nSubject: {{subject}}\nResponse due by: {{dueDate}}\n\nPlease coordinate with the concerned section and submit the response.\n\nRegards,\nAudit Department",
    },
  },
  {
    eventType: "ml.prediction.breach_risk_high",
    push: {
      title: "SLA Breach Risk Detected",
      body: "A ticket has high predicted SLA breach risk. Review and consider reassignment.",
    },
    email: {
      title: "SLA Breach Risk Alert",
      body: "A helpdesk ticket has been flagged with high SLA breach probability. Please review the ticket and consider reassignment to avoid SLA violation.\n\nRegards,\nML Intelligence System",
    },
  },
  {
    eventType: "ml.prediction.task_high_risk",
    push: {
      title: "High Task Delay Risk",
      body: "A project task has been flagged with high delay risk. Consider resource reallocation.",
    },
    email: {
      title: "Project Task Delay Risk Alert",
      body: "A project task has been flagged with high delay risk based on schedule variance and resource contention analysis. Please review and consider corrective action.\n\nRegards,\nML Intelligence System",
    },
  },
  {
    eventType: "ml.prediction.churn_risk_high",
    push: {
      title: "Subscription Churn Risk",
      body: "A subscription has been flagged with high churn probability. Review retention actions.",
    },
    email: {
      title: "Subscription Churn Risk Alert",
      body: "A subscription has been identified as at-risk for churn based on usage patterns and engagement metrics. Please review and initiate retention measures.\n\nRegards,\nML Intelligence System",
    },
  },
  {
    eventType: "ml.prediction.anomaly_detected",
    push: {
      title: "Financial Anomaly Detected",
      body: "A transaction has been flagged as anomalous. Review for potential issues.",
    },
    email: {
      title: "Financial Anomaly Alert",
      body: "A financial transaction has been flagged as anomalous based on historical spending patterns. Please review the transaction for potential errors or irregularities.\n\nRegards,\nML Intelligence System",
    },
  },
  {
    eventType: "visitor.security_incident.created",
    push: {
      title: "Security Incident Raised",
      body: "A {{severity}} security incident ({{incidentType}}) has been raised at location {{locationId}}. Please respond.",
    },
    email: {
      title: "Security Incident \u2014 {{incidentType}} ({{severity}})",
      body: "A {{severity}} priority security incident of type {{incidentType}} has been raised at location {{locationId}}.\n\nReference: {{reference}}\n\nPlease investigate and take appropriate action.\n\nRegards,\nVisitor Management Security",
    },
  },
  {
    eventType: "visitor.scan.blacklist_match",
    push: {
      title: "Blacklist Match at Scan",
      body: "A scanned identity document ({{idDocumentType}}) matched the blacklist. Session {{sessionId}}. Verify at the gate.",
    },
    email: {
      title: "Blacklist Match on Document Scan",
      body: "A scanned identity document of type {{idDocumentType}} matched the security blacklist during check-in.\n\nScan session: {{sessionId}}\n\nPlease verify the visitor at the gate before granting entry.\n\nRegards,\nVisitor Management Security",
    },
  },
  {
    eventType: "visitor.tailgating.detected",
    push: {
      title: "Tailgating Detected",
      body: "Tailgating at gate {{gateId}} (pass {{passId}}): {{passageCount}} passages, tolerance {{tolerance}}. Please check.",
    },
    email: {
      title: "Tailgating Detected \u2014 Gate {{gateId}}",
      body: "A tailgating event was detected at gate {{gateId}} for pass {{passId}}.\n\nPassage count: {{passageCount}} (tolerance {{tolerance}})\n\nPlease review the gate and confirm no unauthorised entry occurred.\n\nRegards,\nVisitor Management Security",
    },
  },
  {
    eventType: "visitor.anti_passback.violation",
    push: {
      title: "Anti-Passback Violation",
      body: "Anti-passback violation at gate {{gateId}} (pass {{passId}}): direction {{direction}}, last {{lastKnownDirection}}.",
    },
    email: {
      title: "Anti-Passback Violation \u2014 Gate {{gateId}}",
      body: "An anti-passback violation was detected at gate {{gateId}} for pass {{passId}}.\n\nRequested direction: {{direction}}\nLast known direction: {{lastKnownDirection}}\n\nPlease verify the pass holder's movement.\n\nRegards,\nVisitor Management Security",
    },
  },
  {
    eventType: "visitor.emergency.unlock.triggered",
    push: {
      title: "Emergency Unlock Triggered",
      body: "Emergency unlock triggered at location {{locationId}} ({{reason}}). {{deviceCount}} devices released.",
    },
    email: {
      title: "Emergency Unlock Triggered \u2014 Location {{locationId}}",
      body: "An emergency unlock was triggered at location {{locationId}}.\n\nReason: {{reason}}\nDevices released: {{deviceCount}}\nTriggered at: {{triggeredAt}}\n\nPlease confirm the situation and secure the location once safe.\n\nRegards,\nVisitor Management Security",
    },
  },
];

const templateMap = new Map<string, NotificationTemplate>();
for (const t of TEMPLATES) {
  templateMap.set(t.eventType, t);
}

/**
 * Look up a notification template by event type.
 * Returns undefined when no template is registered for the given event type.
 */
export function getTemplateForEvent(eventType: string): NotificationTemplate | undefined {
  return templateMap.get(eventType);
}

/**
 * Interpolate {{placeholder}} tokens in a template string with variable values.
 * Unresolved placeholders are left as-is (graceful degradation).
 */
export function interpolate(template: string, variables: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key: string) => {
    return variables[key] ?? match;
  });
}

/** All registered event types (for validation/testing). */
export function getRegisteredEventTypes(): string[] {
  return [...templateMap.keys()];
}
