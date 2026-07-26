/**
 * UI metadata for the Integrations admin screen. Mirrors the admin-service
 * provider registry (services/admin-service/src/modules/integration-settings/
 * providers.ts): field names, which fields are secret, and category grouping.
 */

export type FieldDef = {
  key: string;
  label: string;
  secret?: boolean;
  type?: "text" | "number";
  placeholder?: string;
  required?: boolean;
  help?: string;
};

export type ProviderMeta = {
  id: string;
  label: string;
  category: CategoryId;
  icon: string;
  fields: FieldDef[];
};

export type CategoryId = "ai" | "messaging" | "email_push" | "payments" | "files_ocr";

export const CATEGORIES: { id: CategoryId; label: string }[] = [
  { id: "ai", label: "AI" },
  { id: "messaging", label: "Messaging" },
  { id: "email_push", label: "Email & Push" },
  { id: "payments", label: "Payments" },
  { id: "files_ocr", label: "Files & OCR" },
];

export const ENV_SCOPES = ["dev", "staging", "prod"] as const;
export type EnvScope = (typeof ENV_SCOPES)[number];

export const PROVIDER_META: ProviderMeta[] = [
  {
    id: "ai_anthropic",
    label: "Anthropic (Claude)",
    category: "ai",
    icon: "🤖",
    fields: [
      { key: "apiKey", label: "API Key", secret: true, required: true, placeholder: "sk-ant-…" },
      { key: "model", label: "Model", placeholder: "claude-3-5-sonnet-latest" },
      { key: "baseUrl", label: "Base URL", placeholder: "https://api.anthropic.com" },
    ],
  },
  {
    id: "sms_twilio",
    label: "Twilio SMS",
    category: "messaging",
    icon: "💬",
    fields: [
      { key: "accountSid", label: "Account SID", required: true, placeholder: "AC…" },
      { key: "authToken", label: "Auth Token", secret: true, required: true },
      { key: "fromNumber", label: "From Number", required: true, placeholder: "+1555…" },
    ],
  },
  {
    id: "whatsapp_meta",
    label: "WhatsApp (Meta)",
    category: "messaging",
    icon: "🟢",
    fields: [
      { key: "phoneNumberId", label: "Phone Number ID", required: true },
      { key: "accessToken", label: "Access Token", secret: true, required: true },
      { key: "graphVersion", label: "Graph API Version", placeholder: "v19.0" },
    ],
  },
  {
    id: "email_smtp",
    label: "SMTP Email",
    category: "email_push",
    icon: "✉️",
    fields: [
      { key: "host", label: "Host", required: true, placeholder: "smtp.example.com" },
      { key: "port", label: "Port", type: "number", placeholder: "587" },
      { key: "user", label: "Username", required: true },
      { key: "password", label: "Password", secret: true, required: true },
      { key: "from", label: "From Address", required: true, placeholder: "noreply@dept.gov.in" },
    ],
  },
  {
    id: "push_fcm",
    label: "Firebase Cloud Messaging",
    category: "email_push",
    icon: "🔔",
    fields: [
      { key: "projectId", label: "Project ID", required: true },
      { key: "serverKey", label: "Server Key", secret: true, help: "Legacy server key (or use a service account JSON)" },
      { key: "serviceAccount", label: "Service Account JSON", secret: true },
    ],
  },
  {
    id: "payment_pfms",
    label: "PFMS (Govt Payments)",
    category: "payments",
    icon: "🏦",
    fields: [
      { key: "agencyCode", label: "Agency Code", required: true },
      { key: "endpoint", label: "Endpoint URL", required: true, placeholder: "https://pfms.nic.in/…" },
      { key: "cert", label: "Certificate", secret: true, required: true },
    ],
  },
  {
    id: "payment_upi",
    label: "UPI Autopay",
    category: "payments",
    icon: "📲",
    fields: [
      { key: "vpa", label: "VPA", required: true, placeholder: "dept@upi" },
      { key: "key", label: "Key", secret: true, required: true },
      { key: "endpoint", label: "Endpoint URL", placeholder: "https://…" },
    ],
  },
  {
    id: "sftp",
    label: "SFTP",
    category: "files_ocr",
    icon: "📁",
    fields: [
      { key: "host", label: "Host", required: true },
      { key: "port", label: "Port", type: "number", placeholder: "22" },
      { key: "username", label: "Username", required: true },
      { key: "privateKey", label: "Private Key", secret: true, required: true },
    ],
  },
  {
    id: "ocr",
    label: "OCR Service",
    category: "files_ocr",
    icon: "🔎",
    fields: [
      { key: "provider", label: "Provider", required: true, placeholder: "google_vision" },
      { key: "apiKey", label: "API Key", secret: true, required: true },
      { key: "endpoint", label: "Endpoint URL", required: true, placeholder: "https://…" },
    ],
  },
];

export function metaFor(provider: string): ProviderMeta | undefined {
  return PROVIDER_META.find((p) => p.id === provider);
}

/** A live integration row as returned by GET /v1/admin/integrations. */
export type IntegrationRow = {
  provider: string;
  envScope: EnvScope;
  category: CategoryId;
  label: string;
  secretFields: string[];
  enabled: boolean;
  endpointUrl: string;
  config: Record<string, unknown>;
  hasSecret: boolean;
  secretMasked: string | null;
  status: "unconfigured" | "connected" | "failed";
  lastTestedAt: string | null;
  lastError: string | null;
  version: number;
  updatedAt: string | null;
};

export type ChangeRow = {
  id: string;
  status: string;
  note: string | null;
  proposedBy: string;
  approvedBy: string | null;
  secretChanged: boolean;
  createdAt: string | null;
  rejectedReason: string | null;
};
