import { PageHeader } from "@/app/_components/ds";

// COMP-004: this page used to render 6 hardcoded MOCK_SERVICES — and, worse,
// silently fell back to that fake list whenever the (also fake) GET
// /v1/admin/discovery/services request failed, so a real network error was
// indistinguishable from "here is the real service registry." There is no
// backend anywhere in this platform for an internal service-discovery
// registry or health scanner (grepped admin-service and every other
// service's routes — nothing) — this is an honest placeholder rather than
// a wired page, per COMP-004's fix guidance: "wire to real APIs, or convert
// to explicit placeholders that cannot be mistaken for data." The scan form
// is disabled rather than left to silently 404 against an endpoint that
// doesn't exist.
export default function AdminDiscoveryPage() {
  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="Service Discovery"
        subtitle="Scan and monitor all internal and external services connected to the platform."
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
        <strong>This feature has no backend yet.</strong> There is no service registry or health-scanner
        implementation anywhere in the platform to back a "Registered Services" list or a "Run Scan" action.
        Rather than show a fabricated service list or a scan button that would only ever fail, this page is
        left as an honest placeholder until that backend is built.
      </div>

      <div className="card" style={{ marginBottom: 18 }}>
        <div className="card-h"><h3>Initiate Scan</h3></div>
        <div style={{ padding: 20 }}>
          <p style={{ margin: "0 0 14px", fontSize: 13.5, color: "var(--ink3)" }}>
            Scanning a service endpoint requires a real discovery backend, which doesn&apos;t exist yet.
          </p>
          <button
            type="button"
            disabled
            title="Service discovery has no backend yet"
            aria-disabled="true"
            style={{
              padding: "9px 22px",
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
            Run Scan
          </button>
        </div>
      </div>

      <div className="card">
        <div className="card-h">
          <h3>Registered Services</h3>
        </div>
        <div style={{ padding: 32, textAlign: "center", color: "var(--ink3)" }}>
          <p style={{ margin: "0 0 4px", fontSize: 14 }}>No service registry available.</p>
          <p style={{ margin: 0, fontSize: 12.5 }}>Nothing is shown here because nothing real can be loaded yet.</p>
        </div>
      </div>
    </main>
  );
}
