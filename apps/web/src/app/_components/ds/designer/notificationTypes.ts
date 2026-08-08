export type NotificationChannel = "sms" | "email" | "whatsapp" | "in_app";

export type NotificationEvent =
  | "submitted"
  | "approved"
  | "rejected"
  | "payment_due"
  | "payment_received"
  | "issued"
  | "inspection_scheduled";

export interface LocaleTemplateBody {
  en: string;
  hi: string;
}

export interface NotificationCellBinding {
  enabled: boolean;
  templateId?: string;
  templateName?: string;
  body: LocaleTemplateBody;
  subject?: LocaleTemplateBody;
}

export type NotificationMatrixState = Record<
  NotificationEvent,
  Partial<Record<NotificationChannel, NotificationCellBinding>>
>;

export interface NotificationsDesignState {
  matrix: NotificationMatrixState;
}

export const NOTIFICATION_EVENTS: { id: NotificationEvent; label: string; hint: string }[] = [
  { id: "submitted", label: "Application submitted", hint: "Sent when the applicant submits." },
  { id: "approved", label: "Approved", hint: "Decision approved / case resolved." },
  { id: "rejected", label: "Rejected", hint: "Decision rejected / returned." },
  { id: "payment_due", label: "Payment due", hint: "Demand raised — pay link + amount." },
  { id: "payment_received", label: "Payment received", hint: "Payment confirmed." },
  { id: "issued", label: "Certificate issued", hint: "Output ready to download." },
  { id: "inspection_scheduled", label: "Inspection scheduled", hint: "Field visit booked." },
];

export const NOTIFICATION_CHANNELS: { id: NotificationChannel; label: string; hint: string }[] = [
  { id: "sms", label: "SMS", hint: "Short text; keep under 160 characters when possible." },
  { id: "email", label: "Email", hint: "Subject + longer body." },
  { id: "whatsapp", label: "WhatsApp", hint: "Conversational bubble; template-friendly wording." },
  { id: "in_app", label: "In-app", hint: "Shown on the applicant tracking screen." },
];

type TemplateSeed = Partial<Record<NotificationChannel, LocaleTemplateBody>>;

const SHARED: Partial<Record<NotificationEvent, TemplateSeed>> = {
  submitted: {
    sms: {
      en: "Your {{service_name}} application {{app_no}} was received.",
      hi: "आपका {{service_name}} आवेदन {{app_no}} प्राप्त हुआ।",
    },
    email: {
      en: "We received your {{service_name}} application ({{app_no}}). Track status any time from your applications.",
      hi: "हमें आपका {{service_name}} आवेदन ({{app_no}}) प्राप्त हुआ। स्थिति अपने आवेदनों से देखें।",
    },
    in_app: {
      en: "Application {{app_no}} submitted for {{service_name}}.",
      hi: "{{service_name}} के लिए आवेदन {{app_no}} जमा किया गया।",
    },
  },
  approved: {
    sms: {
      en: "{{service_name}} {{app_no}} was approved.",
      hi: "{{service_name}} {{app_no}} स्वीकृत हुआ।",
    },
    email: {
      en: "Good news — your {{service_name}} application {{app_no}} has been approved.",
      hi: "शुभ समाचार — आपका {{service_name}} आवेदन {{app_no}} स्वीकृत हो गया है।",
    },
    in_app: {
      en: "{{app_no}} approved.",
      hi: "{{app_no}} स्वीकृत।",
    },
  },
  rejected: {
    sms: {
      en: "{{service_name}} {{app_no}} was not approved. See tracking for details.",
      hi: "{{service_name}} {{app_no}} स्वीकृत नहीं हुआ। विवरण ट्रैकिंग में देखें।",
    },
    email: {
      en: "Your {{service_name}} application {{app_no}} was not approved. Open tracking for the reason and next steps.",
      hi: "आपका {{service_name}} आवेदन {{app_no}} स्वीकृत नहीं हुआ। कारण और अगले कदम ट्रैकिंग में देखें।",
    },
    in_app: {
      en: "{{app_no}} not approved — see details.",
      hi: "{{app_no}} स्वीकृत नहीं — विवरण देखें।",
    },
  },
  payment_due: {
    sms: {
      en: "Pay ₹{{amount}} for {{service_name}}: {{pay_link}}",
      hi: "{{service_name}} के लिए ₹{{amount}} भुगतान करें: {{pay_link}}",
    },
    email: {
      en: "A payment of ₹{{amount}} is due for {{service_name}} ({{app_no}}). Pay here: {{pay_link}}",
      hi: "{{service_name}} ({{app_no}}) के लिए ₹{{amount}} का भुगतान देय है: {{pay_link}}",
    },
    whatsapp: {
      en: "Payment of ₹{{amount}} is due for {{service_name}}. Pay: {{pay_link}}",
      hi: "{{service_name}} के लिए ₹{{amount}} का भुगतान देय है। भुगतान: {{pay_link}}",
    },
    in_app: {
      en: "Pay ₹{{amount}} for {{app_no}}.",
      hi: "{{app_no}} के लिए ₹{{amount}} भुगतान करें।",
    },
  },
  payment_received: {
    sms: {
      en: "Payment of ₹{{amount}} received for {{service_name}} {{app_no}}.",
      hi: "{{service_name}} {{app_no}} के लिए ₹{{amount}} भुगतान प्राप्त।",
    },
    email: {
      en: "We received ₹{{amount}} for {{service_name}} application {{app_no}}.",
      hi: "{{service_name}} आवेदन {{app_no}} के लिए ₹{{amount}} प्राप्त हुआ।",
    },
    in_app: {
      en: "Payment received for {{app_no}}.",
      hi: "{{app_no}} का भुगतान प्राप्त।",
    },
  },
  issued: {
    sms: {
      en: "Your {{service_name}} certificate {{cert_no}} is ready.",
      hi: "आपका {{service_name}} प्रमाणपत्र {{cert_no}} तैयार है।",
    },
    email: {
      en: "Certificate {{cert_no}} for {{service_name}} has been issued. Download it from tracking.",
      hi: "{{service_name}} का प्रमाणपत्र {{cert_no}} जारी किया गया। ट्रैकिंग से डाउनलोड करें।",
    },
    whatsapp: {
      en: "Your {{service_name}} certificate {{cert_no}} is ready to download.",
      hi: "आपका {{service_name}} प्रमाणपत्र {{cert_no}} डाउनलोड के लिए तैयार है।",
    },
    in_app: {
      en: "Certificate {{cert_no}} ready.",
      hi: "प्रमाणपत्र {{cert_no}} तैयार।",
    },
  },
  inspection_scheduled: {
    sms: {
      en: "Inspection for {{service_name}} {{app_no}} is scheduled. Check tracking for details.",
      hi: "{{service_name}} {{app_no}} का निरीक्षण निर्धारित है। विवरण ट्रैकिंग में देखें।",
    },
    in_app: {
      en: "Inspection scheduled for {{app_no}}.",
      hi: "{{app_no}} का निरीक्षण निर्धारित।",
    },
  },
};

