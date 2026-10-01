"use client";

import type { ComponentProps } from "react";
import { useTranslations } from "next-intl";
import { DataTable } from "../../../_components/ds";

/**
 * GAP-HR-LOANS-02: client wrapper so the CSV export can (a) warn that the
 * file holds financial + identity data and (b) record the export in the audit
 * trail via hrms-service POST /v1/hrms/loans/export-audit (HR roles only --
 * the same roles the Export button is shown to). Fire-and-forget: audit
 * recording never blocks the user's own download.
 */
export async function recordLoansExport(info: { rowCount: number; filter: string }): Promise<void> {
  await fetch("/api/proxy/v1/hrms/loans/export-audit", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ rowCount: info.rowCount, ...(info.filter ? { filter: info.filter.slice(0, 200) } : {}) }),
  });
}

type Props<T extends Record<string, unknown>> = Omit<ComponentProps<typeof DataTable<T>>, "onExport" | "exportConfirm">;

export function LoansTable<T extends Record<string, unknown>>(props: Props<T>) {
  const t = useTranslations("loans");
  return (
    <DataTable<T>
      {...props}
      exportFilename="loans"
      exportConfirm={props.exportable ? { title: t("exportConfirmTitle"), description: t("exportConfirmBody"), confirmLabel: t("exportConfirmAction") } : undefined}
      onExport={(info) => { void recordLoansExport(info).catch(() => undefined); }}
    />
  );
}
