"use client";

import { useCallback } from "react";
import { useTranslations } from "next-intl";
import { formatReference } from "@/lib/errorCatalogue";
import { humanErrorFromFailure, type MessageKind } from "@/lib/messages";
import { specificErrorKey, type FailedResult } from "./api";

/** A user-facing failure: plain-language message plus the optional support reference (shown as a quiet secondary line). */
export interface BsError { message: string; reference: string | null }

/** Message and reference as one string, for surfaces that only take a string (confirm dialogs, per-row notes). */
export function errorText(e: BsError): string {
  return e.reference ? `${e.message} ${formatReference(e.reference)}` : e.message;
}

/**
 * Turns a failed bulk-scan call into user-facing copy on the app standard (apps/web/docs/ERROR-MESSAGES.md): a code the bulk-scan
 * catalogue has specific copy for wins (clearance, maker-checker, stale, ...); everything else resolves through the app-wide
 * catalogue by status (the same resolver `useFormError` uses), so wording and the support reference line match the rest of the app.
 */
export function useBulkScanError(area?: string) {
  const t = useTranslations("bulkScan");
  const areaText = area ?? t("list.area");
  return useCallback((r: FailedResult, kind: MessageKind = "save"): BsError => {
    const key = specificErrorKey(r);
    if (key) return { message: t(key), reference: r.reference };
    const h = humanErrorFromFailure({ status: r.status, code: r.code, kind, area: areaText, hasFieldErrors: false });
    return { message: `${h.what} ${h.next}`, reference: r.reference };
  }, [t, areaText]);
}
