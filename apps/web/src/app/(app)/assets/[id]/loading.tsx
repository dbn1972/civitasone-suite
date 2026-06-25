export default function Loading() {
  return (
    <div className="animate-pulse" style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <div style={{ height: 14, width: 120, borderRadius: 6, background: "var(--line, #e2e8f0)" }} />
      <div style={{ height: 32, width: 360, borderRadius: 8, background: "var(--line, #e2e8f0)" }} />
      <div className="grid g-main" style={{ alignItems: "start" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div style={{ height: 220, borderRadius: 12, background: "var(--line, #e2e8f0)" }} />
          <div style={{ height: 260, borderRadius: 12, background: "var(--line, #e2e8f0)" }} />
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div style={{ height: 200, borderRadius: 12, background: "var(--line, #e2e8f0)" }} />
        </div>
      </div>
    </div>
  );
}
