"use client";

import type { ComponentProps } from "react";
import { useTranslations } from "next-intl";
import { DataTable } from "../../../_components/ds";
import { postExportAudit, type ExportVerdict } from "@/lib/export/csvExport";
import { EmiProgressCell } from "./EmiProgressCell";

/**
 * GAP-HR-LOANS-02: client wrapper so the CSV export can (a) warn that the
 * file holds financial + identity data and (b) record the export in the audit
 * trail via hrms-service POST /v1/hrms/loans/export-audit (HR roles only --
 * the same roles the Export button is shown to). Fire-and-forget: audit
 * recording never blocks the user's own download.
 *
 * GAP-HR-LOANS-03: it is also where the "emiProgress" column gets its visual.
 * A Server Component cannot hand DataTable a render function, so the page
 * passes plain column data (the "x / y" text stays the filter / sort / CSV
 * value) and this client wrapper attaches the progress-bar renderer, reading
 * the row's raw emisPaid / totalEmis counts.
 */
export async function recordLoansExport(info: { rowCount: number; filter: string }): Promise<ExportVerdict> {
  return postExportAudit("/api/proxy/v1/hrms/loans/export-audit", { rowCount: info.rowCount, ...(info.filter ? { filter: info.filter.slice(0, 200) } : {}) });
}

type Props<T extends Record<string, unknown>> = Omit<ComponentProps<typeof DataTable<T>>, "onExport" | "exportGuard" | "exportAudit" | "exportConfirm">;

export function LoansTable<T extends Record<string, unknown>>(props: Props<T>) {
  const t = useTranslations("loans");
  const columns = props.columns.map((col) =>
    (col.key as string) === "emiProgress" && !col.render
      ? {
          ...col,
          render: (row: T) => <EmiProgressCell paid={Number(row["emisPaid"])} total={Number(row["totalEmis"])} />,
        }
      : col,
  );
  return (
    <DataTable<T>
      {...props}
      columns={columns}
      exportFilename="loans"
      exportConfirm={props.exportable ? { title: t("exportConfirmTitle"), description: t("exportConfirmBody"), confirmLabel: t("exportConfirmAction") } : undefined}
      exportGuard={recordLoansExport}
    />
  );
}
