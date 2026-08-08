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

export const NOTIFICATION_EVENTS: { id: NotificationEvent; label: string }[] = [
  { id: "submitted", label: "Application submitted" },
  { id: "approved", label: "Approved" },
  { id: "rejected", label: "Rejected" },
  { id: "payment_due", label: "Payment due" },
  { id: "payment_received", label: "Payment received" },
  { id: "issued", label: "Certificate issued" },
  { id: "inspection_scheduled", label: "Inspection scheduled" },
];

export const NOTIFICATION_CHANNELS: { id: NotificationChannel; label: string }[] = [
  { id: "sms", label: "SMS" },
  { id: "email", label: "Email" },
  { id: "whatsapp", label: "WhatsApp" },
  { id: "in_app", label: "In-app" },
];

const DEFAULT_TEMPLATES: Partial<Record<NotificationEvent, Partial<Record<NotificationChannel, LocaleTemplateBody>>>> = {
  submitted: {
    sms: { en: "Your {{service_name}} application {{app_no}} was received.", hi: "आपका {{service_name}} आवेदन {{app_no}} प्राप्त हुआ।" },
    email: { en: "We received your {{service_name}} application ({{app_no}}).", hi: "हमें आपका {{service_name}} आवेदन ({{app_no}}) प्राप्त हुआ।" },
    in_app: { en: "Application {{app_no}} submitted.", hi: "आवेदन {{app_no}} जमा किया गया।" },
  },
  payment_due: {
    sms: { en: "Pay ₹{{amount}} for {{service_name}}: {{pay_link}}", hi: "{{service_name}} के लिए ₹{{amount}} भुगतान करें: {{pay_link}}" },
    whatsapp: { en: "Payment of ₹{{amount}} is due for {{service_name}}.", hi: "{{service_name}} के लिए ₹{{amount}} का भुगतान देय है।" },
  },
  issued: {
    sms: { en: "Your {{service_name}} certificate {{cert_no}} is ready.", hi: "आपका {{service_name}} प्रमाणपत्र {{cert_no}} तैयार है।" },
    email: { en: "Certificate {{cert_no}} for {{service_name}} has been issued.", hi: "{{service_name}} का प्रमाणपत्र {{cert_no}} जारी किया गया।" },
  },
};

export function seedMatrixForPattern(_pattern: string): NotificationMatrixState {
  const matrix = {} as NotificationMatrixState;
  for (const event of NOTIFICATION_EVENTS) {
    matrix[event.id] = {};
    const defaults = DEFAULT_TEMPLATES[event.id];
    for (const ch of NOTIFICATION_CHANNELS) {
      const body = defaults?.[ch.id];
      if (body) {
        matrix[event.id]![ch.id] = {
          enabled: true,
          body,
          subject: ch.id === "email" ? { en: "{{service_name}} update", hi: "{{service_name}} अपडेट" } : undefined,
        };
      }
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
