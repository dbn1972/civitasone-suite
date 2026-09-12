import { PageHeader, RefreshErrorState } from "../../../_components/ds";
import { getEligibilityRuleSets } from "../../../_data/citizenGaps";
import { EligibilityCheck } from "./EligibilityCheck";
import { useResource } from "../../../_data/useResource";
import { toHumanError } from "@/lib/messages";

/** SVC-083 — Eligibility & entitlement determination. */
export default async function EligibilityPage() {
  const result = await getEligibilityRuleSets();
  const { data: ruleSets } = result;
  const resource = useResource(result);
  const errored = resource.status === "error";
  const published = errored ? null : ruleSets.filter((r) => r.status === "published").length;

  return (
    <>
      <PageHeader
        title="Eligibility & Entitlement"
        subtitle="Versioned rule sets (maker-checker publish) and applicant eligibility checks."
      />

      <EligibilityCheck />

      <div className="card" style={{ marginTop: 16 }}>
        <div className="pad" style={{ borderBottom: "1px solid var(--line)", display: "flex", justifyContent: "space-between" }}>
          <strong>Rule sets</strong>
          <span style={{ fontSize: 12, color: "var(--muted)" }}>{published ?? "—"} published</span>
        </div>
        {errored ? (
          <div className="pad">
            <RefreshErrorState error={toHumanError("load", { area: "eligibility rule sets" })} />
          </div>
        ) : ruleSets.length === 0 ? (
          <div className="pad" style={{ color: "var(--muted)" }}>No rule sets defined yet.</div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ textAlign: "left", fontSize: 12, color: "var(--muted)" }}>
                  <th scope="col" style={{ padding: 8 }}>Name</th>
                  <th scope="col" style={{ padding: 8 }}>Version</th>
                  <th scope="col" style={{ padding: 8 }}>Rules</th>
                  <th scope="col" style={{ padding: 8 }}>Status</th>
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
