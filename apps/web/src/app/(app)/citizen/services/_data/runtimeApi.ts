"use client";

import type { FormDesignState } from "@/app/_components/ds/designer/formTypes";
import { formDesignFromService } from "@/app/_components/ds/designer/StatusTimeline";

export interface PublishedServiceRuntime {
  id: string;
  serviceKey: string;
  name: string;
  servicePattern: string;
  description: string;
  slaDays: number | null;
  channels: string[];
  allowedApplicantTypes: string[];
  applicantTypeRejectMessage: string | null;
  requiredDocuments: { docType: string; label: string; mandatory: boolean }[];
  feeFromMinor: number | null;
  feeCurrency: string;
  formDesign: FormDesignState | null;
}

export interface ApplicationDraft {
  id: string;
  serviceId: string;
  serviceKey: string | null;
  status: string;
  channel: string;
  assistedBy: string | null;
  formData: Record<string, unknown>;
  updatedAt: string;
}

export interface TrackingAck {
  trackingNo: string;
  applicationId: string;
  status: string;
  channel: string;
  acknowledgedAt: string | null;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function str(v: unknown): string {
  return typeof v === "string" ? v : v == null ? "" : String(v);
}

function num(v: unknown): number | null {
  return typeof v === "number" ? v : null;
}

export function parsePublishedService(raw: unknown): PublishedServiceRuntime | null {
  if (!isRecord(raw)) return null;
  const forms = Array.isArray(raw.forms) ? raw.forms : [];
  const firstForm = forms[0];
  const runtimeMeta = isRecord(firstForm) && isRecord(firstForm.runtimeMeta) ? firstForm.runtimeMeta : null;
  const feeFromMinor =
    num(runtimeMeta?.feeFromMinor) ??
    (typeof raw.feeFromMinor === "number" ? raw.feeFromMinor : null);

  return {
    id: str(raw.id),
    serviceKey: str(raw.serviceKey),
    name: str(raw.name),
    servicePattern: str(raw.servicePattern) || "certificate",
    description: str(runtimeMeta?.description ?? raw.description) || "Government service application",
    slaDays: num(raw.slaDays),
    channels: Array.isArray(raw.channels) ? raw.channels.map(str) : ["portal"],
    allowedApplicantTypes: Array.isArray(raw.allowedApplicantTypes) && raw.allowedApplicantTypes.length > 0
      ? raw.allowedApplicantTypes.map(str)
      : ["citizen"],
    applicantTypeRejectMessage: raw.applicantTypeRejectMessage ? str(raw.applicantTypeRejectMessage) : null,
    requiredDocuments: Array.isArray(raw.requiredDocuments)
      ? raw.requiredDocuments.filter(isRecord).map((d) => ({
          docType: str(d.docType),
          label: str(d.label),
          mandatory: d.mandatory !== false,
        }))
      : [],
    feeFromMinor,
    feeCurrency: str(runtimeMeta?.feeCurrency ?? "INR"),
    formDesign: formDesignFromService(forms),
  };
}

export async function fetchPublishedByKey(serviceKey: string): Promise<PublishedServiceRuntime> {
  const res = await fetch(
    `/api/proxy/v1/citizen/catalogue/published/lookup?serviceKey=${encodeURIComponent(serviceKey)}`,
    { cache: "no-store" },
  );
  if (!res.ok) throw new Error("Service not found or not yet published.");
  return parsePublishedService(await res.json())!;
}

export async function listDraftsForService(serviceId: string): Promise<ApplicationDraft[]> {
  const res = await fetch("/api/proxy/v1/citizen/intake/drafts", { cache: "no-store" });
  if (!res.ok) return [];
  const payload = (await res.json()) as { data?: unknown[] };
  return (payload.data ?? [])
    .filter(isRecord)
    .filter((d) => str(d.serviceId) === serviceId && str(d.status) === "draft")
    .map((d) => ({
      id: str(d.id),
      serviceId: str(d.serviceId),
      serviceKey: d.serviceKey ? str(d.serviceKey) : null,
      status: str(d.status),
      channel: str(d.channel) || "portal",
      assistedBy: d.assistedBy ? str(d.assistedBy) : null,
      formData: isRecord(d.formData) ? d.formData : {},
      updatedAt: str(d.updatedAt),
    }));
}

export async function saveDraft(payload: {
  serviceId: string;
  serviceKey: string;
  channel: string;
  formData: Record<string, unknown>;
  operatorId?: string;
  applicantType?: string;
}): Promise<string> {
  const res = await fetch("/api/proxy/v1/citizen/intake/drafts", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ applicantType: "citizen", ...payload }),
  });
  if (!res.ok) throw new Error(await readErrorMessage(res, "Could not save draft."));
  const body = (await res.json()) as { id?: string };
  return body.id ?? "";
}

