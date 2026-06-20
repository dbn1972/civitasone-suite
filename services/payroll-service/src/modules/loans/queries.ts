import { cache } from "../../shared/infra.js";
import * as repo from "./repo.js";
import type { LoanRow } from "./schema.js";

export async function getLoansByEmployee(tenantId: string, employeeId: string): Promise<LoanRow[]> {
  return cache.getOrLoad<LoanRow[]>(
    cache.makeKey(tenantId, "loans_emp", employeeId),
    () => repo.findLoansByEmployee(tenantId, employeeId)
  ) as Promise<LoanRow[]>;
}
