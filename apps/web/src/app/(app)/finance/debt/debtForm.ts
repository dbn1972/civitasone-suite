import { percentToBps, rupeesToMinorString } from "@/lib/money";

export type DebtFormValues = {
  instrument: string;
  source: string;
  lender: string;
  principal: string;
  ratePct: string;
  tenureMonths: string;
  firstEmiDate: string;
};

export type DebtFormErrorKey = "instrument" | "source" | "lender" | "principal" | "rate" | "tenure" | "firstEmi";
/** Field -> message id (the form translates the id under financeDebtNew.error). */
export type DebtFormErrors = Partial<Record<DebtFormErrorKey, DebtFormErrorKey>>;

/** The values as the API wants them, or the field errors (keys are message ids the form translates). */
export function parseDebtForm(v: DebtFormValues):
  | { ok: true; body: { instrument: string; source: string; lender: string; principalMinor: string; interestRateBps: number; tenureMonths: number; firstEmiDate: string } }
  | { ok: false; errors: DebtFormErrors } {
  const errors: DebtFormErrors = {};
  if (v.instrument.trim().length < 2) errors.instrument = "instrument";
  if (!v.source) errors.source = "source";
  if (v.lender.trim().length < 2) errors.lender = "lender";
  const principalMinor = rupeesToMinorString(v.principal);
  if (principalMinor === null) errors.principal = "principal";
  const bps = percentToBps(v.ratePct);
  if (bps === null || bps > 10_000) errors.rate = "rate";
  const tenure = /^\d{1,3}$/.test(v.tenureMonths.trim()) ? Number(v.tenureMonths.trim()) : NaN;
  if (!Number.isInteger(tenure) || tenure < 1 || tenure > 600) errors.tenure = "tenure";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v.firstEmiDate)) errors.firstEmi = "firstEmi";
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    body: {
      instrument: v.instrument.trim(), source: v.source, lender: v.lender.trim(),
      principalMinor: principalMinor as string, interestRateBps: bps as number, tenureMonths: tenure, firstEmiDate: v.firstEmiDate,
    },
  };
}
