"use client";

import { useTranslations } from "next-intl";

/**
 * GAP-PROCUREMENT-APPROVALS-ESCALATION-01: the thresholds below are maintained
 * with the application, NOT read from the workflow service routing
 * configuration. Until they are loaded from it (owner decision - which approvals
 * source is authoritative), say so on the page rather than present them as the
 * live routing.
 */
export function ReferenceOnlyNotice() {
  const t = useTranslations("procurement.w2b.escalation");
  return (
    <div className="card pad" style={{ margin: "0 0 12px", borderInlineStart: "3px solid var(--warn)" }}>
      <strong>{t("referenceOnlyTitle")}</strong> {t("referenceOnlyBody")}
    </div>
  );
}
