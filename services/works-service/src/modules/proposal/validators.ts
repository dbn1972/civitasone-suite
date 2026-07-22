import { z } from "zod";

export const createProposalSchema = z.object({
  description: z.string().min(1).max(2048),
  category: z.enum(["regular", "deposit", "salary"]),
  workTypeId: z.string().uuid(),
  workSubTypeId: z.string().uuid().optional(),
  estimatedCostMinor: z.string().or(z.number()),
  executingDivisionId: z.string().uuid().optional(),
  executingSubDivisionId: z.string().uuid().optional(),
  executingSectionId: z.string().uuid().optional(),
  district: z.string().max(128).optional(),
  taluka: z.string().max(128).optional(),
  village: z.string().max(128).optional(),
  programId: z.string().uuid().optional(),
  schemeId: z.string().uuid().optional(),
  remarks: z.string().max(2048).optional(),
});

export const splitProposalSchema = z.object({
  parentWorkId: z.string().uuid(),
  description: z.string().min(1).max(2048),
});

export const mapCoaSchema = z.object({
  workId: z.string().uuid(),
  majorHead: z.string().min(1).max(16),
  subMajorHead: z.string().max(16).optional(),
  minorHead: z.string().max(16).optional(),
  subHead: z.string().max(16).optional(),
  detailHead: z.string().max(16).optional(),
  objectHead: z.string().max(16).optional(),
});

export const mapOfficeSchema = z.object({
  workId: z.string().uuid(),
  divisionId: z.string().uuid(),
  subDivisionId: z.string().uuid().optional(),
  sectionId: z.string().uuid().optional(),
  isNodal: z.boolean().optional(),
});

export const finalizeSchema = z.object({
  workId: z.string().uuid(),
});
