/**
 * GAP-ADMIN-ONBOARDING-05 / GAP-ADMIN-OPERATORS-06: browser-side helpers for the
 * audited export and the audited PII reveal on the platform-operator screens.
 *
 * Both are FAIL-CLOSED: the file is only built (export) or the clear value only
 * shown (reveal) after the server accepted the audit record. A failed or
 * unreachable audit call surfaces a plain-language message and nothing leaves
 * the screen. Messages never carry a status code or the server's own text.
 */
import { toHumanError } from "@/lib/messages";

export type PlatformExportResource = "onboarding" | "operators";
export type ExportVerdict = { ok: true } | { ok: false; message: string };

export const EXPORT_NOT_RECORDED = "Couldn't record this export in the audit trail, so no file was created. Try again.";

export function platformExportGuard(resource: PlatformExportResource) {
  return async (info: { rowCount: number; filter: string }): Promise<ExportVerdict> => {
    try {
      const res = await fetch("/api/proxy/v1/admin/platform-exports/audit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ resource, rowCount: info.rowCount, filtered: info.filter.trim().length > 0 }),
      });
      return res.ok ? { ok: true } : { ok: false, message: EXPORT_NOT_RECORDED };
    } catch {
      return { ok: false, message: EXPORT_NOT_RECORDED };
    }
  };
}

export type RevealResult =
  | { ok: true; contactName: string; contactEmail: string }
  | { ok: false; message: string };

function revealFailure(): string {
  const human = toHumanError("load", { area: "contact details" });
  return `${human.what} ${human.next}`;
}

/** Reveal an onboarding request's clear contact; the server writes the audit record (actor + reason) before answering. */
export async function revealOnboardingContact(requestId: string, reason: string): Promise<RevealResult> {
  try {
    const res = await fetch(`/api/proxy/v1/admin/onboarding/${encodeURIComponent(requestId)}/reveal`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reason }),
    });
    if (!res.ok) return { ok: false, message: revealFailure() };
    const body = (await res.json()) as { data?: { contactName?: unknown; contactEmail?: unknown } };
    const d = body.data;
    if (!d || typeof d.contactName !== "string" || typeof d.contactEmail !== "string") return { ok: false, message: revealFailure() };
    return { ok: true, contactName: d.contactName, contactEmail: d.contactEmail };
  } catch {
    return { ok: false, message: revealFailure() };
  }
}
