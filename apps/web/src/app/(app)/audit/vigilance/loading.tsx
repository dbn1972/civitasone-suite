import { getTranslations } from "next-intl/server";

const shimmer: React.CSSProperties = {
  background: "linear-gradient(90deg,#eef1f4 25%,#e2e6ea 37%,#eef1f4 63%)",
  backgroundSize: "400% 100%",
  animation: "auditShimmer 1.4s ease infinite",
  borderRadius: 8,
};

function Bar({ w, h, mb, r }: { w: number | string; h: number; mb?: number; r?: number }) {
  return <div style={{ ...shimmer, width: w, height: h, marginBottom: mb, borderRadius: r ?? 8 }} />;
}

// GAP-AUDIT-VIGILANCE-06: this used to be a single `.skeleton` box, which
// overrides the richer audit-level loading.tsx for this segment and caused a
// visible layout shift (one box -> header + KPI cards + table). Mirror the
// page structure (header, 5 stat cards, table rows) so CLS ~ 0, keep
// aria-busy on the wrapper and translate the aria-label.
export default async function VigilanceLoading() {
  const t = await getTranslations("msg");
  return (
    <div className="page-main wrap" aria-busy="true" aria-label={t("loading")}>
      <style>{"@keyframes auditShimmer{0%{background-position:100% 0}100%{background-position:0 0}}"}</style>
      <div className="ph">
        <div>
          <Bar w={240} h={28} mb={8} />
          <Bar w={380} h={14} />
        </div>
      </div>
      <div className="grid g-4" style={{ margin: "18px 0" }}>
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="card" style={{ padding: 16 }}>
            <Bar w={120} h={13} mb={12} />
            <Bar w={70} h={26} />
          </div>
        ))}
      </div>
      <div className="card" style={{ padding: 16 }}>
        <Bar w={200} h={16} mb={16} />
        {Array.from({ length: 6 }).map((_, i) => (
          <Bar key={i} w="100%" h={18} mb={12} />
        ))}
      </div>
    </div>
  );
}
