"use client";

import { useTranslations } from "next-intl";
import { docTypeLabel, piiTypeLabel } from "@/lib/scannedDocuments";

/** Localised (en/hi) doc-type and PII-type labels for the scanned-documents tables (HR, Finance, eOffice). */
export function useScannedDocumentLabels() {
  const t = useTranslations("scannedDocumentLabels");
  const resolve = (l: { key: string } | { text: string }): string => ("key" in l ? t(l.key) : l.text);
  return {
    docType: (docType: string): string => resolve(docTypeLabel(docType)),
    piiTypes: (types: readonly string[]): string => types.map((x) => resolve(piiTypeLabel(x))).join(", "),
  };
}
