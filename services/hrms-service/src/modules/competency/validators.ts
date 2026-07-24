import { z } from "zod";

export const createFrameworkBody = z.object({
  name:        z.string().min(1).max(256),
  description: z.string().max(2000).optional(),
});
export type CreateFrameworkBody = z.infer<typeof createFrameworkBody>;

export const createCompetencyBody = z.object({
  code:           z.string().min(1).max(48),
  name:           z.string().min(1).max(256),
  description:    z.string().max(2000).optional(),
  category:       z.string().max(64).default("general"),
  maxLevel:       z.number().int().min(1).max(10).default(5),
  certifiedLevel: z.number().int().min(1).max(10).default(3),
});
export type CreateCompetencyBody = z.infer<typeof createCompetencyBody>;

export const roleRequirementBody = z.object({
  roleCode:      z.string().min(1).max(64),
  competencyId:  z.string().uuid(),
  requiredLevel: z.number().int().min(1).max(10),
});
export type RoleRequirementBody = z.infer<typeof roleRequirementBody>;

export const setEmployeeCompetencyBody = z.object({
  competencyId: z.string().uuid(),
  currentLevel: z.number().int().min(0).max(10),
  source:       z.enum(["manual", "assessment", "training"]).default("manual"),
  evidenceRef:  z.string().max(256).optional(),
});
export type SetEmployeeCompetencyBody = z.infer<typeof setEmployeeCompetencyBody>;
