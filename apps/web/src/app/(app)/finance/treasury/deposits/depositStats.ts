import type { PillVariant } from "@/app/_components/ds/StatusPill";

/**
 * GAP-FINANCE-TREASURY-DEPOSITS-01/02/04/05: pure stat + label rules for the
 * deposits register, so every card means what its label says.
 *
 * treasury.finance_deposits.status is CHECK-constrained to active | refunded |
 * forfeited (finance-service treasury/repo.ts writes refunded / forfeited when
 * a refund / forfeit drains the balance to zero), so the three cards below sum
 * to the total. Money is bigint paise: balances arrive as minor-unit strings and
 * are summed in BigInt, never float.
 */
export interface DepositStatInput {
  status: string | null | undefined;
  balanceMinor: string | number | bigint | null | undefined;
}

function norm(status: string | null | undefined): string {
  return String(status ?? "").trim().toLowerCase();
}

function toBig(v: string | number | bigint | null | undefined): bigint {
  try {
    if (typeof v === "bigint") return v;
    if (typeof v === "number") return Number.isFinite(v) ? BigInt(Math.trunc(v)) : 0n;
    const t = (v ?? "").toString().trim();
    return /^-?\d+$/.test(t) ? BigInt(t) : 0n;
  } catch {
    return 0n;
  }
}

export function depositStats(deposits: readonly DepositStatInput[]) {
  let active = 0;
  let refunded = 0;
  let forfeited = 0;
  let activeBalanceMinor = 0n;
  for (const d of deposits) {
    const s = norm(d.status);
    if (s === "active") {
      active += 1;
      activeBalanceMinor += toBig(d.balanceMinor);
    } else if (s === "refunded") {
      refunded += 1;
    } else if (s === "forfeited") {
      forfeited += 1;
    }
  }
  return { total: deposits.length, active, refunded, forfeited, activeBalanceMinor };
}

/**
 * Table-local pill tone (the global StatusPill map is shared and contested):
 * active is live (green), refunded is settled (neutral), forfeited is an
 * adverse outcome for the depositor that finance should notice (amber).
 */
export function depositStatusVariant(status: string | null | undefined): PillVariant | undefined {
  const s = norm(status);
  if (s === "active") return "good";
  if (s === "refunded") return "mut";
  if (s === "forfeited") return "warn";
  return undefined;
}

/** finance-service createDepositBody.type: pd | emd | sd | fdr. */
const TYPE_LABELS: Record<string, string> = {
  pd: "Personal Deposit (PD)",
  emd: "Earnest Money (EMD)",
  sd: "Security Deposit (SD)",
  fdr: "Fixed Deposit Receipt (FDR)",
};

export function depositTypeLabel(type: string | null | undefined): string {
  return TYPE_LABELS[norm(type)] ?? (type ?? "");
}
