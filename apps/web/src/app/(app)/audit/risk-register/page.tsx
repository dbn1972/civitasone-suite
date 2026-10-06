import Link from "next/link";
import { PageHeader, StatCard, Card, RefreshErrorState } from "../../../_components/ds";
import { getRiskRegister } from "../../../_data/loaders";
import { toHumanError } from "@/lib/messages";
import { band } from "@/lib/audit/riskScoring";
import { RiskTable } from "./RiskTable";
import { AddRiskButton } from "./AddRiskButton";

export default async function RiskRegisterPage() {
  const { data: items, source } = await getRiskRegister();
  const errored = source === "error";

  const total = errored ? null : items.length;
  // GAP-AUDIT-RISK-REGISTER-01/02: share the band() thresholds with the table
  // and the dialog, and keep the three band tiles as pure rating counts so
  // High + Medium + Low === Total Risks (no status/rating conflation).
  const high = errored ? null : items.filter((i) => band(i.riskScore) === "high").length;
  const medium = errored ? null : items.filter((i) => band(i.riskScore) === "medium").length;
  const low = errored ? null : items.filter((i) => band(i.riskScore) === "low").length;

  return (
    <div className="wrap">
      <nav aria-label="Breadcrumb" style={{ fontSize: 13, color: "var(--ink2)", marginBottom: 4 }}>
        <Link href="/audit/dashboard" className="lnk">Audit</Link>
        <span aria-hidden="true" style={{ margin: "0 7px", color: "var(--line)" }}>/</span>
        <span aria-current="page">Risk Register</span>
      </nav>
      <PageHeader
        title="Enterprise Risk Register"
        subtitle="Identify, score (likelihood × impact) and own risks."
        actions={<AddRiskButton />}
      />
      <div className="grid g-4" style={{ marginBottom: 18 }}>
        <StatCard icon="⚠️" iconBg="var(--badbg)" label="Total Risks" value={total ?? "—"} />
        <StatCard icon="🔴" iconBg="var(--warnbg)" label="High" value={high ?? "—"} />
        <StatCard icon="🟡" iconBg="var(--warnbg)" label="Medium" value={medium ?? "—"} />
        <StatCard icon="🟢" iconBg="var(--goodbg)" label="Low" value={low ?? "—"} />
      </div>
      {errored ? (
        <Card title="Risk register">
          <div className="pad">
            <RefreshErrorState error={toHumanError("load", { area: "risk register" })} backHref="/audit" />
          </div>
        </Card>
      ) : (
        <RiskTable items={items} />
      )}
    </div>
  );
}
