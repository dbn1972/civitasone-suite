"use client";

export interface StatutoryReference {
  act: string;
  section?: string;
  url?: string;
}

export interface ProfileAttributeBindingDto {
  attributeKey: string;
  applicantType: string;
  required: boolean;
}

export interface ServiceDefinitionDto {
  id: string;
  serviceKey: string;
  serviceId?: string | null;
  name: string;
  servicePattern?: string | null;
  ownerDepartment?: string | null;
  ownerOfficeId?: string | null;
  offeringOfficeIds?: string[] | null;
  slaDays?: number | null;
  channels: string[];
  statutoryReferences?: StatutoryReference[];
  /** FN-21 — engineered backend bindings (fee/assessment/verification/…). */
  engineBindings?: unknown[];
  status: string;
  version: number;
  submittedBy?: string | null;
  publishedBy?: string | null;
  formId?: string | null;
  forms?: unknown[];
  eligibilityRuleSetId?: string | null;
  workflowDefinitionId?: string | null;
  feeScheduleId?: string | null;
  feeModel?: string | null;
  hoaCode?: string | null;
  requiredDocuments?: unknown[];
  /** FN-25 — per-lane SLA + escalation designations. */
  laneBindings?: unknown[];
  issuanceType?: string | null;
  outputs?: unknown[];
  /** FN-23 */
  allowedApplicantTypes?: string[];
  applicantTypeRejectMessage?: string | null;
  profileAttributeBindings?: ProfileAttributeBindingDto[];
  /** FN-18/FN-32 — locales this service publishes content in. */
  locales?: string[];
  /** FN-22 — per-office fee/SLA/document variants. */
  officeOverrides?: unknown[];
  /**
   * FN-30 — outbound webhook subscriptions. The shared secret is NEVER returned
   * by the API; each entry carries `secretConfigured` instead, so the UI can
   * show whether one is set without ever holding its value.
   */
  webhookSubscriptions?: { id: string; url: string; events: string[]; active: boolean; secretConfigured?: boolean }[];
  /** FN-27 — appeal path. null means never configured. */
  appealLinkage?: { appealable: boolean; filingWindowDays?: number; appellateDesignationId?: string } | null;
  /** FN-28 — RTI catalogue publication. */
  rtiLinkage?: { published: boolean; pioDesignationId?: string; pioDesignationLabel?: string } | null;
  /** FN-15 — renewal window and validity. */
  renewalPolicy?: { renewable: boolean; renewalWindowDays: number; validityMode: string; validityYears?: number } | null;
}

export interface CreateDefinitionPayload {
  serviceKey: string;
  name: string;
  servicePattern: string;
  ownerDepartment?: string;
  channels?: string[];
}

export interface UpdateDefinitionPayload {
  name?: string;
  serviceKey?: string;
  ownerDepartment?: string;
  servicePattern?: string;
  slaDays?: number;
  channels?: string[];
  statutoryReferences?: StatutoryReference[];
  engineBindings?: unknown[];
  forms?: unknown[];
  formId?: string;
  eligibilityRuleSetId?: string;
  workflowDefinitionId?: string;
  feeScheduleId?: string;
  feeModel?: string;
  hoaCode?: string;
  requiredDocuments?: unknown[];
  laneBindings?: unknown[];
  issuanceType?: string;
  outputs?: unknown[];
  allowedApplicantTypes?: string[];
  applicantTypeRejectMessage?: string;
  profileAttributeBindings?: ProfileAttributeBindingDto[];
}

async function parseAccepted(res: Response): Promise<{ id: string }> {
  if (!(res.ok || res.status === 202)) {
    const text = await res.text().catch(() => "");
    let msg = `Request failed (${res.status}).`;
    try {
      const j = JSON.parse(text);
      msg = j?.message ?? j?.error ?? msg;
    } catch {
      if (text) msg = text;
    }
    throw new Error(msg);
  }
  return res.json() as Promise<{ id: string }>;
}

export function slugifyServiceKey(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  const suffix = crypto.randomUUID().slice(0, 8);
  return `${base || "service"}-${suffix}`;
}

export async function createServiceDefinition(body: CreateDefinitionPayload): Promise<string> {
  const res = await fetch("/api/proxy/v1/citizen/catalogue/services", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      channels: ["portal"],
      requiredDocuments: [],
      ...body,
    }),
  });
  const accepted = await parseAccepted(res);
  return accepted.id;
}

export async function updateServiceDefinition(id: string, body: UpdateDefinitionPayload): Promise<void> {
  const res = await fetch(`/api/proxy/v1/citizen/catalogue/services/${id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  await parseAccepted(res);
}

export async function fetchServiceDefinition(id: string): Promise<ServiceDefinitionDto> {
  const res = await fetch(`/api/proxy/v1/citizen/catalogue/services/${id}`, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`Could not load service definition (${res.status}).`);
  }
  return res.json() as Promise<ServiceDefinitionDto>;
}

/* ── Phase 3 derived views (FN-32, FN-16, FN-31) ──────────────────────────
 * Computed server-side from the definition's own blocks, never stored, so what
 * the designer sees always describes the form as it stands right now.
 */

export interface A11yIssueDto {
  code: string;
  severity: "error" | "warning";
  wcag: string;
  fieldId?: string;
  sectionId?: string;
  message: string;
}

export interface A11yPreviewDto {
  formAuthored: boolean;
  passed: boolean;
  issues: A11yIssueDto[];
  errorCount: number;
  warningCount: number;
  reason?: string;
}

export interface KpiTileDto {
  key: string;
  title: string;
  unit: "count" | "days" | "percent";
  description: string;
  higherIsBetter: boolean;
  target?: number;
}

export interface ReportTemplateDto {
  key: string;
  title: string;
  purpose: string;
  columns: string[];
  filters: string[];
  audience: string[];
}

export interface ServiceAnalyticsDto {
  pattern: string | null;
  reports: ReportTemplateDto[];
  tiles: KpiTileDto[];
  reason?: string;
}

/** FN-32 — WCAG/GIGW preview of the generated form. */
export async function fetchA11yPreview(id: string): Promise<A11yPreviewDto> {
  const res = await fetch(`/api/proxy/v1/citizen/catalogue/services/${id}/a11y-preview`, { cache: "no-store" });
  if (!res.ok) throw new Error(`Could not run the accessibility preview (${res.status}).`);
  const body = (await res.json()) as { data: A11yPreviewDto };
  return body.data;
}

/** FN-16 + FN-31 — reports and KPI tiles this service will get on publish. */
export async function fetchServiceAnalytics(id: string): Promise<ServiceAnalyticsDto> {
  const res = await fetch(`/api/proxy/v1/citizen/catalogue/services/${id}/analytics`, { cache: "no-store" });
  if (!res.ok) throw new Error(`Could not load reporting configuration (${res.status}).`);
  const body = (await res.json()) as { data: ServiceAnalyticsDto };
  return body.data;
}

export async function waitForServiceDefinition(id: string, attempts = 40, delayMs = 250): Promise<ServiceDefinitionDto> {
  for (let i = 0; i < attempts; i += 1) {
    try {
      const def = await fetchServiceDefinition(id);
      if (def?.id) return def;
    } catch {
      // consumer may still be applying
    }
    await new Promise((r) => setTimeout(r, delayMs));
  }
  throw new Error("Draft was accepted but is not readable yet. Retry from the library.");
}
