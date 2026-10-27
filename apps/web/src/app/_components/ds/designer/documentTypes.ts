export type DocumentFormat = "pdf" | "jpg" | "png";

/**
 * GAP-DESIGNER-DETAIL-B8-01: a document label set may carry any locale code the
 * tenant publishes in, not just en/hi. `en`/`hi` stay declared so existing
 * readers keep their non-optional `string` type under noUncheckedIndexedAccess,
 * while the index signature allows additional locale codes (dynamic access is
 * `string | undefined` and callers coalesce with `?? ""`).
 */
export type LocaleLabels = { en: string; hi: string } & Record<string, string>;

export interface RequiredDocumentUi {
  id: string;
  docType: string;
  labels: LocaleLabels;
  formats: DocumentFormat[];
  maxSizeMb: number;
  mandatory: boolean;
  verifiedAtLane: string;
  /** D4c #8: id of the DPDP-classified catalogue category; "" / absent = Other (free text). */
  categoryId?: string;
}

export type DocumentSensitivity = "sensitive" | "personal" | "standard";

export type DocumentRetention = { kind: "years"; years: number } | { kind: "after_verification" };

export interface DocumentCategory {
  id: string;
  /** The one docType every document of this category shares. */
  docType: string;
  labels: { en: string; hi: string };
  sensitivity: DocumentSensitivity;
  retention: DocumentRetention;
  /** false until the Data Protection Officer signs the entry off. */
  dpoConfirmed: boolean;
}

/**
 * Owner decision D4c #8 (GAP-DESIGNER-DETAIL-B6-03): the Data Protection Officer
 * supplies the official catalogue of document types with sensitivity and
 * retention. Until then this is a DRAFT STARTER LIST, every entry flagged
 * "DPO to confirm" in the editor. Replace it with the DPO list (or an endpoint)
 * and set dpoConfirmed once signed off.
 */
export const DOCUMENT_CATEGORIES: readonly DocumentCategory[] = [
  { id: "aadhaar_copy", docType: "aadhaar_copy", labels: { en: "Aadhaar copy", hi: "आधार की प्रति" }, sensitivity: "sensitive", retention: { kind: "after_verification" }, dpoConfirmed: false },
  { id: "income_certificate", docType: "income_certificate", labels: { en: "Income certificate", hi: "आय प्रमाणपत्र" }, sensitivity: "personal", retention: { kind: "years", years: 7 }, dpoConfirmed: false },
  { id: "caste_certificate", docType: "caste_certificate", labels: { en: "Caste certificate", hi: "जाति प्रमाणपत्र" }, sensitivity: "sensitive", retention: { kind: "years", years: 7 }, dpoConfirmed: false },
  { id: "residence_certificate", docType: "residence_certificate", labels: { en: "Residence certificate", hi: "निवास प्रमाणपत्र" }, sensitivity: "personal", retention: { kind: "years", years: 7 }, dpoConfirmed: false },
];

export function documentCategoryById(id: string | null | undefined): DocumentCategory | null {
  return DOCUMENT_CATEGORIES.find((c) => c.id === id) ?? null;
}

export interface DocumentsDesignState {
  documents: RequiredDocumentUi[];
}

export const DOCUMENT_FORMAT_OPTIONS: { id: DocumentFormat; label: string }[] = [
  { id: "pdf", label: "PDF" },
  { id: "jpg", label: "JPG" },
  { id: "png", label: "PNG" },
];

export function emptyDocumentsDesign(): DocumentsDesignState {
  return { documents: [] };
}

export function slugifyDocType(label: string): string {
  const base = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 48);
  return base || `doc_${crypto.randomUUID().slice(0, 6)}`;
}

export function newDocumentRow(): RequiredDocumentUi {
  return {
    id: crypto.randomUUID(),
    docType: "",
    labels: { en: "", hi: "" },
    formats: ["pdf"],
    maxSizeMb: 5,
    mandatory: true,
    verifiedAtLane: "",
    categoryId: "",
  };
}
