import type { FormDesignState } from "@/app/_components/ds/designer/formTypes";

/**
 * UAT-P1A-05: the published-service parser, kept free of "use client" so the
 * server loader (citizen/services/_data/loadService.ts) can call it. It used
 * to live in the "use client" runtimeApi.ts; on the server an import from a
 * client module is a client reference, so calling it threw inside fetchJson's
 * mapResponse and every service landing / apply page showed "We couldn't load
 * service details" over a 200 lookup response.
 */
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

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function str(v: unknown): string {
  return typeof v === "string" ? v : v == null ? "" : String(v);
}

function num(v: unknown): number | null {
  return typeof v === "number" ? v : null;
}

/** Same rule as StatusTimeline's formDesignFromService (a client module). */
function formDesignFromForms(forms: unknown[] | undefined): FormDesignState | null {
  if (!Array.isArray(forms) || forms.length === 0) return null;
  const first = forms[0];
  if (typeof first !== "object" || first === null) return null;
  const fd = (first as { formDesign?: FormDesignState }).formDesign;
  if (!fd?.sections || !fd?.fields) return null;
  return fd;
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
    formDesign: formDesignFromForms(forms),
  };
}