const GRIEVANCE_OVERRIDES: Partial<Record<NotificationEvent, TemplateSeed>> = {
  approved: {
    sms: {
      en: "Your grievance {{app_no}} was resolved.",
      hi: "आपकी शिकायत {{app_no}} निपटाई गई।",
    },
    email: {
      en: "Your grievance {{app_no}} for {{service_name}} has been resolved. See the closure note in tracking.",
      hi: "{{service_name}} की शिकायत {{app_no}} निपटाई गई। क्लोज़र नोट ट्रैकिंग में देखें।",
    },
    in_app: {
      en: "Grievance {{app_no}} resolved.",
      hi: "शिकायत {{app_no}} निपटाई गई।",
    },
  },
  issued: {
    sms: {
      en: "Closure note for grievance {{app_no}} is ready.",
      hi: "शिकायत {{app_no}} का क्लोज़र नोट तैयार है।",
    },
    email: {
      en: "A closure note for grievance {{app_no}} ({{service_name}}) is ready in tracking.",
      hi: "शिकायत {{app_no}} ({{service_name}}) का क्लोज़र नोट ट्रैकिंग में तैयार है।",
    },
    in_app: {
      en: "Closure note ready for {{app_no}}.",
      hi: "{{app_no}} का क्लोज़र नोट तैयार।",
    },
  },
};

/** Lifecycle events that are typically active for each Service Pattern (P2 defaults). */
export function eventsForPattern(pattern: string): NotificationEvent[] {
  switch (pattern) {
    case "booking":
      return ["submitted", "approved", "rejected", "payment_due", "payment_received", "issued"];
    case "collection":
      return ["submitted", "payment_due", "payment_received", "issued"];
    case "grievance":
      return ["submitted", "approved", "rejected", "issued", "inspection_scheduled"];
    default:
      return NOTIFICATION_EVENTS.map((e) => e.id);
  }
}

function seedForPattern(pattern: string): Partial<Record<NotificationEvent, TemplateSeed>> {
  const base: Partial<Record<NotificationEvent, TemplateSeed>> = { ...SHARED };
  if (pattern === "grievance") {
    return { ...base, ...GRIEVANCE_OVERRIDES };
  }
  if (pattern === "collection") {
    const { approved: _a, rejected: _r, inspection_scheduled: _i, ...rest } = base;
    return rest;
  }
  if (pattern === "booking") {
    const { inspection_scheduled: _i, ...rest } = base;
    return rest;
  }
  return base;
}

