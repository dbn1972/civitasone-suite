export default function Loading() {
  return (
    <main className="page-main" aria-labelledby="page-heading">
      <div className="ph">
        <div>
          <h1 id="page-heading">Price Books</h1>
        </div>
      </div>
      <div className="animate-pulse" style={{ display: "grid", gap: 16 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
          {[1, 2, 3, 4].map((i) => (
            <div key={i} style={{ height: 80, borderRadius: 12, background: "#f1f5f9" }} />
          ))}
        </div>
        <div style={{ height: 280, borderRadius: 12, background: "#f1f5f9" }} />
      </div>
    </main>
  );
}
