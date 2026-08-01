export default function Loading() {
  return (
    <div className="animate-pulse" style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <div style={{ height: 14, width: 120, borderRadius: 6, background: "var(--line, #e2e8f0)" }} />
      <div style={{ height: 32, width: 420, borderRadius: 8, background: "var(--line, #e2e8f0)" }} />
      <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
        <div style={{ height: 220, borderRadius: 12, background: "var(--line, #e2e8f0)" }} />
        <div style={{ height: 220, borderRadius: 12, background: "var(--line, #e2e8f0)" }} />
        <div style={{ height: 220, borderRadius: 12, background: "var(--line, #e2e8f0)" }} />
      </div>
    </div>
  );
}
