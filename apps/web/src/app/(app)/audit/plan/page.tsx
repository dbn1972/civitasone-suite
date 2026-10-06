import Link from "next/link";
import { PageHeader, StatCard, Card, RefreshErrorState } from "../../../_components/ds";
import { toHumanError } from "@/lib/messages";
import { getAuditPlan } from "../../../_data/loaders";
import { PlanTable } from "./PlanTable";
import { PlanAuditButton } from "./PlanAuditButton";

export default async function AuditPlanPage() {
  const { data: items, source } = await getAuditPlan();
  const errored = source === "error";

  const total = errored ? null : items.length;
  const completed = errored ? null : items.filter((i) => i.status === "completed").length;
  const inProgress = errored ? null : items.filter((i) => i.status === "in_progress").length;
  // GAP-AUDIT-PLAN-02: 'Risk-based' tile was a hard 'up/coverage' badge that
  // misread as audit-universe coverage; it is really the non-routine share.
  const riskBased = errored || items.length === 0
    ? null
    : Math.round(((items.length - items.filter((i) => i.type === "routine").length) / items.length) * 100);

  return (
    <div className="wrap">
      <nav aria-label="Breadcrumb" style={{ fontSize: 13, color: "var(--ink2)", marginBottom: 4 }}>
        <Link href="/audit/dashboard" className="lnk">Audit</Link>
        <span aria-hidden="true" style={{ margin: "0 7px", color: "var(--line)" }}>/</span>
        <span aria-current="page">Audit Plan</span>
      </nav>
      <PageHeader
        title="Internal Audit Planning"
        subtitle="Risk-based annual audit plan & universe."
        actions={<PlanAuditButton />}
      />
      <div className="grid g-4" style={{ marginBottom: 18 }}>
        <StatCard icon="🗓️" iconBg="var(--badbg)" label="Planned Audits" value={total ?? "—"} />
        <StatCard icon="✅" iconBg="var(--goodbg)" label="Completed" value={completed ?? "—"} />
        <StatCard icon="🔄" iconBg="var(--warnbg)" label="In Progress" value={inProgress ?? "—"} />
        <StatCard icon="🎯" iconBg="var(--infobg)" label="Non-routine share" value={riskBased === null ? "—" : `${riskBased}%`} />
      </div>
      {errored ? (
        <Card title="Audit plan">
          <div className="pad">
            <RefreshErrorState error={toHumanError("load", { area: "audit plan" })} backHref="/audit" />
          </div>
        </Card>
      ) : (
        <PlanTable items={items} />
      )}
    </div>
  );
}
