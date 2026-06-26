export default function LegalCaseDetailLoading() {
  return (
    <main className="wrap">
      <div className="animate-pulse" aria-busy="true" aria-label="Loading case details">
        {/* Breadcrumb skeleton */}
        <div style={{ height: 16, width: 220, borderRadius: 4, background: "#e2e8f0", marginBottom: 12 }} />
        {/* Page header skeleton */}
        <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 24 }}>
          <div style={{ height: 32, width: 320, borderRadius: 6, background: "#e2e8f0" }} />
          <div style={{ height: 32, width: 120, borderRadius: 6, background: "#e2e8f0", marginLeft: "auto" }} />
        </div>
        {/* Two-column grid */}
        <div className="grid g-main" style={{ alignItems: "start", gap: 18 }}>
          {/* Left column */}
          <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
            <div style={{ height: 280, borderRadius: 10, background: "#e2e8f0" }} />
            <div style={{ height: 160, borderRadius: 10, background: "#e2e8f0" }} />
            <div style={{ height: 120, borderRadius: 10, background: "#e2e8f0" }} />
          </div>
          {/* Right column */}
          <div style={{ height: 200, borderRadius: 10, background: "#e2e8f0" }} />
        </div>
      </div>
    </main>
  );
}
