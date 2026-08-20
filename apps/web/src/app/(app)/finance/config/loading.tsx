export default function Loading() {
  return (
    <main className="page-main wrap" style={{ animation: "pulse 2s cubic-bezier(0.4,0,0.6,1) infinite" }}>
      <div style={{ marginBottom: 24 }}>
        <div style={{ height: 16, width: 160, borderRadius: 4, background: "#e5e7eb", marginBottom: 8 }} />
        <div style={{ height: 32, width: 256, borderRadius: 4, background: "#e5e7eb" }} />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2,1fr)", gap: 16 }}>
        {[0, 1].map((i) => (<div key={i} style={{ height: 96, borderRadius: 12, background: "#e5e7eb" }} />))}
      </div>
      <div style={{ height: 160, borderRadius: 12, background: "#e5e7eb", marginTop: 18 }} />
      <div style={{ height: 160, borderRadius: 12, background: "#e5e7eb", marginTop: 18 }} />
      <div style={{ height: 120, borderRadius: 12, background: "#e5e7eb", marginTop: 18 }} />
    </main>
  );
}
