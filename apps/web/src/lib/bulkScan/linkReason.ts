/**
 * Human copy for link-step reasons. The vocabulary is the shared one in packages/scan-link (LINK_REASON_CODES); a link row may
 * also carry free text typed by a reviewer (reject / unlink reason), which is shown as written. A code-shaped value that this UI
 * does not know gets generic copy, never the raw code.
 */
import { formatMoney } from "@/lib/formatters";
import { LINK_REASON_CODES } from "./status";

export interface LinkDetail {
  expectedMinor?: string;
  scannedMinor?: string;
}

/** Digit strings only (paise), bigint-safe: anything else in `detail` is dropped. */
export function parseLinkDetail(v: unknown): LinkDetail | null {
  if (v === null || typeof v !== "object" || Array.isArray(v)) return null;
  const r = v as Record<string, unknown>;
  const digits = (x: unknown): string | undefined => (typeof x === "string" && /^\d{1,18}$/.test(x) ? x : typeof x === "number" && Number.isSafeInteger(x) && x >= 0 ? String(x) : undefined);
  const expectedMinor = digits(r.expectedMinor);
  const scannedMinor = digits(r.scannedMinor);
  return expectedMinor !== undefined || scannedMinor !== undefined
    ? { ...(expectedMinor !== undefined ? { expectedMinor } : {}), ...(scannedMinor !== undefined ? { scannedMinor } : {}) }
    : null;
}

const CODE_SHAPE = /^[A-Z][A-Z0-9_]{2,}$/;

export type LinkReasonText = { kind: "code"; key: string } | { kind: "text"; text: string };

export function describeLinkReason(reason: string | null | undefined): LinkReasonText | null {
  if (!reason) return null;
  const known = (c: string): boolean => (LINK_REASON_CODES as readonly string[]).includes(c);
  if (known(reason)) return { kind: "code", key: `linkReason.${reason}` };
  if (reason.startsWith("LINK_") && known(reason.slice(5))) return { kind: "code", key: `linkReason.${reason.slice(5)}` };
  return CODE_SHAPE.test(reason) ? { kind: "code", key: "linkReason.unknown" } : { kind: "text", text: reason };
}

/** "Expected / scanned" amounts formatted as rupees from the paise digit strings, when both are present. */
export function amountDetailLine(detail: LinkDetail | null | undefined): { expected: string; scanned: string } | null {
  if (!detail || detail.expectedMinor === undefined || detail.scannedMinor === undefined) return null;
  return { expected: formatMoney(detail.expectedMinor), scanned: formatMoney(detail.scannedMinor) };
}