async function readErrorMessage(res: Response, fallback: string): Promise<string> {
  const text = await res.text();
  try {
    const parsed = JSON.parse(text) as { message?: string };
    if (typeof parsed.message === "string" && parsed.message.length > 0) return parsed.message;
  } catch {
    /* use raw text */
  }
  return text || fallback;
}

export async function updateDraft(draftId: string, formData: Record<string, unknown>): Promise<void> {
  const res = await fetch(`/api/proxy/v1/citizen/intake/drafts/${draftId}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ formData }),
  });
  if (!(res.ok || res.status === 202)) throw new Error((await res.text()) || "Autosave failed.");
}

export async function submitDraft(draftId: string): Promise<TrackingAck> {
  const res = await fetch(`/api/proxy/v1/citizen/intake/drafts/${draftId}/submit`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({}),
  });
  if (!(res.ok || res.status === 202)) throw new Error(await readErrorMessage(res, "Submit failed."));
  // Poll tracking after consumer processes
  await new Promise((r) => setTimeout(r, 200));
  const draftsRes = await fetch(`/api/proxy/v1/citizen/intake/drafts/${draftId}`, { cache: "no-store" });
  if (draftsRes.ok) {
    const d = (await draftsRes.json()) as Record<string, unknown>;
    const appId = str(d.applicationId);
    if (appId) {
      const apps = await fetch("/api/proxy/v1/citizen/applications", { cache: "no-store" });
      if (apps.ok) {
        const list = (await apps.json()) as unknown[];
        const app = list.find((a) => isRecord(a) && str(a.id) === appId);
        if (isRecord(app) && app.trackingNo) {
          return {
            trackingNo: str(app.trackingNo),
            applicationId: appId,
            status: str(app.status),
            channel: str(app.channel),
            acknowledgedAt: app.acknowledgedAt ? str(app.acknowledgedAt) : null,
          };
        }
      }
    }
  }
  return { trackingNo: "PENDING", applicationId: "", status: "submitted", channel: "portal", acknowledgedAt: null };
}

export async function trackApplication(trackingNo: string): Promise<TrackingAck> {
  const res = await fetch(`/api/proxy/v1/citizen/intake/track/${encodeURIComponent(trackingNo)}`, {
    cache: "no-store",
  });
  if (!res.ok) throw new Error("Tracking number not found.");
  const raw = await res.json();
  if (!isRecord(raw)) throw new Error("Invalid tracking response.");
  return {
    trackingNo: str(raw.trackingNo),
    applicationId: str(raw.applicationId),
    status: str(raw.status),
    channel: str(raw.channel),
    acknowledgedAt: raw.acknowledgedAt ? str(raw.acknowledgedAt) : null,
  };
}

export function formatFee(minor: number | null, currency: string): string {
  if (minor == null) return "Fee on approval";
  const major = minor / 100;
  return `from ₹${major.toLocaleString("en-IN")}${currency !== "INR" ? ` ${currency}` : ""}`;
}

export function validateField(apiName: string, value: string, required: boolean): string | undefined {
  if (required && !value.trim()) return "This field is required.";
  if (apiName.includes("mobile") && value && !/^[6-9]\d{9}$/.test(value.replace(/\D/g, "").slice(-10))) {
    return "Enter a valid 10-digit mobile number.";
  }
  if (apiName.includes("email") && value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
    return "Enter a valid email address.";
  }
  return undefined;
}

/** FN-24 — UI gate mirroring server CHANNEL_NOT_ALLOWED. */
export function isChannelAllowed(channels: readonly string[], channel: string): boolean {
  return channels.includes(channel);
}

export function channelDisabledMessage(channel: string, channels: readonly string[]): string {
  const allowed = channels.length > 0 ? channels.join(", ") : "none";
  return `This service is not available on the ${channel} channel. Allowed channels: ${allowed}.`;
}
