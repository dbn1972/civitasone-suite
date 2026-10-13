import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { tableExportGuard, TABLE_EXPORT_NOT_RECORDED, type ExportGuard } from "./csvExport";

/** Message for a failed audit, translated when a next-intl provider is mounted (English fallback otherwise). */
export function useExportNotRecordedMessage(): string {
  try {
    // eslint-disable-next-line react-hooks/rules-of-hooks -- mirrors DataTable's provider-less fallback
    return useTranslations("tableExport")("notRecorded");
  } catch {
    return TABLE_EXPORT_NOT_RECORDED;
  }
}

/** Fail-closed audit guard for a hand-rolled export, bound to a resource key (e.g. "hr/transfer"). */
export function useTableExportGuard(resource: string): ExportGuard {
  const message = useExportNotRecordedMessage();
  return useMemo(() => tableExportGuard(resource, message), [resource, message]);
}
