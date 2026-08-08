export type DocumentFormat = "pdf" | "jpg" | "png";

export interface LocaleLabels {
  en: string;
  hi: string;
}

export interface RequiredDocumentUi {
  id: string;
  docType: string;
  labels: LocaleLabels;
  formats: DocumentFormat[];
  maxSizeMb: number;
  mandatory: boolean;
  verifiedAtLane: string;
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
  };
}
