import { z } from "zod";

export const createLoanBody = z.object({
  loanNo:         z.string().min(1).max(64),
  employeeId:     z.string().uuid(),
  loanType:       z.string().max(32).default("personal"),
  principalMinor: z.number().int().positive(),
  emiMinor:       z.number().int().positive(),
  tenureMonths:   z.number().int().positive(),
  interestRatePct: z.number().nonnegative().default(0),
  currency:       z.string().length(3).default("INR"),
});
export type CreateLoanBody = z.infer<typeof createLoanBody>;

export const idParam = z.object({ id: z.string().uuid() });

export const loanQueryParams = z.object({
  empId: z.string().uuid().optional(),
});
