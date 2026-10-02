"use client";

import { useTranslations } from "next-intl";
import { Button } from "../../../../../_components/ds";

// GAP-PAYROLL-SALARY-SLIPS-05 / GAP-PAYROLL-SLIPS-DETAIL-05: a draft or
// computed slip has not been through finalisation and may still change --
// printing/downloading it before then can circulate figures that get
// revised. `disabled` is driven by the caller's own slip.status check
// (page.tsx), not duplicated here, so there is one place that decides which
// statuses count as "final".
export function PrintButton({ disabled = false, disabledReason }: { disabled?: boolean; disabledReason?: string }) {
  const t = useTranslations("printButton");
  return (
    <Button
      type="button"
      onClick={() => window.print()}
      disabled={disabled}
      title={disabled ? disabledReason : undefined}
      aria-disabled={disabled || undefined}
      style={{ minHeight: 40 }}
    >
      {t("printSavePdfBtn")}
    </Button>
  );
}
