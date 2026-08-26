export default function Loading() {
  return (
    <main className="page-main wrap" style={{ animation: "pulse 2s cubic-bezier(0.4,0,0.6,1) infinite" }} role="status" aria-live="polite" aria-label="Loading…">
      <div style={{ marginBottom: 24 }}>
        <div style={{ height: 16, width: 160, borderRadius: 4, background: "#e5e7eb", marginBottom: 8 }} />
        <div style={{ height: 32, width: 256, borderRadius: 4, background: "#e5e7eb" }} />
      </div>
      <div style={{ borderRadius: 12, border: "1px solid #e5e7eb", padding: 24 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2,1fr)", gap: 16, marginBottom: 16 }}>
          {[0, 1, 2, 3].map((i) => (
            <div key={i}>
              <div style={{ height: 12, width: 96, borderRadius: 4, background: "#e5e7eb", marginBottom: 8 }} />
              <div style={{ height: 40, borderRadius: 8, background: "#e5e7eb" }} />
            </div>
          ))}
        </div>
        <div style={{ height: 120, borderRadius: 8, background: "#e5e7eb", marginBottom: 16 }} />
        <div style={{ height: 40, width: 140, borderRadius: 8, background: "#e5e7eb" }} />
      </div>
    </main>
  );
}
