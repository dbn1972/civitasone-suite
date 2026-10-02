/**
 * Beneficiary bank details for a payroll run's slips, keyed by the slip's
 * employeeId. Salary runs source the HRMS employee master (payroll-input);
 * pensioner runs source payroll.payroll_pensioners (keyed by pensioner id,
 * which is the slip's employeeId). Shared by the bank-file route and the
 * disbursement-ledger consumer so both read the same master the same way.
 */
import { sql } from "drizzle-orm";
import { fetchPayrollInput } from "../../shared/hrms-client.js";

export type Beneficiary = { fullName: string; bankAccountNo: string | null; bankIfsc: string | null };

type Executor = { execute: (q: ReturnType<typeof sql>) => Promise<unknown> };

export async function loadBeneficiaryMaster(
  tenantId: string,
  run: { runType: string; month: string },
  read: <T>(fn: (tx: Executor) => Promise<T>) => Promise<T>,
): Promise<Map<string, Beneficiary>> {
  const master = new Map<string, Beneficiary>();
  if (run.runType === "pensioner") {
    const pens = (await read((tx) => tx.execute(sql`
      SELECT id, full_name, bank_account_no, bank_ifsc
      FROM payroll.payroll_pensioners
      WHERE tenant_id = ${tenantId}::uuid
    `))) as unknown as Array<{ id: string; full_name: string; bank_account_no: string | null; bank_ifsc: string | null }>;
    for (const p of pens) master.set(p.id, { fullName: p.full_name, bankAccountNo: p.bank_account_no, bankIfsc: p.bank_ifsc });
  } else {
    const input = await fetchPayrollInput(tenantId, run.month);
    for (const e of input.employees) master.set(e.id, { fullName: e.fullName, bankAccountNo: e.bankAccountNo, bankIfsc: e.bankIfsc });
  }
  return master;
}
