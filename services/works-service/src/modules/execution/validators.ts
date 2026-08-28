import { z } from "zod";

export const addScopeSchema = z.object({
  workId: z.string().uuid(),
  scopeId: z.string().uuid(),
  targetValue: z.number().optional(),
  description: z.string().max(2048).optional(),
});

export const recordProgressSchema = z.object({
  workScopeId: z.string().uuid(),
  month: z.number().int().min(1).max(12),
  year: z.number().int().min(2000).max(2100),
  // This is a DELTA added to the running cumulative achievement, not an
  // absolute value (see execution/consumer.ts). A negative delta is only
  // accepted when correctionReason is supplied — see canApplyProgressDelta.
  currentAchievement: z.number(),
  correctionReason: z.string().min(1).max(2048).optional(),
});

export const uploadPhotoSchema = z.object({
  workId: z.string().uuid(),
  fileKey: z.string().min(1).max(512),
  description: z.string().max(2048).optional(),
  latitude: z.number().optional(),
  longitude: z.number().optional(),
  source: z.enum(["mobile", "web"]).optional(),
});

export const createIssueSchema = z.object({
  workId: z.string().uuid(),
  issueTypeId: z.string().uuid().optional(),
  description: z.string().min(1).max(2048),
  attachmentKey: z.string().max(512).optional(),
});

export const closeIssueSchema = z.object({
  id: z.string().uuid(),
});

export const closeWorkSchema = z.object({
  workId: z.string().uuid(),
  closureType: z.enum(["closed", "dropped", "completion"]),
  remarks: z.string().max(2048).optional(),
});

export const physicalCompleteSchema = z.object({
  workId: z.string().uuid(),
  // Bug fix (works-deep-verify, HIGH/L2): was z.string().datetime(), which
  // requires a full ISO-8601 timestamp (e.g. "2026-01-10T00:00:00Z"). The
  // only caller — apps/web/.../works/execution/[workId]/ExecutionActions.tsx
  // — uses a plain <input type="date">, which produces bare "YYYY-MM-DD"
  // values; every real submission with a date filled in was rejected with
  // 400 (live-confirmed). aaDate/tsDate (approval/validators.ts) already
  // establish the working convention for this exact situation elsewhere in
  // this service: a plain, unconstrained z.string() date, paired with the
  // same <input type="date"> pattern. Matched that here instead of forcing
  // the frontend to fabricate a time-of-day for a field the UI only ever
  // collects as a calendar date.
  completionDate: z.string().optional(),
  certificateFileKey: z.string().max(512).optional(),
});
