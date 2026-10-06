import { useTranslations } from "next-intl";
/**
 * GAP-CRM-CONTACTS-DETAIL-06: the loaded contact-detail page is a PageHeader
 * over a two-column `.grid.g-main` (primary column: contact details + several panels,
 * secondary column: lead controls + score history). The old skeleton painted a single
 * centred column of two blocks on a `min-h-screen bg-slate-50` background,
 * so the page jumped a full layout change when the real content resolved.
 * This mirrors the real structure — header bars, then the same two columns
 * of card skeletons — so there is no column/background shift on load.
 */
function CardSkeleton({ bodyHeight }: { bodyHeight: number }) {
  return (
    <div className="card" aria-hidden="true">
      <div className="card-h">
        <div style={{ height: 16, width: 160, borderRadius: 6, background: "var(--line2)" }} />
      </div>
      <div className="pad">
        <div style={{ height: bodyHeight, borderRadius: 8, background: "var(--line2)" }} />
      </div>
    </div>
  );
}

export default function ContactDetailLoading() {
  const t = useTranslations("crm.loading");
  return (
    <div aria-busy="true" aria-label={t("contact")} className="animate-pulse">
      {/* PageHeader placeholder (back link + title) */}
      <div className="ph">
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ height: 13, width: 90, borderRadius: 6, background: "var(--line2)" }} />
          <div style={{ height: 26, width: 220, borderRadius: 6, background: "var(--line2)" }} />
          <div style={{ height: 14, width: 160, borderRadius: 6, background: "var(--line2)" }} />
        </div>
      </div>
      <div className="grid g-main" style={{ alignItems: "start" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <CardSkeleton bodyHeight={160} />
          <CardSkeleton bodyHeight={60} />
          <CardSkeleton bodyHeight={120} />
          <CardSkeleton bodyHeight={120} />
          <CardSkeleton bodyHeight={100} />
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <CardSkeleton bodyHeight={90} />
          <CardSkeleton bodyHeight={90} />
          <CardSkeleton bodyHeight={120} />
        </div>
      </div>
    </div>
  );
}
