"use client";

import type {
  DocumentsDesignState,
  RequiredDocumentUi,
} from "@/app/_components/ds/designer/documentTypes";
import { emptyDocumentsDesign, slugifyDocType } from "@/app/_components/ds/designer/documentTypes";

interface ApiRequiredDoc {
  docType: string;
  label?: string;
  labels?: { en?: string; hi?: string };
  mandatory: boolean;
  formats?: string[];
  maxSizeMb?: number;
  verifiedAtLane?: string;
}

export function documentsUiToApi(docs: RequiredDocumentUi[]): ApiRequiredDoc[] {
  return docs.map((d) => ({
    docType: d.docType || slugifyDocType(d.labels.en || d.labels.hi || "document"),
    label: d.labels.en || undefined,
    labels: d.labels,
    mandatory: d.mandatory,
    formats: d.formats,
    maxSizeMb: d.maxSizeMb,
    verifiedAtLane: d.verifiedAtLane || undefined,
  }));
}

export function documentsApiToUi(docs: ApiRequiredDoc[]): RequiredDocumentUi[] {
  return docs.map((d) => ({
    id: crypto.randomUUID(),
    docType: d.docType,
    labels: {
      en: d.labels?.en ?? d.label ?? d.docType.replace(/_/g, " "),
      hi: d.labels?.hi ?? "",
    },
    formats: (d.formats as RequiredDocumentUi["formats"]) ?? ["pdf"],
    maxSizeMb: d.maxSizeMb ?? 5,
    mandatory: d.mandatory ?? true,
    verifiedAtLane: d.verifiedAtLane ?? "",
  }));
}

export function emptyDocumentsDesignState(): DocumentsDesignState {
  return emptyDocumentsDesign();
}

export async function loadDocumentsDesign(
  requiredDocuments: unknown[] | undefined | null,
): Promise<DocumentsDesignState> {
  if (!requiredDocuments?.length) return emptyDocumentsDesignState();
  return { documents: documentsApiToUi(requiredDocuments as ApiRequiredDoc[]) };
}

export async function persistDocumentsDesign(
  design: DocumentsDesignState,
): Promise<DocumentsDesignState> {
  return design;
}

export function documentsWithWarnings(
  docs: RequiredDocumentUi[],
  laneKeys: string[],
): { doc: RequiredDocumentUi; warning: string | null }[] {
  return docs.map((doc) => {
    if (doc.mandatory && doc.verifiedAtLane && !laneKeys.includes(doc.verifiedAtLane)) {
      return { doc, warning: "Selected lane is not in the approval chain." };
    }
    if (doc.mandatory && !doc.verifiedAtLane) {
      return { doc, warning: "Mandatory document has no verifying lane — officers may not see a checklist." };
    }
    return { doc, warning: null };
  });
}
