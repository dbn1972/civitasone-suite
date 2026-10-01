import { rupeesToMinorString, percentToBps } from "@/lib/money";

/** payroll-service loans/validators.ts MAX_MONEY_MINOR (₹10 crore in paise). */
export const MAX_LOAN_MONEY_MINOR = 10_000_000_000n;
/** payroll-service loans/validators.ts MAX_TENURE_MONTHS. */
export const MAX_LOAN_TENURE_MONTHS = 360;

export type LoanFormInput = {
  loanNo: string;
  employeeId: string | null;
  principalRupees: string;
  emiRupees: string;
  tenureMonths: string;
  interestRatePct: string;
};

export type LoanFormField = "loanNo" | "employeeId" | "principal" | "emi" | "tenure" | "interestRate";

export type LoanFormErrorCode =
  | "required"
  | "amountInvalid"
  | "amountTooLarge"
  | "tenureInvalid"
  | "rateInvalid"
  | "emiTooLow";

export type LoanFormResult =
  | {
      ok: true;
      value: {
        loanNo: string;
        employeeId: string;
        principalMinor: bigint;
        emiMinor: bigint;
        tenureMonths: number;
        interestRatePct: number;
      };
    }
  | { ok: false; errors: Partial<Record<LoanFormField, LoanFormErrorCode>> };

function parseAmount(raw: string): { minor: bigint } | { error: LoanFormErrorCode } {
  if (!raw.trim()) return { error: "required" };
  const minor = rupeesToMinorString(raw);
  if (minor === null) return { error: "amountInvalid" };
  const big = BigInt(minor);
  if (big > MAX_LOAN_MONEY_MINOR) return { error: "amountTooLarge" };
  return { minor: big };
}

/**
 * GAP-PAYROLL-LOANS-05: client-side validation for the create-loan form.
 * Money is parsed by string (rupeesToMinorString -- rejects "1.005", "1e3",
 * negatives) into bigint paise, never `Math.round(Number(x) * 100)`.
 *
 * Cross-field rule: total repayment (EMI x tenure) must cover the principal
 * -- true for every loan whatever its interest rate, so this never blocks a
 * legitimate interest-bearing loan. An upper bound (EMI x tenure vs
 * principal + interest) is deliberately NOT enforced: the catalogue marks
 * that bound as needing business sign-off.
 */
export function validateLoanForm(input: LoanFormInput): LoanFormResult {
  const errors: Partial<Record<LoanFormField, LoanFormErrorCode>> = {};

  const loanNo = input.loanNo.trim();
  if (!loanNo) errors.loanNo = "required";

  const employeeId = input.employeeId ?? "";
  if (!employeeId) errors.employeeId = "required";

  const principal = parseAmount(input.principalRupees);
  if ("error" in principal) errors.principal = principal.error;

  const emi = parseAmount(input.emiRupees);
  if ("error" in emi) errors.emi = emi.error;

  const tenureRaw = input.tenureMonths.trim();
  let tenureMonths = 0;
  if (!tenureRaw) {
    errors.tenure = "required";
  } else if (!/^\d+$/.test(tenureRaw) || Number(tenureRaw) < 1 || Number(tenureRaw) > MAX_LOAN_TENURE_MONTHS) {
    errors.tenure = "tenureInvalid";
  } else {
    tenureMonths = Number(tenureRaw);
  }

  const rateRaw = input.interestRatePct.trim() || "0";
  const bps = percentToBps(rateRaw);
  if (bps === null || bps > 10_000) errors.interestRate = "rateInvalid";

  if ("minor" in principal && "minor" in emi && tenureMonths > 0 && !errors.emi) {
    if (emi.minor * BigInt(tenureMonths) < principal.minor) errors.emi = "emiTooLow";
  }

  if (Object.keys(errors).length > 0 || !("minor" in principal) || !("minor" in emi) || bps === null) {
    return { ok: false, errors };
  }
  return {
    ok: true,
    value: {
      loanNo,
      employeeId,
      principalMinor: principal.minor,
      emiMinor: emi.minor,
      tenureMonths,
      interestRatePct: bps / 100,
    },
  };
}
