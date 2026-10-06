import { SkeletonBar, SkeletonRow } from "../../../_components/ds/Skeleton";
import { useTranslations } from "next-intl";

/**
 * GAP-CRM-ONBOARDING-04: the loaded page is a filter row + a card with a table
 * of cases, but the old loading state was a bare "Loading onboarding cases…"
 * text line. This skeleton mirrors the real layout (two filter controls + a
 * card with table rows) using ds Skeleton theme tokens, so there is no jump to
 * a differently-shaped page on load.
 */
export default function OnboardingLoading() {
  const t = useTranslations("crm.loading");
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {/* filter row (Stage + KYC selects) */}
      <div style={{ display: "flex", gap: 12 }}>
        <SkeletonBar w={160} h={40} />
        <SkeletonBar w={160} h={40} />
      </div>
      <div className="card" aria-busy="true" aria-label={t("onboarding")} style={{ padding: 16 }}>
        <SkeletonBar w={180} h={16} style={{ marginBottom: 16 }} />
        {Array.from({ length: 6 }).map((_, i) => (
          <SkeletonRow key={i} />
        ))}
      </div>
    </div>
  );
}
