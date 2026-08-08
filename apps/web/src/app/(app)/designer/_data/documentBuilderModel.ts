import type { RequiredDocumentUi } from "@/app/_components/ds/designer/documentTypes";
import type { LocaleKey } from "@/app/_components/ds/designer/LocaleTabs";
import type { WorkflowLane } from "./workflowConstants";

export type DocumentWarningKind = "missing_lane" | "stale_lane";

export interface DocumentWarning {
  kind: DocumentWarningKind;
  /** Plain-language copy for designers (warning, not a hard block). */
  message: string;
}

export interface DocumentRowAssessment {
  doc: RequiredDocumentUi;
  warning: DocumentWarning | null;
}

export interface LocaleCompleteness {
  en: { filled: number; total: number };
  hi: { filled: number; total: number };
  /** True when every document has both EN and HI labels. */
  complete: boolean;
  /** Short footer meter string, e.g. "EN 2/2 · HI 1/2". */
  meterLabel: string;
}

export interface CitizenUploadPreviewModel {
  label: string;
  secondaryLabel: string | null;
  mandatory: boolean;
  formatsLabel: string;
  maxSizeLabel: string;
  showCameraHint: boolean;
  dropHint: string;
  chooseFileLabel: string;
  cameraLabel: string;
  requiredBadge: string | null;
  emptyName: boolean;
}

/** Lanes that can verify documents (excludes terminal Submitted / Issued). */
export function verificationLanesFromWorkflow(lanes: WorkflowLane[]): WorkflowLane[] {
  return lanes.filter((l) => l.enabled && l.key !== "submitted" && l.key !== "issued");
}

export function laneDisplayName(lanes: WorkflowLane[], laneKey: string): string {
  if (!laneKey) return "";
  const lane = lanes.find((l) => l.key === laneKey);
  if (!lane) return laneKey;
  if (lane.designationLabel) return `${lane.name} (${lane.designationLabel})`;
  return lane.name;
}

export function assessDocumentWarnings(
  docs: RequiredDocumentUi[],
  laneKeys: string[],
): DocumentRowAssessment[] {
  return docs.map((doc) => {
    if (doc.mandatory && doc.verifiedAtLane && !laneKeys.includes(doc.verifiedAtLane)) {
      return {
        doc,
        warning: {
          kind: "stale_lane",
          message:
            "Verified-at lane is no longer in the approval chain — pick another step or clear the link.",
        },
      };
    }
    if (doc.mandatory && !doc.verifiedAtLane) {
      return {
        doc,
        warning: {
          kind: "missing_lane",
          message:
            "Mandatory document has no verifying lane — officers may not see a checklist at this step.",
        },
      };
    }
    return { doc, warning: null };
  });
}

/** Back-compat wrapper used by list renderers that only need message text. */
export function documentsWithWarnings(
  docs: RequiredDocumentUi[],
  laneKeys: string[],
): { doc: RequiredDocumentUi; warning: string | null }[] {
  return assessDocumentWarnings(docs, laneKeys).map(({ doc, warning }) => ({
    doc,
    warning: warning?.message ?? null,
  }));
}

export function summarizeMandatoryLaneWarnings(
  assessments: DocumentRowAssessment[],
): { missingLane: number; staleLane: number; total: number; banner: string | null } {
  let missingLane = 0;
  let staleLane = 0;
  for (const row of assessments) {
    if (row.warning?.kind === "missing_lane") missingLane += 1;
    if (row.warning?.kind === "stale_lane") staleLane += 1;
  }
  const total = missingLane + staleLane;
  if (total === 0) return { missingLane, staleLane, total, banner: null };

  const parts: string[] = [];
  if (missingLane > 0) {
    parts.push(
      `${missingLane} mandatory document${missingLane === 1 ? "" : "s"} without a verifying lane`,
    );
  }
  if (staleLane > 0) {
    parts.push(
      `${staleLane} document${staleLane === 1 ? "" : "s"} linked to a removed lane`,
    );
  }
  return {
    missingLane,
    staleLane,
    total,
    banner: `${parts.join("; ")}. This is a warning — you can still continue, but officers may miss the checklist.`,
  };
}

export function documentsLocaleCompleteness(docs: RequiredDocumentUi[]): LocaleCompleteness {
  const total = docs.length;
  let enFilled = 0;
  let hiFilled = 0;
  for (const doc of docs) {
    if (doc.labels.en.trim()) enFilled += 1;
    if (doc.labels.hi.trim()) hiFilled += 1;
  }
  const complete = total === 0 ? true : enFilled === total && hiFilled === total;
  return {
    en: { filled: enFilled, total },
    hi: { filled: hiFilled, total },
    complete,
    meterLabel: total === 0 ? "No documents yet" : `EN ${enFilled}/${total} · HI ${hiFilled}/${total}`,
  };
}

export function suggestFirstVerificationLane(lanes: WorkflowLane[]): WorkflowLane | null {
  return verificationLanesFromWorkflow(lanes)[0] ?? null;
}

export function buildCitizenUploadPreview(
  doc: RequiredDocumentUi,
  locale: LocaleKey,
): CitizenUploadPreviewModel {
  const primary = doc.labels[locale].trim();
  const other: LocaleKey = locale === "en" ? "hi" : "en";
  const fallback = doc.labels[other].trim();
  const label = primary || fallback || "Untitled document";
  const secondaryLabel = primary && fallback && primary !== fallback ? fallback : null;
  const formatsLabel = doc.formats.map((f) => f.toUpperCase()).join(", ") || "PDF";
  const showCameraHint = doc.formats.some((f) => f === "jpg" || f === "png");

  return {
    label,
    secondaryLabel,
    mandatory: doc.mandatory,
    formatsLabel,
    maxSizeLabel: `Max ${doc.maxSizeMb} MB`,
    showCameraHint,
    dropHint: showCameraHint
      ? "Drag a file here, or use Choose file / Take photo on mobile"
      : "Drag a file here, or choose a file to upload",
    chooseFileLabel: "Choose file",
    cameraLabel: "Take photo",
    requiredBadge: doc.mandatory ? "Required" : null,
    emptyName: !primary && !fallback,
  };
}
