import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { PageHeader } from "../../../_components/ds";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { getCatalogueServices } from "../../../_data/citizenPartials";

/** SVC-081 — Government service catalogue (versioned, published services). */
export default async function CataloguePage() {
  const t = await getTranslations("citizenCatalogue");
  const { data: services, source } = await getCatalogueServices();

  return (
    <>
      <PageHeader
        title={t("pageTitle")}
        subtitle={t("pageSubtitle")}
        actions={source === "error" ? <DataSourceBadge source={source} /> : null}
      />

      <div className="card">
        <div className="pad" style={{ borderBottom: "1px solid var(--line)", display: "flex", justifyContent: "space-between" }}>
          <strong>{t("listTitle")}</strong>
          <span style={{ fontSize: 12, color: "var(--muted)" }}>{services.length} available</span>
        </div>
        {services.length === 0 ? (
          <div className="pad" style={{ color: "var(--muted)" }}>{t("empty")}</div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ textAlign: "left", fontSize: 12, color: "var(--muted)" }}>
                  <th scope="col" style={{ padding: 8 }}>{t("colService")}</th>
                  <th scope="col" style={{ padding: 8 }}>{t("colOwner")}</th>
                  <th scope="col" style={{ padding: 8 }}>{t("colVersion")}</th>
                  <th scope="col" style={{ padding: 8 }}>{t("colChannels")}</th>
                  <th scope="col" style={{ padding: 8 }}>{t("colDocuments")}</th>
                </tr>
              </thead>
              <tbody>
                {services.map((s) => (
                  <tr key={s.id} style={{ borderTop: "1px solid var(--line)" }}>
                    <td style={{ padding: 8 }}>
                      <Link href={`/citizen/services/${encodeURIComponent(s.serviceKey)}`} style={{ fontWeight: 600 }}>
                        {s.name}
                      </Link>
                      <br /><span style={{ fontSize: 11, color: "var(--muted)" }}>{s.serviceKey}</span>
                    </td>
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
