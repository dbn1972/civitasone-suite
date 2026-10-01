import { z } from "zod";
import { rupeesToMinorString, percentToBps } from "@/lib/money";
import { isValidFinancialYearLabel } from "@/lib/fiscalYear";

/**
 * GAP-PAYROLL-BONUS-02/03: one place that validates the Compute Bonus form
 * and converts it to the API payload -- string/BigInt money (no
 * parseFloat * 100), basis-point percentage, statutory 8.33-20% range
 * (Payment of Bonus Act ss.10-11; payroll-service enforces the same bounds),
 * and a consecutive-year FY label.
 *
 * The issue `path` is the form field to flag; the `message` is a message key
 * in the computeBonusForm namespace.
 */
export const BONUS_PCT_MIN_BPS = 833;
export const BONUS_PCT_MAX_BPS = 2000;

const bonusFormSchema = z.object({
  employeeId: z.string().uuid("employeeIdRequiredError"),
  fy: z.string().refine(isValidFinancialYearLabel, "fyFormatError"),
  basic: z.string().refine((v) => rupeesToMinorString(v) !== null, "basicRequiredError"),
  bonusPct: z.string().refine((v) => {
    const bps = percentToBps(v);
    return bps !== null && bps >= BONUS_PCT_MIN_BPS && bps <= BONUS_PCT_MAX_BPS;
  }, "bonusPctRangeError"),
});

export type BonusFormField = "employeeId" | "fy" | "basic" | "bonusPct";
export type BonusFormInput = { employeeId: string | null; fy: string; basic: string; bonusPct: string };
export type BonusPayload = { employeeId: string; fy: string; basicMinor: number; bonusPct: number; bonusBps: number };

export function parseBonusForm(
  input: BonusFormInput,
): { ok: true; payload: BonusPayload } | { ok: false; field: BonusFormField; messageKey: string } {
  const parsed = bonusFormSchema.safeParse({ ...input, employeeId: input.employeeId ?? "" });
  if (!parsed.success) {
    const issue = parsed.error.issues[0]!;
    return { ok: false, field: issue.path[0] as BonusFormField, messageKey: issue.message };
  }
  const basicMinor = rupeesToMinorString(parsed.data.basic)!;
  if (BigInt(basicMinor) > BigInt(Number.MAX_SAFE_INTEGER)) {
    return { ok: false, field: "basic", messageKey: "basicRequiredError" };
  }
  const bonusBps = percentToBps(parsed.data.bonusPct)!;
  return {
    ok: true,
    payload: {
      employeeId: parsed.data.employeeId,
      fy: parsed.data.fy.trim(),
      basicMinor: Number(basicMinor),
      // The API takes a percentage number; bps/100 of a 2-dp value is exact
      // enough that the server's Math.round(pct * 100) recovers the same bps.
      bonusPct: bonusBps / 100,
      bonusBps,
    },
  };
}
