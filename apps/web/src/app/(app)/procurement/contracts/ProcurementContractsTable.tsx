"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { DataTable } from "../../../_components/ds";
import { formatIndianDate, formatMoney } from "@/lib/formatters";
import { poHrefFromRef } from "@/lib/procurement-po-ref";

export type ContractRow = {
  id: string;
  label: string;
  /** Resolved vendor name (never the raw vendor id). */
  sublabel: string;
  /** Contract number. */
  meta: string;
  status: string;
  /** ISO expiry date, "" when the list response carries none. */
  expiry: string;
  /** Contract value in paise as a numeric string, "" when absent. */
  valueMinor: string;
  /** Linked PO reference as stored, "" when none. */
  poRef: string;
} & Record<string, unknown>;

type SortableRow = ContractRow & { expirySort: number; valueSort: number };

/**
 * GAP-PROCUREMENT-CONTRACTS-03/05: the procurement contracts register with the
 * expiry, value and linked-PO columns the officer needs to judge a contract
 * without opening it. Date and value columns sort through numeric mirrors so
 * "10 Jan" does not sort before "2 Feb". A missing field is a dash, never a
 * fabricated value.
 */
export function ProcurementContractsTable({ rows }: { rows: ContractRow[] }) {
  const t = useTranslations("procurement.contractsPage");
  const sortable: SortableRow[] = rows.map((r) => ({
    ...r,
    expirySort: r.expiry ? Date.parse(`${r.expiry}T00:00:00Z`) || Number.POSITIVE_INFINITY : Number.POSITIVE_INFINITY,
    valueSort: /^\d+$/.test(r.valueMinor) ? Number(r.valueMinor) : Number.NEGATIVE_INFINITY,
  }));

  return (
    <DataTable<SortableRow>
      rows={sortable}
      sortable
      filterable
      filterPlaceholder="Filter by contract, vendor, status…"
      pageSize={10}
      // GAP-PROCUREMENT-CONTRACTS-03: link the contract title to the existing
      // detail route /contracts/[id] so a row is openable.
      rowLinkKey="id"
      rowLinkPrefix="/contracts/"
      columns={[
        { key: "label", label: "Contract" },
        { key: "sublabel", label: "Vendor / Counter-party" },
        // meta is, and always was, the contract number (contract-service has no "type").
        { key: "meta", label: "Contract No." },
        { key: "expirySort", label: "Expires", render: (r) => (r.expiry ? formatIndianDate(r.expiry) : "—") },
        { key: "valueSort", label: "Value", align: "right", render: (r) => (r.valueMinor ? formatMoney(r.valueMinor) : "—") },
        {
          key: "poRef",
          label: "PO",
          render: (r) => {
            if (!r.poRef) return "—";
            const href = poHrefFromRef(r.poRef);
            return href ? <Link href={href}>{t("viewPo")}</Link> : r.poRef;
          },
        },
        { key: "status", label: "Status", cellType: "status" },
      ]}
    />
  );
}
