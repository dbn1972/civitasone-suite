/** Batch-creation form: pure validation and request-body building (mirrors createBatchBody in document-service). */
import { parseTags } from "./review";
import { LINK_TARGETS } from "./types";

export interface BatchFormValues {
  name: string;
  targetFolderId: string;
  tags: string;
  defaultDocType: string;
  linkTarget: string;
  linkTargetId: string;
  profileId: string;
}

export const EMPTY_BATCH_FORM: BatchFormValues = { name: "", targetFolderId: "", tags: "", defaultDocType: "", linkTarget: "", linkTargetId: "", profileId: "" };

export type BatchFormErrors = Partial<Record<keyof BatchFormValues, string>>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const isUuid = (v: string | null | undefined): v is string => typeof v === "string" && UUID.test(v);

/** Error values are i18n keys under bulkScan.new.err. */
export function validateBatchForm(v: BatchFormValues, ctx: { docTypeIds: readonly string[]; allowedTargets: readonly string[] }): BatchFormErrors {
  const e: BatchFormErrors = {};
  const name = v.name.trim();
  if (!name) e.name = "nameRequired";
  else if (name.length > 200) e.name = "nameTooLong";
  const tags = [...new Set(v.tags.split(/[,\n]/).map((x) => x.trim()).filter(Boolean))];
  if (tags.length > 20 || tags.some((x) => x.length > 64)) e.tags = "tagsInvalid";
  if (v.defaultDocType && ctx.docTypeIds.length > 0 && !ctx.docTypeIds.includes(v.defaultDocType)) e.defaultDocType = "docTypeUnknown";
  if (v.targetFolderId && !UUID.test(v.targetFolderId)) e.targetFolderId = "folderInvalid";
  if (v.linkTarget && !(LINK_TARGETS as readonly string[]).includes(v.linkTarget)) e.linkTarget = "targetInvalid";
  else if (v.linkTarget && !ctx.allowedTargets.includes(v.linkTarget)) e.linkTarget = "targetNotAllowed";
  if (!v.linkTarget && v.linkTargetId.trim()) e.linkTarget = "targetMissing";
  if (v.linkTargetId.trim().length > 128) e.linkTargetId = "targetIdTooLong";
  if (v.profileId && !UUID.test(v.profileId)) e.profileId = "profileInvalid";
  return e;
}

export interface CreateBatchBody {
  name: string;
  targetFolderId?: string;
  defaultTags: string[];
  defaultDocType?: string;
  linkTarget?: { target: string; targetId?: string };
  profileId?: string;
}

export function buildCreateBatchBody(v: BatchFormValues): CreateBatchBody {
  return {
    name: v.name.trim(),
    ...(v.targetFolderId ? { targetFolderId: v.targetFolderId } : {}),
    defaultTags: parseTags(v.tags),
    ...(v.defaultDocType ? { defaultDocType: v.defaultDocType } : {}),
    ...(v.linkTarget ? { linkTarget: { target: v.linkTarget, ...(v.linkTargetId.trim() ? { targetId: v.linkTargetId.trim() } : {}) } } : {}),
    ...(v.profileId ? { profileId: v.profileId } : {}),
  };
}

/** The create call answers 202 before the batch row exists; wait (bounded) until a GET sees it. */
export function waitForBatchDelays(maxTries = 10): number[] {
  return Array.from({ length: maxTries }, (_, i) => Math.min(2000, 300 + i * 250));
}
