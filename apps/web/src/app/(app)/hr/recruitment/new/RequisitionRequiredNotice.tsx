"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";

/** GAP-RECRUITMENT-NEW-06: shown instead of a usable form when the edition is requisition-first. */
export function RequisitionRequiredNotice() {
  const t = useTranslations("recruitmentNewJob");
  return (
    <div role="status" style={{ padding: "12px 14px", border: "1px solid var(--warn, var(--line))", borderRadius: 8, background: "var(--warnbg, var(--panel))", fontSize: 14 }}>
      <strong style={{ display: "block", marginBottom: 4 }}>{t("requisitionRequiredTitle")}</strong>
      <p style={{ margin: "0 0 8px" }}>{t("requisitionRequiredBody")}</p>
      <Link href="/hr/recruitment/requisitions" className="btn primary">{t("requisitionRequiredAction")}</Link>
    </div>
  );
}
