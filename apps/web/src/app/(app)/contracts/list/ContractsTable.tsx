"use client";

import Link from "next/link";
import { DataTable, StatusPill } from "../../../_components/ds";
import { formatIndianDate, formatMoney } from "@/lib/formatters";

export type ContractRow = {
  id: string;
  label: string;
  /** Raw vendor uuid from contract-service; resolved to a name for display. */
  vendorId?: string;
  status: string;
  meta: string;
  /** ISO expiry date (GAP-CONTRACTS-LIST-04). */
  expiry?: string;
  /** Contract value in paise, as a numeric string (GAP-CONTRACTS-LIST-04). */
  valueMinor?: string;
  /** Resolved vendor display name, injected by the table (not from the row). */
  vendorName?: string;
  /** Sortable numeric mirror of expiry (ms); -Infinity when absent so it sorts last. */
  expirySort?: number;
  /** Sortable numeric mirror of valueMinor; -Infinity when absent. */
  valueSort?: number;
} & Record<string, unknown>;

const DAY_MS = 86_400_000;

function isExpiringSoon(expiry: string | undefined, status: string): boolean {
  if (!expiry) return false;
  if (status.toLowerCase() !== "active") return false;
  const ms = Date.parse(`${expiry}T00:00:00Z`);
  if (Number.isNaN(ms)) return false;
  const days = Math.floor((ms - Date.now()) / DAY_MS);
  return days >= 0 && days <= 30;
}

export function ContractsTable({
  rows,
  vendorNames,
  vendorNamesUnavailable = false,
}: {
  rows: ContractRow[];
  vendorNames: Record<string, string>;
  /** When the vendor master could not be loaded, show "—" rather than a UUID. */
  vendorNamesUnavailable?: boolean;
}) {
  // GAP-CONTRACTS-LIST-01: resolve the raw vendorId to a human name. Never
  // print the 36-char UUID in the cell — fall back to "Unknown vendor" (or
  // "—" when the whole vendor master failed to load).
  const enriched: ContractRow[] = rows.map((r) => {
    const vendorName = r.vendorId
      ? (vendorNames[r.vendorId] ?? (vendorNamesUnavailable ? "—" : "Unknown vendor"))
      : "—";
    const expirySort = r.expiry ? Date.parse(`${r.expiry}T00:00:00Z`) || Number.NEGATIVE_INFINITY : Number.NEGATIVE_INFINITY;
    const valueSort = r.valueMinor != null && /^[+-]?\d+$/.test(r.valueMinor) ? Number(r.valueMinor) : Number.NEGATIVE_INFINITY;
    return { ...r, vendorName, expirySort, valueSort };
  });

  return (
    <DataTable<ContractRow>
      // GAP-CONTRACTS-LIST-03: a department with hundreds of contracts needs
      // search, sort and paging. Export is deliberately NOT enabled: contract
      // values are commercially sensitive and an export must be role-gated and
      // audited server-side first (recorded as a decision / HUMAN REVIEW).
      sortable
      filterable
      pageSize={25}
      columns={[
        {
          key: "label",
          label: "Title",
          sortable: false,
          render: (r) => (
            <Link href={`/contracts/${r.id}`} className="lnk" title={r.vendorId ? `Vendor ${r.vendorId}` : undefined}>
              {r.label}
            </Link>
          ),
        },
        // GAP-CONTRACTS-LIST-01: header is "Vendor" (the name), not "Vendor ID".
        { key: "vendorName", label: "Vendor" },
        { key: "meta", label: "Contract No." },
        {
          key: "expirySort",
          label: "Expires",
          render: (r) => (
            <span>
              {r.expiry ? formatIndianDate(r.expiry) : "—"}
              {isExpiringSoon(r.expiry, r.status) ? (
                <>
                  {" "}
                  <StatusPill status="expiring soon" variant="warn" label="Expiring soon" />
                </>
              ) : null}
            </span>
          ),
        },
        {
          key: "valueSort",
          label: "Value",
          render: (r) => (
            <span style={{ display: "block", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
              {r.valueMinor != null && /^[+-]?\d+$/.test(r.valueMinor) ? formatMoney(r.valueMinor) : "—"}
            </span>
          ),
        },
        {
          key: "status",
          label: "Status",
          render: (r) => <StatusPill status={r.status} />,
        },
      ]}
      rows={enriched}
    />
  );
}
