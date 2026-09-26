import { z } from "zod";

// BUG-2a (payroll loans numeric overflow): a JSON body value far beyond
// Number.MAX_SAFE_INTEGER (e.g. 99999999999999999999) is silently rounded by
// JSON.parse to the nearest representable double *before* Zod ever sees it.
// That rounded value can still satisfy Number.isInteger() -- doubles at that
// magnitude are spaced further apart than 1, so the nearest representable
// value is itself a whole number -- so `.int()` alone never catches it. The
// request used to return 202 with a fresh id, but BigInt(<rounded value>)
// downstream in the consumer produced a value far outside Postgres bigint's
// range and threw during the insert -- and (see loans/consumer.ts and
// queue-service's bus.ts MemoryQueue fix in this same PR) that throw was
// never logged anywhere, so the command silently vanished. A real-world
// ceiling, far below Number.MAX_SAFE_INTEGER but comfortably above any
// legitimate value, closes this specific gap regardless of what downstream
// logging exists.
const MAX_MONEY_MINOR = 10_000_000_000; // ₹10 crore, in paise -- generous real-world ceiling, not a refined business limit
const MAX_TENURE_MONTHS = 360; // 30 years -- also bounds routes.ts's /schedule amortisation loop against the same class of input

export const createLoanBody = z.object({
  loanNo:         z.string().min(1).max(64),
  employeeId:     z.string().uuid(),
  loanType:       z.string().max(32).default("personal"),
  principalMinor: z.number().int().positive().max(MAX_MONEY_MINOR),
  emiMinor:       z.number().int().positive().max(MAX_MONEY_MINOR),
  tenureMonths:   z.number().int().positive().max(MAX_TENURE_MONTHS),
  interestRatePct: z.number().nonnegative().max(100).default(0),
  currency:       z.string().length(3).default("INR"),
});
export type CreateLoanBody = z.infer<typeof createLoanBody>;

export const idParam = z.object({ id: z.string().uuid() });

export const loanQueryParams = z.object({
  empId: z.string().uuid().optional(),
});
