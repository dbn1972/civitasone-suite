"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { DataTable, StatusPill } from "../../../../_components/ds";

export type VendorGrnRow = {
  id: string;
  grnNo: string;
  receivedDisplay: string;
  status: string;
  statusLabel: string;
};

/** GAP-PROCUREMENT-VENDORS-DETAIL-04: the vendor's own goods receipts, each linking to its GRN. */
export function VendorGrnsTable({ rows }: { rows: VendorGrnRow[] }) {
  const t = useTranslations("procurement.w2.vendorDetail");
  return (
    <DataTable<VendorGrnRow>
      rows={rows}
      pageSize={25}
      columns={[
        {
          key: "grnNo",
          label: t("colGrn"),
          render: (r) => (
            <Link href={`/procurement/grn/${r.id}`} className="mono">
              {r.grnNo}
            </Link>
          ),
        },
        { key: "receivedDisplay", label: t("colReceived") },
        { key: "status", label: t("colStatus"), render: (r) => <StatusPill status={r.status} label={r.statusLabel} /> },
      ]}
    />
  );
}

export type VendorSecurityDisplayRow = {
  id: string;
  kind: "EMD" | "PBG";
  ref: string;
  instrument: string;
  amountDisplay: string;
  validUntilDisplay: string;
  status: string;
};

/** GAP-PROCUREMENT-VENDORS-DETAIL-04: EMD and performance bank guarantees held for the vendor. */
export function VendorSecuritiesTable({ rows }: { rows: VendorSecurityDisplayRow[] }) {
  const t = useTranslations("procurement.w2.vendorDetail");
  return (
    <DataTable<VendorSecurityDisplayRow>
      rows={rows}
      pageSize={25}
      columns={[
        { key: "kind", label: t("colType") },
        { key: "ref", label: t("colRef"), render: (r) => <span className="mono">{r.ref}</span> },
        { key: "instrument", label: t("colInstrument") },
        {
          key: "amountDisplay",
          label: t("colAmount"),
          render: (r) => (
            <span className="mono" style={{ display: "block", textAlign: "end" }}>
              {r.amountDisplay}
            </span>
          ),
        },
        { key: "validUntilDisplay", label: t("colValidUntil") },
        { key: "status", label: t("colStatus"), render: (r) => <StatusPill status={r.status} label={r.status.replace(/_/g, " ")} /> },
      ]}
    />
  );
}
