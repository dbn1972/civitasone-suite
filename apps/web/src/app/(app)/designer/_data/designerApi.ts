"use client";

export interface StatutoryReference {
  act: string;
  section?: string;
  url?: string;
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
  issuanceType?: string | null;
  outputs?: unknown[];
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
  issuanceType?: string;
  outputs?: unknown[];
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
