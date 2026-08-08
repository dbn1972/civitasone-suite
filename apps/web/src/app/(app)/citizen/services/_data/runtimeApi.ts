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
}): Promise<string> {
  const res = await fetch("/api/proxy/v1/citizen/intake/drafts", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error((await res.text()) || "Could not save draft.");
  const body = (await res.json()) as { id?: string };
  return body.id ?? "";
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
  if (!(res.ok || res.status === 202)) throw new Error((await res.text()) || "Submit failed.");
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

/** FN-14 — create online payment intent for a submitted application. */
export async function createPaymentIntent(payload: {
  applicationId: string;
  serviceId: string;
  subject?: Record<string, unknown>;
}): Promise<string> {
  const res = await fetch("/api/proxy/v1/citizen/payments/intent", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      applicationId: payload.applicationId,
      serviceId: payload.serviceId,
      subject: payload.subject ?? {},
    }),
  });
  if (!(res.ok || res.status === 202)) throw new Error((await res.text()) || "Payment intent failed.");
  const body = (await res.json()) as { id?: string };
  if (!body.id) throw new Error("Payment intent missing id.");
  return body.id;
}

/**
 * FN-14 — confirm payment. Use mode=sandbox for Test/pilot when no live gateway
 * credentials are configured (emits receipt → GL via finance consumer).
 */
export async function confirmPayment(
  paymentId: string,
  mode: "sandbox" | "gateway" = "sandbox",
  gatewayRef?: string,
): Promise<void> {
  const res = await fetch(`/api/proxy/v1/citizen/payments/${paymentId}/confirm`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ mode, ...(gatewayRef ? { gatewayRef } : {}) }),
  });
  if (!(res.ok || res.status === 202)) throw new Error((await res.text()) || "Payment confirm failed.");
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

