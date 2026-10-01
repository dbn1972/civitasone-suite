"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { ConfirmDialog } from "../../../../_components/ds";

/**
 * GAP-PAYROLL-RETURNS-08: the RPU flat-file download was a plain link even
 * when the quarter carried a TRACES reconciliation warning. A reconciled
 * quarter keeps the one-click link; an unreconciled one asks first.
 */
export function RpuDownloadLink({ href, reconciled }: { href: string; reconciled: boolean }) {
  const t = useTranslations("payrollReturns");
  const [open, setOpen] = useState(false);

  if (reconciled) {
    return (
      <a className="btn ghost sm" href={href}>
        <span aria-hidden="true">⬇</span> {t("downloadRpu")}
      </a>
    );
  }

  return (
    <>
      <button type="button" className="btn ghost sm" onClick={() => setOpen(true)} style={{ minHeight: 44 }}>
        <span aria-hidden="true">⬇</span> {t("downloadRpu")}
      </button>
      <ConfirmDialog
        open={open}
        danger
        title={t("downloadUnreconciledTitle")}
        description={t("downloadUnreconciledDescription")}
        confirmLabel={t("downloadAnyway")}
        onConfirm={() => {
          setOpen(false);
          window.location.assign(href);
        }}
        onCancel={() => setOpen(false)}
      />
    </>
  );
}