function emptyMatrix(): NotificationMatrixState {
  const matrix = {} as NotificationMatrixState;
  for (const event of NOTIFICATION_EVENTS) {
    matrix[event.id] = {};
  }
  return matrix;
}

export function seedMatrixForPattern(pattern: string): NotificationMatrixState {
  const matrix = emptyMatrix();
  const defaults = seedForPattern(pattern);
  const activeEvents = new Set(eventsForPattern(pattern));

  for (const event of NOTIFICATION_EVENTS) {
    if (!activeEvents.has(event.id)) continue;
    const channels = defaults[event.id];
    if (!channels) continue;
    for (const ch of NOTIFICATION_CHANNELS) {
      const body = channels[ch.id];
      if (!body) continue;
      matrix[event.id]![ch.id] = {
        enabled: true,
        body: { ...body },
        subject:
          ch.id === "email"
            ? { en: "{{service_name}} update", hi: "{{service_name}} अपडेट" }
            : undefined,
        templateName: `${event.label} · ${ch.label}`,
      };
    }
  }
  return matrix;
}

export function emptyNotificationsDesign(pattern: string): NotificationsDesignState {
  return { matrix: seedMatrixForPattern(pattern) };
}

export function smsSegmentCount(text: string): number {
  const len = text.length;
  if (len === 0) return 0;
  return len <= 160 ? 1 : Math.ceil(len / 153);
}

export function smsCharCount(text: string): number {
  return text.length;
}

export function smsStats(text: string): { chars: number; segments: number; warn: string | null } {
  const chars = smsCharCount(text);
  const segments = smsSegmentCount(text);
  let warn: string | null = null;
  if (chars > 160) {
    warn = `Longer than one SMS segment (${chars} characters → ${segments} segments).`;
  }
  return { chars, segments, warn };
}

export function cellChipLabel(cell: NotificationCellBinding | undefined): string {
  if (!cell?.enabled) return "Off";
  if (cell.templateName?.trim()) return cell.templateName.trim();
  const hasBody = Boolean(cell.body.en.trim() || cell.body.hi.trim());
  return hasBody ? "On · Edit" : "On · empty";
}

export function enableCell(
  matrix: NotificationMatrixState,
  event: NotificationEvent,
  channel: NotificationChannel,
): NotificationMatrixState {
  const cell = matrix[event]?.[channel];
  return {
    ...matrix,
    [event]: {
      ...matrix[event],
      [channel]: {
        enabled: true,
        body: cell?.body ?? { en: "", hi: "" },
        subject:
          cell?.subject ??
          (channel === "email" ? { en: "{{service_name}} update", hi: "{{service_name}} अपडेट" } : undefined),
        templateId: cell?.templateId,
        templateName: cell?.templateName,
      },
    },
  };
}

export function disableCell(
  matrix: NotificationMatrixState,
  event: NotificationEvent,
  channel: NotificationChannel,
): NotificationMatrixState {
  const cell = matrix[event]?.[channel];
  return {
    ...matrix,
    [event]: {
      ...matrix[event],
      [channel]: {
        enabled: false,
        body: cell?.body ?? { en: "", hi: "" },
        subject: cell?.subject,
        templateId: cell?.templateId,
        templateName: cell?.templateName,
      },
    },
  };
}

export function patchCell(
  matrix: NotificationMatrixState,
  event: NotificationEvent,
  channel: NotificationChannel,
  patch: Partial<NotificationCellBinding>,
): NotificationMatrixState {
  const cell = matrix[event]?.[channel] ?? { enabled: true, body: { en: "", hi: "" } };
  return {
    ...matrix,
    [event]: {
      ...matrix[event],
      [channel]: { ...cell, ...patch },
    },
  };
}

/** Substitute {{tokens}} with sample values; unknown tokens stay as ⟨key⟩ pills. */
export function applyMergeSample(text: string, values: Record<string, string>): string {
  return text.replace(/\{\{([^}]+)\}\}/g, (_, key: string) => {
    const k = key.trim();
    if (values[k] != null && values[k] !== "") return values[k];
    return `⟨${k}⟩`;
  });
}

export function channelPreviewTitle(channel: NotificationChannel): string {
  switch (channel) {
    case "sms":
      return "SMS preview";
    case "email":
      return "Email preview";
    case "whatsapp":
      return "WhatsApp preview";
    case "in_app":
      return "In-app preview";
  }
}

export function eventLabel(event: NotificationEvent): string {
  return NOTIFICATION_EVENTS.find((e) => e.id === event)?.label ?? event;
}

export function channelLabel(channel: NotificationChannel): string {
  return NOTIFICATION_CHANNELS.find((c) => c.id === channel)?.label ?? channel;
}
