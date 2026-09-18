"use client";

import { useTranslations } from "next-intl";
import { DataTable } from "../../../../../_components/ds";
import { formatMoney } from "@/lib/formatters";

type BillLineItem = {
  description: string;
  quantity: number;
  unitPrice: number;
  amount: string;
  taxCode?: string;
} & Record<string, unknown>;

export function BillLineItemsTable({ rows }: { rows: BillLineItem[] }) {
  const t = useTranslations("expenditureBillLineItemsTable");
  return (
    <DataTable<BillLineItem>
      columns={[
        { key: "description", label: t("colDescription") },
        { key: "quantity", label: t("colQty"), align: "right" },
        {
          key: "unitPrice",
          label: t("colUnitPrice"),
          align: "right",
          render: (item) => (
            <span aria-label={t("ariaUnitPrice", { value: formatMoney(item.unitPrice as number) })}>
              {formatMoney(item.unitPrice as number)}
            </span>
          ),
        },
        {
          key: "amount",
          label: t("colAmount"),
          align: "right",
          render: (item) => (
            <span aria-label={t("ariaAmount", { value: formatMoney(item.amount as string) })}>
              {formatMoney(item.amount as string)}
            </span>
          ),
        },
        { key: "taxCode", label: t("colTaxCode"), render: (item) => (item.taxCode as string | undefined) ?? "—" },
      ]}
      rows={rows}
    />
  );
}
