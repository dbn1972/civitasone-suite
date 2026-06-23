export class DomainError extends Error {
  constructor(public code: string, message: string) {
    super(`[${code}] ${message}`);
    this.name = "DomainError";
  }
}

export interface PayComponent {
  code: string;
  name: string;
  type: "earning" | "deduction";
  amountMinor: bigint;
}

export type PensionScheme = "GPF" | "NPS" | "EPF";

export interface SlipInput {
  basicMinor: bigint;
  components: PayComponent[];
  pensionScheme?: PensionScheme;
}

export interface SlipResult {
  grossMinor: bigint;
  totalDeductionsMinor: bigint;
  netPayMinor: bigint;
  pfEmployeeMinor: bigint;
  pfEmployerMinor: bigint;
  esiMinor: bigint;
  tdsMinor: bigint;
  gpfMinor: bigint;
  npsEmployeeMinor: bigint;
  npsEmployerMinor: bigint;
}

const PF_PCT    = 12n;
const PF_CAP    = 1_500_000n; // PF ceiling: 15000 INR = 1500000 paise
const ESI_CAP   = 2_100_000n; // ESI ceiling: 21000 INR gross/month
const TDS_SLAB  = 50_000_000n; // 500000 INR = 50000000 paise annual
const TDS_PCT   = 10n;
const GPF_PCT   = 10n;  // eHRMS: 10% of basic
const NPS_EMP_PCT = 10n;
const NPS_ER_PCT  = 14n;

export function computeSlip(input: SlipInput): SlipResult {
  const { basicMinor, components, pensionScheme = "EPF" } = input;

  let grossMinor = basicMinor;
  let totalDeductionsMinor = 0n;

  for (const c of components) {
    if (c.type === "earning") {
      grossMinor += c.amountMinor;
    } else {
      totalDeductionsMinor += c.amountMinor;
    }
  }

  let pfEmployeeMinor = 0n;
  let pfEmployerMinor = 0n;
  let gpfMinor = 0n;
  let npsEmployeeMinor = 0n;
  let npsEmployerMinor = 0n;

  if (pensionScheme === "GPF") {
    gpfMinor = (basicMinor * GPF_PCT) / 100n;
  } else if (pensionScheme === "NPS") {
    npsEmployeeMinor = (basicMinor * NPS_EMP_PCT) / 100n;
    npsEmployerMinor = (basicMinor * NPS_ER_PCT) / 100n;
  } else {
    const pfBase           = basicMinor > PF_CAP ? PF_CAP : basicMinor;
    pfEmployeeMinor        = (pfBase * PF_PCT) / 100n;
    pfEmployerMinor        = (pfBase * PF_PCT) / 100n;
  }

  const esiMinor = grossMinor <= ESI_CAP ? (grossMinor * 75n) / 10000n : 0n;

  const annualBasic    = basicMinor * 12n;
  const taxableAnnual  = annualBasic > TDS_SLAB ? annualBasic - TDS_SLAB : 0n;
  const annualTds      = (taxableAnnual * TDS_PCT) / 100n;
  const tdsMinor       = annualTds / 12n;

  const totalDeductions = totalDeductionsMinor + pfEmployeeMinor + esiMinor + tdsMinor + gpfMinor + npsEmployeeMinor;
  const netPayMinor     = grossMinor - totalDeductions;

  return {
    grossMinor,
    totalDeductionsMinor: totalDeductions,
    netPayMinor: netPayMinor < 0n ? 0n : netPayMinor,
    pfEmployeeMinor,
    pfEmployerMinor,
    esiMinor,
    tdsMinor,
    gpfMinor,
    npsEmployeeMinor,
    npsEmployerMinor,
  };
}

export function assertRunStatusTransition(current: string, next: string): void {
  const allowed: Record<string, string[]> = {
    draft:      ["processing"],
    processing: ["approved", "failed"],
    approved:   ["disbursed"],
    disbursed:  [],
    failed:     ["draft"],
  };
  if (!(allowed[current] ?? []).includes(next)) {
    throw new DomainError("INVALID_STATUS_TRANSITION", `cannot move payroll run from '${current}' to '${next}'`);
  }
}

export function computeGratuity(yearsOfService: number, lastBasicMinor: bigint): bigint {
  // Formula: (last basic / 26) * 15 * years_of_service
  if (yearsOfService < 5) return 0n;
  return (lastBasicMinor * 15n * BigInt(Math.floor(yearsOfService))) / 26n;
}
