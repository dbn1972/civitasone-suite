import { getTranslations } from "next-intl/server";
import { PageHeader, RefreshErrorState } from "../../../_components/ds";
import { getEligibilityRuleSets } from "../../../_data/citizenGaps";
import { EligibilityCheck } from "./EligibilityCheck";
import { useResource } from "../../../_data/useResource";
import { toHumanError } from "@/lib/messages";

/** SVC-083 — Eligibility & entitlement determination. */
export default async function EligibilityPage() {
  const t = await getTranslations("citizenEligibility");
  const result = await getEligibilityRuleSets();
  const { data: ruleSets } = result;
  const resource = useResource(result);
  const errored = resource.status === "error";
  const published = errored ? null : ruleSets.filter((r) => r.status === "published").length;

  return (
    <>
      <PageHeader
        title={t("pageTitle")}
        subtitle={t("pageSubtitle")}
      />

      <EligibilityCheck />

      <div className="card" style={{ marginTop: 16 }}>
        <div className="pad" style={{ borderBottom: "1px solid var(--line)", display: "flex", justifyContent: "space-between" }}>
          <strong>{t("listTitle")}</strong>
          <span style={{ fontSize: 12, color: "var(--muted)" }}>{published ?? "—"} published</span>
        </div>
        {errored ? (
          <div className="pad">
            <RefreshErrorState error={toHumanError("load", { area: "eligibility rule sets" })} />
          </div>
        ) : ruleSets.length === 0 ? (
          <div className="pad" style={{ color: "var(--muted)" }}>{t("empty")}</div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ textAlign: "left", fontSize: 12, color: "var(--muted)" }}>
                  <th scope="col" style={{ padding: 8 }}>{t("colName")}</th>
                  <th scope="col" style={{ padding: 8 }}>{t("colVersion")}</th>
                  <th scope="col" style={{ padding: 8 }}>{t("colRules")}</th>
                  <th scope="col" style={{ padding: 8 }}>{t("colStatus")}</th>
                </tr>
              </thead>
              <tbody>
                {ruleSets.map((r) => (
                  <tr key={r.id} style={{ borderTop: "1px solid var(--line)" }}>
                    <td style={{ padding: 8 }}>{r.name}</td>
                    <td style={{ padding: 8 }}>v{r.version}</td>
                    <td style={{ padding: 8 }}>{r.ruleCount}</td>
                    <td style={{ padding: 8 }}>{r.status}</td>
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
