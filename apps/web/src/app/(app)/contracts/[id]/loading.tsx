import type { CSSProperties } from "react";

const shimmer: CSSProperties = {
  background: "linear-gradient(90deg,var(--panel) 25%,var(--line) 37%,var(--panel) 63%)",
  backgroundSize: "400% 100%",
  animation: "contractDetailShimmer 1.4s ease infinite",
  borderRadius: 8,
};

function Bar({ w, h, mb }: { w: number | string; h: number; mb?: number }) {
  return <div aria-hidden style={{ ...shimmer, width: w, height: h, marginBottom: mb, borderRadius: 8 }} />;
}

export default function ContractDetailLoading() {
  return (
    <div className="wrap" aria-busy="true" aria-label="Loading contract details">
      <style>{"@keyframes contractDetailShimmer{0%{background-position:100% 0}100%{background-position:0 0}}"}</style>
      <div className="ph">
        <div>
          <Bar w={260} h={28} mb={8} />
          <Bar w={160} h={14} />
        </div>
      </div>
      <div className="card" style={{ padding: 16, marginTop: 18 }}>
        <Bar w={140} h={16} mb={20} />
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} style={{ display: "flex", gap: 16, marginBottom: 14 }}>
            <Bar w={120} h={16} />
            <Bar w={200} h={16} />
          </div>
        ))}
      </div>
      <div className="card" style={{ padding: 16, marginTop: 18 }}>
        <Bar w={100} h={16} mb={20} />
        <div style={{ display: "flex", gap: 16, marginBottom: 14 }}>
          <Bar w={120} h={16} />
          <Bar w={160} h={16} />
        </div>
        <div style={{ display: "flex", gap: 16 }}>
          <Bar w={120} h={16} />
          <Bar w={160} h={16} />
        </div>
      </div>
    </div>
  );
}
