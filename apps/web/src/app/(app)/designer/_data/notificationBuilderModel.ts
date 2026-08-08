import type { FormFieldDefinition, FormDesignState } from "@/app/_components/ds/designer/formTypes";
import type { LocaleKey } from "@/app/_components/ds/designer/LocaleTabs";
import type { MergeField } from "@/app/_components/ds/designer/MergeFieldPicker";
import {
  NOTIFICATION_CHANNELS,
  NOTIFICATION_EVENTS,
  eventsForPattern,
  type NotificationCellBinding,
  type NotificationMatrixState,
  type NotificationsDesignState,
} from "@/app/_components/ds/designer/notificationTypes";

/** Core merge fields for notification templates (FN-08). */
export const NOTIFICATION_MERGE_FIELDS: MergeField[] = [
  { key: "applicant_name", label: "Applicant name", group: "Application" },
  { key: "app_no", label: "Application number", group: "Application" },
  { key: "service_name", label: "Service name", group: "Service" },
  { key: "cert_no", label: "Certificate number", group: "Issuance" },
  { key: "amount", label: "Fee amount", group: "Payment" },
  { key: "pay_link", label: "Payment link", group: "Payment" },
  { key: "office_name", label: "Office name", group: "Tenant" },
  { key: "ward", label: "Ward", group: "Location" },
  { key: "status", label: "Status", group: "Application" },
];

export interface SampleNotificationValues {
  applicant_name: string;
  app_no: string;
  service_name: string;
  cert_no: string;
  amount: string;
  pay_link: string;
  office_name: string;
  ward: string;
  status: string;
  [key: string]: string;
}

export function defaultSampleValues(serviceName = "Trade License"): SampleNotificationValues {
  return {
    applicant_name: "Asha Devi",
    app_no: "TL/2026/00041",
    service_name: serviceName,
    cert_no: "TL/W12/2026/00041",
    amount: "500",
    pay_link: "https://pay.example.gov/d/demo",
    office_name: "Ward 12 Municipal Office",
    ward: "Ward 12",
    status: "Submitted",
  };
}

export function mergeFieldsForNotifications(formFields: FormFieldDefinition[] = []): MergeField[] {
  const formMerge: MergeField[] = formFields
    .filter((f) => f.apiName)
    .map((f) => ({
      key: f.apiName,
      label: f.label || f.apiName,
      group: "Form answers",
    }));
  const seen = new Set<string>();
  const out: MergeField[] = [];
  for (const field of [...NOTIFICATION_MERGE_FIELDS, ...formMerge]) {
    if (seen.has(field.key)) continue;
    seen.add(field.key);
    out.push(field);
  }
  return out;
}

export interface MatrixCompleteness {
  enabledCount: number;
  configuredSlots: number;
  locale: {
    en: { filled: number; total: number };
    hi: { filled: number; total: number };
  };
  meterLabel: string;
  /** True when every enabled cell has both EN and HI body text. */
  localesComplete: boolean;
}

export function matrixCompleteness(
  matrix: NotificationMatrixState,
  pattern: string,
): MatrixCompleteness {
  const active = new Set(eventsForPattern(pattern));
  let enabledCount = 0;
  let configuredSlots = 0;
  let enFilled = 0;
  let hiFilled = 0;
  let localeTotal = 0;

  for (const event of NOTIFICATION_EVENTS) {
    if (!active.has(event.id)) continue;
    for (const ch of NOTIFICATION_CHANNELS) {
      configuredSlots += 1;
      const cell = matrix[event.id]?.[ch.id];
      if (!cell?.enabled) continue;
      enabledCount += 1;
      localeTotal += 1;
      if (cell.body.en.trim()) enFilled += 1;
      if (cell.body.hi.trim()) hiFilled += 1;
    }
  }

  return {
    enabledCount,
    configuredSlots,
    locale: {
      en: { filled: enFilled, total: localeTotal },
      hi: { filled: hiFilled, total: localeTotal },
    },
    meterLabel: `EN ${enFilled}/${localeTotal} · HI ${hiFilled}/${localeTotal}`,
    localesComplete: localeTotal > 0 && enFilled === localeTotal && hiFilled === localeTotal,
  };
}

/** Compact FormDesign for sample answers that drive notification merge preview. */
export function sampleFormDesignFromFields(
  formFields: FormFieldDefinition[],
  serviceName: string,
): FormDesignState {
  if (formFields.length === 0) {
    return {
      sections: [{ id: "sample", label: "Sample answers", fieldIds: ["applicant_name", "app_no"] }],
      fields: {
        applicant_name: {
          id: "applicant_name",
          apiName: "applicant_name",
          type: "text",
          label: "Applicant name",
          required: false,
          sectionId: "sample",
        },
        app_no: {
          id: "app_no",
          apiName: "app_no",
          type: "text",
          label: "Application number",
          required: false,
          sectionId: "sample",
        },
      },
    };
  }

  const limited = formFields.slice(0, 6);
  return {
    sections: [
      {
        id: "sample",
        label: `Sample answers for ${serviceName}`,
        fieldIds: limited.map((f) => f.id),
      },
    ],
    fields: Object.fromEntries(limited.map((f) => [f.id, { ...f, sectionId: "sample", required: false }])),
  };
}

export function localeBodyComplete(cell: NotificationCellBinding, locale: LocaleKey): boolean {
  return Boolean(cell.body[locale]?.trim());
}

export function summarizeDesign(design: NotificationsDesignState, pattern: string): string {
  const c = matrixCompleteness(design.matrix, pattern);
  if (c.enabledCount === 0) {
    return "No messages enabled — applicants will not be notified unless you turn channels on.";
  }
  return `${c.enabledCount} message${c.enabledCount === 1 ? "" : "s"} on · ${c.meterLabel}`;
}