/** Exact demand amount (citizen fee screen), not the "from ₹" service-page phrasing. */
export function formatFeeExact(minor: number | null, currency: string): string {
  if (minor == null) return "Calculated on approval";
  const major = minor / 100;
  return `₹${major.toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}${currency !== "INR" ? ` ${currency}` : ""}`;
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

/** Working-day estimate for the submitted screen (calendar approx — office calendars live in SLA engines). */
export function formatExpectedByDate(slaDays: number | null | undefined, from: Date = new Date()): string | null {
  if (slaDays == null || slaDays <= 0) return null;
  const d = new Date(from.getTime());
  let remaining = slaDays;
  while (remaining > 0) {
    d.setDate(d.getDate() + 1);
    const day = d.getDay();
    if (day !== 0 && day !== 6) remaining -= 1;
  }
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

export type RuntimeJourneyStep = "form" | "review" | "fee" | "submitted";

export const JOURNEY_STEPS: { id: RuntimeJourneyStep; label: string }[] = [
  { id: "form", label: "Form" },
  { id: "review", label: "Review" },
  { id: "fee", label: "Fee" },
  { id: "submitted", label: "Done" },
];

export function journeyStepsForService(hasFee: boolean): { id: RuntimeJourneyStep; label: string }[] {
  return hasFee ? JOURNEY_STEPS : JOURNEY_STEPS.filter((s) => s.id !== "fee");
}

export interface TrackingTimelineOptions {
  status: string;
  servicePattern?: string;
  acknowledgedAt?: string | null;
  slaDays?: number | null;
  hasFee?: boolean;
}

function normalizeStatus(status: string): string {
  return status.trim().toLowerCase().replace(/[\s_]+/g, "-");
}

function slaDaysRemaining(acknowledgedAt: string | null | undefined, slaDays: number | null | undefined): number | undefined {
  if (slaDays == null || slaDays <= 0) return undefined;
  if (!acknowledgedAt) return slaDays;
  const start = new Date(acknowledgedAt);
  if (Number.isNaN(start.getTime())) return slaDays;
  const elapsedMs = Date.now() - start.getTime();
  const elapsedDays = Math.floor(elapsedMs / (24 * 60 * 60 * 1000));
  return Math.max(0, slaDays - elapsedDays);
}

/**
 * Map application status → lane index for the citizen StatusTimeline (FN-13).
 * 0 = submitted, 1 = review, 2 = fee (optional), last = issued/resolved.
 */
export function trackingLaneIndex(status: string, hasFee: boolean): number {
  const s = normalizeStatus(status);
  const issued = ["issued", "approved", "completed", "closed", "resolved", "confirmed"];
  const fee = ["payment-due", "fee-pending", "awaiting-payment", "paid", "payment-received"];
  const review = ["under-review", "in-review", "review", "inspection", "assigned", "in-progress"];
  if (issued.includes(s)) return hasFee ? 3 : 2;
  if (hasFee && (fee.includes(s) || s === "payment_due")) return 2;
  if (review.includes(s)) return 1;
  return 0;
}

/**
 * Citizen StatusTimeline steps from application status (FN-13).
 * Pattern-aware labels; fee lane omitted for grievance / no-fee services.
 */
export function buildTrackingTimeline(opts: TrackingTimelineOptions): {
  id: string;
  label: string;
  state: "done" | "current" | "upcoming";
  date?: string;
  slaDaysRemaining?: number;
}[] {
  const status = normalizeStatus(opts.status);
  const pattern = (opts.servicePattern ?? "certificate").toLowerCase();
  const hasFee = opts.hasFee ?? (pattern !== "grievance");
  const issuedLabel =
    pattern === "grievance" ? "Resolved"
      : pattern === "booking" ? "Confirmed"
        : pattern === "collection" ? "Receipt issued"
          : "Certificate issued";

  const laneDefs: { id: string; label: string }[] = [
    { id: "submitted", label: "Submitted" },
    { id: "review", label: pattern === "grievance" ? "Assigned" : "Under review" },
  ];
  if (hasFee) laneDefs.push({ id: "fee", label: "Fee & payment" });
  laneDefs.push({ id: "issued", label: issuedLabel });

  const submittedDate = opts.acknowledgedAt
    ? new Date(opts.acknowledgedAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })
    : undefined;

  if (status === "rejected" || status === "cancelled" || status === "withdrawn") {
    return [
      { id: "submitted", label: "Submitted", state: "done", date: submittedDate },
      { id: "closed", label: status === "withdrawn" ? "Withdrawn" : "Closed", state: "current" },
    ];
  }

  const currentIdx = trackingLaneIndex(status, hasFee);
  const allDone = ["issued", "approved", "completed", "closed", "resolved", "confirmed"].includes(status);
  const sla = slaDaysRemaining(opts.acknowledgedAt, opts.slaDays);

  return laneDefs.map((lane, idx) => {
    let state: "done" | "current" | "upcoming";
    if (allDone) state = "done";
    else if (idx < currentIdx) state = "done";
    else if (idx === currentIdx) state = "current";
    else state = "upcoming";

    // After payment, fee lane is done and issuance is current
    if (status === "paid" || status === "payment-received") {
      if (lane.id === "fee") state = "done";
      if (lane.id === "issued") state = "current";
      if (lane.id === "submitted" || lane.id === "review") state = "done";
    }

    return {
      id: lane.id,
      label: lane.label,
      state,
      date: lane.id === "submitted" ? submittedDate : undefined,
      slaDaysRemaining: state === "current" ? sla : undefined,
    };
  });
}

export interface DemandLine {
  id: string;
  label: string;
  amountLabel: string;
}

/** Citizen fee screen demand lines from published service fee (no payment gateway). */
export function buildDemandLines(service: Pick<PublishedServiceRuntime, "feeFromMinor" | "feeCurrency" | "name">): DemandLine[] {
  return [
    {
      id: "application-fee",
      label: `${service.name} — application fee`,
      amountLabel: formatFeeExact(service.feeFromMinor, service.feeCurrency),
    },
  ];
}
