import { SkeletonBar } from "../../../../_components/ds/Skeleton";
import { useTranslations } from "next-intl";

export default function CRMAccountDetailLoading() {
  const t = useTranslations("crm.loading");
  // GAP-CRM-ACCOUNTS-DETAIL-07: mirror the loaded two-column g-main layout
  // (header + two column cards + three full-width panel cards below) so there
  // is no layout shift, and inherit the app-shell padding rather than a
  // min-h-screen / slate wrapper.
  const card = (height: number) => (
    <div className="card">
      <div className="pad">
        <SkeletonBar w="40%" h={16} />
        <div style={{ height }} />
      </div>
    </div>
  );
  return (
    <div aria-busy="true" aria-label={t("account")} className="animate-pulse" style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      {/* header */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <SkeletonBar w={160} h={12} />
        <SkeletonBar w={260} h={28} />
      </div>
      {/* two-column g-main */}
      <div className="grid g-main" style={{ alignItems: "start" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          {card(140)}
          {card(100)}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          {card(120)}
          {card(80)}
        </div>
      </div>
      {/* full-width panels below the fold */}
      <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
        {card(120)}
        {card(120)}
        {card(120)}
      </div>
    </div>
  );
}
