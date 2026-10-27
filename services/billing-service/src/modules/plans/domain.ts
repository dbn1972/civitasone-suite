export const PLAN_INTERVALS = ["monthly", "quarterly", "yearly"] as const;
export type PlanInterval = (typeof PLAN_INTERVALS)[number];

export function toInterval(v: string): PlanInterval {
  return (PLAN_INTERVALS as readonly string[]).includes(v) ? (v as PlanInterval) : "monthly";
}

export function monthsInInterval(i: PlanInterval): number {
  return i === "yearly" ? 12 : i === "quarterly" ? 3 : 1;
}

/** Price per month in whole paise (integer division, bigint): plans of different intervals compare honestly. */
export function pricePerMonthMinor(priceMinor: bigint, i: PlanInterval): bigint {
  return priceMinor / BigInt(monthsInInterval(i));
}

export type PlanView = {
  id: string;
  name: string;
  code: string;
  priceMinor: string;
  currency: string;
  govtExempt: boolean;
  active: boolean;
  interval: PlanInterval;
};
