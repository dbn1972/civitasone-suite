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
  currentAchievement: z.number(),
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
  completionDate: z.string().datetime().optional(),
  certificateFileKey: z.string().max(512).optional(),
});
