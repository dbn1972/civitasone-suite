import { z } from "zod";

export const submitUcBody = z.object({
  period:        z.string().min(4).max(7),
  installmentNo: z.number().int().positive(),
  releasedMinor: z.number().int().nonnegative(),
  utilisedMinor: z.number().int().nonnegative(),
  ucRef:         z.string().optional(),
});
export type SubmitUcBody = z.infer<typeof submitUcBody>;

export const complianceReportBody = z.object({
  period:      z.string().min(4).max(7),
  kind:        z.enum(["interim", "final", "audit"]).default("interim"),
  observation: z.string().optional(),
});
export type ComplianceReportBody = z.infer<typeof complianceReportBody>;

export const idParam = z.object({ id: z.string().uuid() });
