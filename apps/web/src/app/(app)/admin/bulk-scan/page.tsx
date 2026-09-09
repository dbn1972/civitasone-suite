import { PageHeader } from "@/app/_components/ds";

// COMP-004: this page used to render 3 hardcoded MOCK_JOBS as "Recent Jobs"
// with no fetch attempt at all, alongside a "New Scan Job" form that posted
// to a plausible-looking POST /v1/admin/bulk-scan. There is no bulk WCAG/
// CWV/GIGW domain-scan backend anywhere in this platform (grepped
// admin-service and every other service — nothing registers this route or
// anything like it) — this is an honest placeholder rather than a wired
// page, per COMP-004's fix guidance: "wire to real APIs, or convert to
// explicit placeholders that cannot be mistaken for data." The submit
// button is disabled rather than left to silently 404 against an endpoint
// that doesn't exist.
export default function AdminBulkScanPage() {
  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="Bulk Scan"
        subtitle="Queue a WCAG/CWV/accessibility scan across multiple government domains at once."
        back="/admin"
      />

      <div
        role="status"
        style={{
          background: "#fffbeb",
          border: "1px solid #fde68a",
          color: "#92400e",
          borderRadius: 10,
          padding: "14px 18px",
          marginBottom: 18,
          fontSize: 13.5,
          lineHeight: 1.6,
        }}
      >
        <strong>This feature has no backend yet.</strong> There is no bulk-scan job queue implementation
        anywhere in the platform. Rather than show a fabricated job history or a "Queue" button that would
        only ever fail, this page is left as an honest placeholder until that backend is built.
      </div>

      <div className="card" style={{ marginBottom: 20 }}>
        <div className="card-h"><h3>New Scan Job</h3></div>
        <div style={{ padding: 20 }}>
          <p style={{ margin: "0 0 14px", fontSize: 13.5, color: "var(--ink3)" }}>
            Queueing a bulk scan requires a real scan-job backend, which doesn&apos;t exist yet.
          </p>
          <button
            type="button"
            disabled
            title="Bulk scan job queueing has no backend yet"
            aria-disabled="true"
            style={{
              padding: "10px 28px",
              borderRadius: 8,
              background: "#9ca3af",
              color: "#fff",
              fontWeight: 600,
              border: "none",
              cursor: "not-allowed",
              fontSize: 14,
              opacity: 0.7,
            }}
          >
            Queue Bulk Scan
          </button>
        </div>
      </div>

      <div className="card">
        <div className="card-h"><h3>Recent Jobs</h3></div>
        <div style={{ padding: 32, textAlign: "center", color: "var(--ink3)" }}>
          <p style={{ margin: "0 0 4px", fontSize: 14 }}>No job history available.</p>
          <p style={{ margin: 0, fontSize: 12.5 }}>Nothing is shown here because nothing real can be loaded yet.</p>
        </div>
      </div>
    </main>
  );
}
