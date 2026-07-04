/**
 * IND-AS 36 — Impairment of Assets domain logic.
 *
 * Implements the structured impairment testing process:
 *   1. Determine carrying amount (book value at test date)
 *   2. Compute recoverable amount = max(FVLCD, VIU)
 *      - FVLCD = Fair Value Less Costs of Disposal
 *      - VIU   = Value in Use (present value of future cash flows)
 *   3. If carrying > recoverable → impairment loss = carrying - recoverable
 *   4. If carrying < recoverable (and prior impairment exists) → reversal
 *
 * References: IND-AS 36 paras 6, 18, 25-29, 30-57, 59-64, 114-123
 */

export interface ImpairmentTestInput {
  /** Carrying amount (book value) at test date in minor units (paise). */
  carryingAmountMinor: bigint;
  /** Fair value of the asset (market/appraised). */
  fairValueMinor: bigint | null;
  /** Costs of disposal (auction costs, dismantling, etc.). */
  disposalCostsMinor: bigint;
  /** Value in use — present value of future cash flows. */
  valueInUseMinor: bigint | null;
  /** Prior cumulative impairment (for reversal ceiling check). */
  priorImpairmentMinor?: bigint | undefined;
  /** Original cost minus accumulated depreciation (without impairment) — reversal ceiling. */
  unimpairedCarryingMinor?: bigint | undefined;
}

export interface ImpairmentTestResult {
  /** Higher of FVLCD and VIU. */
  recoverableAmountMinor: bigint;
  /** FVLCD = fair value - disposal costs (null if fair value unavailable). */
  fvlcdMinor: bigint | null;
  /** Value in use (null if not computed). */
  viuMinor: bigint | null;
  /** Impairment loss to recognise (0 if no impairment). */
  impairmentLossMinor: bigint;
  /** Reversal amount (positive means reverse prior impairment, 0 if none). */
  reversalMinor: bigint;
  /** Outcome classification. */
  outcome: "no_impairment" | "impairment_recognised" | "reversal";
  /** New carrying amount after impairment/reversal. */
  newCarryingAmountMinor: bigint;
}

/**
 * Compute FVLCD (Fair Value Less Costs of Disposal).
 * IND-AS 36 para 25-29: FVLCD = fair value - costs to sell.
 * Returns null if fair value is not determinable.
 */
export function computeFVLCD(fairValueMinor: bigint | null, disposalCostsMinor: bigint): bigint | null {
  if (fairValueMinor === null) return null;
  const fvlcd = fairValueMinor - disposalCostsMinor;
  return fvlcd > 0n ? fvlcd : 0n;
}

/**
 * Compute Value in Use via simplified DCF.
 * IND-AS 36 para 30-57: present value of estimated future cash flows.
 *
 * For a full implementation, callers provide pre-computed VIU from their
 * projection model. This helper is for simple assets with uniform cash flows.
 */
export function computeSimpleVIU(
  annualCashFlowMinor: bigint,
  discountRateBps: number,
  projectionYears: number,
): bigint {
  if (projectionYears <= 0 || discountRateBps <= 0) return 0n;
  const rate = discountRateBps / 10000; // bps → decimal
  let pv = 0;
  for (let t = 1; t <= projectionYears; t++) {
    pv += Number(annualCashFlowMinor) / Math.pow(1 + rate, t);
  }
  return BigInt(Math.round(pv));
}

/**
 * Run the IND-AS 36 impairment test.
 *
 * Determines whether an impairment loss must be recognised or a prior
 * impairment can be reversed.
 */
export function runImpairmentTest(input: ImpairmentTestInput): ImpairmentTestResult {
  const { carryingAmountMinor, fairValueMinor, disposalCostsMinor, valueInUseMinor } = input;

  // Step 1: Compute FVLCD
  const fvlcdMinor = computeFVLCD(fairValueMinor, disposalCostsMinor);

  // Step 2: Recoverable amount = max(FVLCD, VIU)
  // If only one is available, use that one (IND-AS 36 para 20)
  let recoverableAmountMinor: bigint;
  if (fvlcdMinor !== null && valueInUseMinor !== null) {
    recoverableAmountMinor = fvlcdMinor > valueInUseMinor ? fvlcdMinor : valueInUseMinor;
  } else if (fvlcdMinor !== null) {
    recoverableAmountMinor = fvlcdMinor;
  } else if (valueInUseMinor !== null) {
    recoverableAmountMinor = valueInUseMinor;
  } else {
    // Neither available — cannot determine; assume no impairment
    return {
      recoverableAmountMinor: carryingAmountMinor,
      fvlcdMinor: null,
      viuMinor: null,
      impairmentLossMinor: 0n,
      reversalMinor: 0n,
      outcome: "no_impairment",
      newCarryingAmountMinor: carryingAmountMinor,
    };
  }

  // Step 3: Compare carrying vs recoverable
  if (carryingAmountMinor > recoverableAmountMinor) {
    // Impairment loss (IND-AS 36 para 59)
    const impairmentLossMinor = carryingAmountMinor - recoverableAmountMinor;
    return {
      recoverableAmountMinor,
      fvlcdMinor,
      viuMinor: valueInUseMinor ?? null,
      impairmentLossMinor,
      reversalMinor: 0n,
      outcome: "impairment_recognised",
      newCarryingAmountMinor: recoverableAmountMinor,
    };
  }

  // Step 4: Check for reversal (IND-AS 36 para 114-123)
  const priorImpairment = input.priorImpairmentMinor ?? 0n;
  if (priorImpairment > 0n && recoverableAmountMinor > carryingAmountMinor) {
    // Reversal is capped: new carrying cannot exceed what it would have been
    // without the original impairment (i.e., depreciated cost without impairment).
    const ceiling = input.unimpairedCarryingMinor ?? carryingAmountMinor + priorImpairment;
    const maxReversal = ceiling - carryingAmountMinor;
    const candidateReversal = recoverableAmountMinor - carryingAmountMinor;
    const reversalMinor = candidateReversal < maxReversal ? candidateReversal : maxReversal;
    const capped = reversalMinor > priorImpairment ? priorImpairment : reversalMinor;

    if (capped > 0n) {
      return {
        recoverableAmountMinor,
        fvlcdMinor,
        viuMinor: valueInUseMinor ?? null,
        impairmentLossMinor: 0n,
        reversalMinor: capped,
        outcome: "reversal",
        newCarryingAmountMinor: carryingAmountMinor + capped,
      };
    }
  }

  // No impairment and no reversal
  return {
    recoverableAmountMinor,
    fvlcdMinor,
    viuMinor: valueInUseMinor ?? null,
    impairmentLossMinor: 0n,
    reversalMinor: 0n,
    outcome: "no_impairment",
    newCarryingAmountMinor: carryingAmountMinor,
  };
}
