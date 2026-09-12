import { getTranslations } from "next-intl/server";
import { PageHeader } from "../../../_components/ds";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { getAppeals } from "../../../_data/citizenPartials";
import { AppealPanel } from "./AppealPanel";

/** SVC-089 — Appeal, review & revision. */
export default async function AppealsPage() {
  const t = await getTranslations("citizenAppeals");
  const { data: appeals, source } = await getAppeals();

  return (
    <>
      <PageHeader
        title={t("pageTitle")}
        subtitle={t("pageSubtitle")}
        actions={source === "error" ? <DataSourceBadge source={source} /> : null}
      />

      <AppealPanel />

      <div className="card" style={{ marginTop: 16 }}>
        <div className="pad" style={{ borderBottom: "1px solid var(--line)", display: "flex", justifyContent: "space-between" }}>
          <strong>{t("listTitle")}</strong>
          <span style={{ fontSize: 12, color: "var(--muted)" }}>{appeals.length} filed</span>
        </div>
        {appeals.length === 0 ? (
          <div className="pad" style={{ color: "var(--muted)" }}>{t("empty")}</div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ textAlign: "left", fontSize: 12, color: "var(--muted)" }}>
                  <th scope="col" style={{ padding: 8 }}>{t("colType")}</th>
                  <th scope="col" style={{ padding: 8 }}>{t("colGrounds")}</th>
                  <th scope="col" style={{ padding: 8 }}>{t("colDeadline")}</th>
                  <th scope="col" style={{ padding: 8 }}>{t("colStatus")}</th>
                  <th scope="col" style={{ padding: 8 }}>{t("colOutcome")}</th>
                </tr>
              </thead>
              <tbody>
                {appeals.map((a) => (
                  <tr key={a.id} style={{ borderTop: "1px solid var(--line)" }}>
                    <td style={{ padding: 8 }}>{a.appealType}</td>
                    <td style={{ padding: 8, maxWidth: 320, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.grounds}</td>
                    <td style={{ padding: 8 }}>{a.filingDeadline || "—"}</td>
                    <td style={{ padding: 8 }}>{a.status}</td>
                    <td style={{ padding: 8 }}>{a.outcome || "—"}</td>
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
