import { PageHeader } from "../../../_components/ds";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { getCatalogueServices } from "../../../_data/citizenPartials";

/** SVC-081 — Government service catalogue (versioned, published services). */
export default async function CataloguePage() {
  const { data: services, source } = await getCatalogueServices();

  return (
    <>
      <PageHeader
        title="Service Catalogue"
        subtitle="Published, versioned service definitions — owner, channels, required documents and SLA."
        actions={source === "error" ? <DataSourceBadge source={source} /> : null}
      />

      <div className="card">
        <div className="pad" style={{ borderBottom: "1px solid var(--line)", display: "flex", justifyContent: "space-between" }}>
          <strong>Published services</strong>
          <span style={{ fontSize: 12, color: "var(--muted)" }}>{services.length} available</span>
        </div>
        {services.length === 0 ? (
          <div className="pad" style={{ color: "var(--muted)" }}>No published services yet.</div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ textAlign: "left", fontSize: 12, color: "var(--muted)" }}>
                  <th style={{ padding: 8 }}>Service</th>
                  <th style={{ padding: 8 }}>Owner</th>
                  <th style={{ padding: 8 }}>Version</th>
                  <th style={{ padding: 8 }}>Channels</th>
                  <th style={{ padding: 8 }}>Documents</th>
                  <th style={{ padding: 8 }}>SLA</th>
                </tr>
              </thead>
              <tbody>
                {services.map((s) => (
                  <tr key={s.id} style={{ borderTop: "1px solid var(--line)" }}>
                    <td style={{ padding: 8 }}>{s.name}<br /><span style={{ fontSize: 11, color: "var(--muted)" }}>{s.serviceKey}</span></td>
                    <td style={{ padding: 8 }}>{s.ownerDepartment || "—"}</td>
                    <td style={{ padding: 8 }}>v{s.version}</td>
                    <td style={{ padding: 8 }}>{s.channels.join(", ") || "—"}</td>
                    <td style={{ padding: 8 }}>{s.requiredDocumentCount}</td>
                    <td style={{ padding: 8 }}>{s.slaDays != null ? `${s.slaDays}d` : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
