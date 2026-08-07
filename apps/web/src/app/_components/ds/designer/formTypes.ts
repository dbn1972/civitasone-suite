/** Shared form-builder field model (B2 / FN-02). */

export type DesignerFieldType =
  | "text"
  | "number"
  | "date"
  | "boolean"
  | "picklist_single"
  | "picklist_multi"
  | "file"
  | "address"
  | "ward"
  | "profile_name"
  | "profile_mobile"
  | "profile_email";

export type ValidationPresetId = "pan" | "aadhaar_last4" | "mobile" | "email" | "pin";

export interface ValidationPreset {
  preset?: ValidationPresetId;
  regex?: string;
}

export type ConditionOperator = "eq" | "neq" | "empty" | "not_empty";

export interface VisibilityCondition {
  sourceFieldId: string;
  operator: ConditionOperator;
  value?: string;
}

export interface FormFieldDefinition {
  id: string;
  apiName: string;
  type: DesignerFieldType;
  label: string;
  helpText?: string;
  required: boolean;
  sectionId: string;
  choices?: string[];
  numberMin?: number;
  numberMax?: number;
  fileTypes?: string[];
  fileMaxMb?: number;
  validation?: ValidationPreset;
  visibility?: VisibilityCondition[];
  metadataFieldId?: string;
}

export interface FormSectionDefinition {
  id: string;
  label: string;
  collapsed?: boolean;
  fieldIds: string[];
}

export interface FormDesignState {
  sections: FormSectionDefinition[];
  fields: Record<string, FormFieldDefinition>;
  entityId?: string;
  layoutId?: string;
  formVersionId?: string;
}

export const VALIDATION_PRESETS: { id: ValidationPresetId; label: string }[] = [
  { id: "pan", label: "PAN" },
  { id: "aadhaar_last4", label: "Aadhaar (last 4)" },
  { id: "mobile", label: "Mobile number" },
  { id: "email", label: "Email" },
  { id: "pin", label: "PIN code" },
];

export const FIELD_PALETTE_GROUPS: {
  label: string;
  items: { type: DesignerFieldType; label: string; icon: string }[];
}[] = [
  {
    label: "Basic",
    items: [
      { type: "text", label: "Text", icon: "Aa" },
      { type: "number", label: "Number", icon: "#" },
      { type: "date", label: "Date", icon: "📅" },
      { type: "boolean", label: "Yes / No", icon: "☑" },
    ],
  },
  {
    label: "Choice",
    items: [
      { type: "picklist_single", label: "Single choice", icon: "◉" },
      { type: "picklist_multi", label: "Multiple choice", icon: "☰" },
    ],
  },
  {
    label: "Files",
    items: [{ type: "file", label: "File upload", icon: "📎" }],
  },
  {
    label: "Location",
    items: [
      { type: "address", label: "Address", icon: "📍" },
      { type: "ward", label: "Ward / Zone", icon: "🗺" },
    ],
  },
  {
    label: "Applicant profile",
    items: [
      { type: "profile_name", label: "Applicant name", icon: "👤" },
      { type: "profile_mobile", label: "Mobile", icon: "📱" },
      { type: "profile_email", label: "Email", icon: "✉" },
    ],
  },
];

export function defaultLabelForType(type: DesignerFieldType): string {
  const found = FIELD_PALETTE_GROUPS.flatMap((g) => g.items).find((i) => i.type === type);
  return found?.label ?? "Field";
}

export function slugifyApiName(label: string, suffix: string): string {
  const base = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
  return `${base || "field"}_${suffix.slice(0, 8)}`;
}

export function visibilityToShowWhen(
  field: FormFieldDefinition,
  allFields: Record<string, FormFieldDefinition>,
): string | undefined {
  if (!field.visibility?.length) return undefined;
  const parts = field.visibility.map((cond) => {
    const source = allFields[cond.sourceFieldId];
    const name = source?.apiName ?? cond.sourceFieldId;
    switch (cond.operator) {
      case "empty":
        return `${name} == ""`;
      case "not_empty":
        return `${name} != ""`;
      case "neq":
        return `${name} != "${cond.value ?? ""}"`;
      default:
        return `${name} == "${cond.value ?? ""}"`;
    }
  });
  return parts.join(" && ");
}
