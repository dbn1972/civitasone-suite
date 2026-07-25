import { z } from "zod";

export const idParam = z.object({ id: z.string().uuid() });
export const actionIdParam = z.object({ id: z.string().uuid(), actionId: z.string().uuid() });

export const intakeBody = z.object({
  caseNo:          z.string().min(1).max(64),
  officer:         z.string().min(1).max(256),
  charges:         z.string().min(1).max(8000),
  complaintSource: z.string().max(256).optional(),
  confidential:    z.boolean().default(true),
});
export type IntakeBody = z.infer<typeof intakeBody>;

export const screenBody = z.object({
  decision: z.enum(["admitted", "rejected"]),
  remarks:  z.string().max(2000).optional(),
});
export type ScreenBody = z.infer<typeof screenBody>;

export const assignIoBody = z.object({
  assignedIo: z.string().min(1).max(256),
});
export type AssignIoBody = z.infer<typeof assignIoBody>;

export const evidenceBody = z.object({
  kind:        z.enum(["document", "statement", "physical", "digital"]).default("document"),
  description: z.string().min(1).max(4000),
  reference:   z.string().max(512).optional(),
  collectedBy: z.string().max(256).optional(),
});
export type EvidenceBody = z.infer<typeof evidenceBody>;

export const findingsBody = z.object({
  findings: z.string().min(1).max(16000),
});
export type FindingsBody = z.infer<typeof findingsBody>;

export const proposeActionBody = z.object({
  recommendation:    z.string().min(1).max(8000),
  recommendedAction: z.enum(["major_penalty", "minor_penalty", "warning", "prosecution", "closure"]),
});
export type ProposeActionBody = z.infer<typeof proposeActionBody>;

export const decideActionBody = z.object({
  decision: z.enum(["approved", "rejected"]),
  remarks:  z.string().max(4000).optional(),
});
export type DecideActionBody = z.infer<typeof decideActionBody>;
