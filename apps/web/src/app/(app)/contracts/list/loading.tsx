import type { CSSProperties } from "react";

const shimmer: CSSProperties = {
  background: "linear-gradient(90deg,var(--panel) 25%,var(--line) 37%,var(--panel) 63%)",
  backgroundSize: "400% 100%",
  animation: "contractsListShimmer 1.4s ease infinite",
  borderRadius: 8,
};

function Bar({ w, h, mb }: { w: number | string; h: number; mb?: number }) {
  return <div aria-hidden style={{ ...shimmer, width: w, height: h, marginBottom: mb, borderRadius: 8 }} />;
}

export default function ContractsListLoading() {
  return (
    <div className="wrap" aria-busy="true" aria-label="Loading contracts list">
      <style>{"@keyframes contractsListShimmer{0%{background-position:100% 0}100%{background-position:0 0}}"}</style>
      <div className="ph">
        <div>
          <Bar w={220} h={28} mb={8} />
          <Bar w={320} h={14} />
        </div>
      </div>
      <div className="card" style={{ padding: 16, marginTop: 18 }}>
        <Bar w={180} h={16} mb={16} />
        {Array.from({ length: 6 }).map((_, i) => (
          <Bar key={i} w="100%" h={18} mb={12} />
        ))}
      </div>
    </div>
  );
}
