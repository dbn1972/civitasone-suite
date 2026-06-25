export default function Loading() {
  return (
    <div className="animate-pulse" style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <div style={{ height: 14, width: 160, borderRadius: 6, background: "var(--line, #e2e8f0)" }} />
      <div style={{ height: 32, width: 280, borderRadius: 8, background: "var(--line, #e2e8f0)" }} />
      <div className="grid g-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} style={{ height: 96, borderRadius: 12, background: "var(--line, #e2e8f0)" }} />
        ))}
      </div>
      <div style={{ height: 320, borderRadius: 12, background: "var(--line, #e2e8f0)" }} />
    </div>
  );
}
