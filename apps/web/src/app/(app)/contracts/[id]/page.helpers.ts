import { formatMoney } from "@/lib/formatters";
export function field(data: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const v = data[key];
    if (typeof v === "string" && v.length > 0) return v;
    if (typeof v === "number") return String(v);
  }
  return "—";
}

export type ContractDisplayFields = {
  title: string;
  contractNo: string;
  parties: string;
  contractType: string;
  startDate: string;
  endDate: string;
  status: string;
  statusLower: string;
  statusCls: "good" | "bad" | "mut";
  description: string;
  valueDisplay: string;
  dept: string;
  amountMinor: number | string | undefined;
};

// Pure derivation of everything the page renders from the raw contract
// record contract-service returns. Extracted specifically so this — the
// exact logic that had multiple field-name mismatches against the real
// backend response (see fix/contract-frontend-field-mapping) — is directly
// unit-testable against realistic API payloads without needing to render
// the async server component itself.
//
// Lives in this separate file (not page.tsx) because Next.js's App Router
// only permits a fixed allow-list of named exports from a page.tsx module
// (default, generateMetadata, metadata, etc.) — exporting `field` directly
// from page.tsx fails `next build` with "'field' is not a valid Page export
// field", a check `tsc --noEmit` alone does not catch.
export function deriveContractDisplayFields(contract: Record<string, unknown>): ContractDisplayFields {
  const title = field(contract, "title", "name", "contractNo");
  const contractNo = field(contract, "contractNo", "contract_no", "number");
  // contract-service returns the vendor as a raw `vendorId` (uuid) with no
  // joined display name today (no vendor-name enrichment exists in the
  // backend) -- falls back to the id itself rather than a permanent "--",
  // which previously made this field look empty even when the data exists.
  const parties = field(contract, "party", "partyName", "parties", "vendor", "vendorId");
  const contractType = field(contract, "type", "contractType", "contract_type");
  const startDate = field(contract, "startDate", "start_date", "validFrom");
  // contract-service's column is `expiry`, not endDate/validTo/expiryDate.
  const endDate = field(contract, "endDate", "end_date", "validTo", "expiryDate", "expiry");
  const status = field(contract, "status");
  const description = field(contract, "description", "remarks", "notes");

  // contract-service's column is `valueMinor` (already in minor units/paise --
  // formatMoney expects exactly that, no conversion needed). The previous
  // value/amount/contractValue aliases never matched the real API response,
  // so the contract's own monetary value never rendered on its detail page.
  const rawValue = contract.value ?? contract.amount ?? contract.contractValue ?? contract.valueMinor;
  const valueDisplay =
    rawValue != null && rawValue !== "" && rawValue !== "—"
      ? formatMoney(rawValue as number | string | bigint)
      : "—";

  const statusLower = status.toLowerCase();
  const statusCls = statusLower === "active" ? "good" : statusLower === "expired" ? "bad" : "mut";

  const deptVal = field(contract, "department", "dept");
  const dept = deptVal !== "—" ? deptVal : "Procurement";
  // RaiseEOfficeNote's amountMinor prop accepts number | string specifically
  // so callers never have to round-trip a paise value through a JS double --
  // it's forwarded as-is and never used in arithmetic. valueMinor now really
  // is populated (a numeric string, per the live API response), so keep it as
  // a string rather than coercing through Number(), which would silently
  // round any value above Number.MAX_SAFE_INTEGER paise. Same accepted shape
  // as formatMoney's own integer-string check (a leading "+" is valid there
  // too) -- Value and the eOffice note's amount must agree on what counts as
  // a usable numeric string, or the two could silently disagree.
  const amountMinor: number | string | undefined =
    typeof rawValue === "number"
      ? rawValue
      : typeof rawValue === "string" && /^[+-]?\d+$/.test(rawValue.trim())
        ? rawValue.trim()
        : undefined;

  return {
    title, contractNo, parties, contractType, startDate, endDate,
    status, statusLower, statusCls, description, valueDisplay, dept, amountMinor,
  };
}
