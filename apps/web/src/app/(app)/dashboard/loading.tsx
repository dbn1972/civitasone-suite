const SKEL: React.CSSProperties = {
  background: "linear-gradient(90deg, var(--line2) 25%, var(--line) 37%, var(--line2) 63%)",
  backgroundSize: "400% 100%",
  animation: "dashSkel 1.4s ease infinite",
};

export default function DashboardLoading() {
  return (
    <div aria-busy="true" aria-live="polite">
      <style>{"@keyframes dashSkel{0%{background-position:100% 50%}100%{background-position:0 50%}}"}</style>
      <span className="sr-only">Loading dashboard…</span>
      <div className="ph">
        <div>
          <div style={{ ...SKEL, height: 28, width: 240, borderRadius: 8 }} />
          <div style={{ ...SKEL, height: 16, width: 420, borderRadius: 6, marginTop: 10 }} />
        </div>
      </div>
      <div className="grid g-2" style={{ marginBottom: 24 }}>
        {Array.from({ length: 2 }).map((_, i) => (
          <div key={i} className="card">
            <div className="card-h">
              <div style={{ ...SKEL, height: 18, width: 200, borderRadius: 6 }} />
            </div>
            <div className="pad">
              <div className="grid g-2">
                {Array.from({ length: 4 }).map((_, j) => (
                  <div key={j} className="stat">
                    <div style={{ ...SKEL, height: 16, width: "70%", borderRadius: 6 }} />
                    <div style={{ ...SKEL, height: 12, width: "90%", borderRadius: 6, marginTop: 8 }} />
                  </div>
                ))}
              </div>
            </div>
          </div>
        ))}
      </div>
      <div className="grid g-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="stat">
            <div className="top">
              <div />
              <div style={{ ...SKEL, width: 42, height: 42, borderRadius: 11 }} />
            </div>
            <div style={{ ...SKEL, height: 14, width: "85%", borderRadius: 6, marginTop: 16 }} />
            <div style={{ ...SKEL, height: 18, width: "55%", borderRadius: 6, marginTop: 8 }} />
          </div>
        ))}
      </div>
    </div>
  );
}
