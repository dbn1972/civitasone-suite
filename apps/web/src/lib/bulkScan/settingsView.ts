/** Read the bits of the tenant settings payload the UI needs (limits, document types, allowed link targets) without trusting its shape. */
import { DEFAULT_LIMITS, type UploadLimits } from "./uploadValidation";
import { LINK_TARGETS, type SettingsPayload } from "./types";

export function limitsFromSettings(s: SettingsPayload | null): UploadLimits {
  const l = s?.settings.limits;
  if (l !== null && typeof l === "object") {
    const r = l as Record<string, unknown>;
    if (typeof r.maxFileBytes === "number" && typeof r.maxFilesPerBatch === "number" && typeof r.maxBatchBytes === "number") {
      return { maxFileBytes: r.maxFileBytes, maxFilesPerBatch: r.maxFilesPerBatch, maxBatchBytes: r.maxBatchBytes };
    }
  }
  return DEFAULT_LIMITS;
}

export function docTypesFromSettings(s: SettingsPayload | null): Array<{ id: string; label: string }> {
  const c = s?.settings.classification;
  const list = c !== null && typeof c === "object" ? (c as Record<string, unknown>).docTypes : null;
  if (!Array.isArray(list)) return [];
  return list.flatMap((d) => {
    const r = d !== null && typeof d === "object" ? (d as Record<string, unknown>) : null;
    return r && typeof r.id === "string" ? [{ id: r.id, label: typeof r.label === "string" ? r.label : r.id }] : [];
  });
}

export function allowedTargetsFromSettings(s: SettingsPayload | null): string[] {
  const a = s?.settings.allowedLinkTargets;
  return Array.isArray(a) ? a.filter((x): x is string => typeof x === "string") : [...LINK_TARGETS];
}
