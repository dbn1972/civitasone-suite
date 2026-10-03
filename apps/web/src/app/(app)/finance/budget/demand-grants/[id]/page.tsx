import { PageHeader, StatGrid, StatCard, StatusPill, Card, EmptyState, LoadErrorState } from "@/app/_components/ds";
import { formatMoney, humanizeStatus } from "@/lib/formatters";
import { getSessionRoles } from "@/lib/auth/roleGuard";
import { canWrite } from "@/lib/finance/writeRoles";
import { getDemandGrantById, getMajorHeadOptions } from "../demandDetail";
import { DemandLinesTable } from "../DemandLinesTable";
import { DemandLinesEditor } from "../DemandLinesEditor";

const DEMAND_WRITE_ROLES = ["finance_officer", "finance_admin", "super_admin"] as const;

/**
 * Demand-for-grants detail (GAP-FINANCE-BUDGET-DEMAND-GRANTS-04): the demand and its head-wise
 * (per major head) lines. Only a real 404 means "not found"; any other failed load is an outage
 * the user can retry, and a 403 is a permission decision.
 */
export default async function DemandGrantDetailPage({ params }: { params: { id: string } }) {
  const result = await getDemandGrantById(params.id);
  const { data: demand, source, status } = result;

  if (source === "error" && status !== 404) {
    return (
      <div className="page-main wrap" aria-labelledby="page-heading">
        <PageHeader title="Demand Detail" back="/finance/budget/demand-grants" />
        <LoadErrorState result={result} area="demand for grants" backHref="/finance/budget/demand-grants" />
      </div>
    );
  }
  if (!demand) {
    return (
      <div className="page-main wrap" aria-labelledby="page-heading">
        <PageHeader title="Demand Detail" back="/finance/budget/demand-grants" />
        <EmptyState icon="🏛️" title="Demand not found" message="This demand may have been removed or the ID is invalid." />
      </div>
    );
  }

  const editable = demand.status === "draft" && canWrite(getSessionRoles(), DEMAND_WRITE_ROLES);
  const heads = editable ? await getMajorHeadOptions() : null;

  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader title={`Demand ${demand.demandNo}`} subtitle={demand.service || undefined} back="/finance/budget/demand-grants" />
      <StatGrid>
        <StatCard icon="₹" iconBg="#ecfdf3" label="Demand amount" value={formatMoney(demand.amountMinor)} />
        <StatCard icon="🧮" iconBg="#eff6ff" label="Head-wise total" value={formatMoney(demand.linesTotalMinor)} />
        <StatCard icon="🗳️" iconBg="#fffaeb" label="Class" value={humanizeStatus(demand.class)} />
        <StatCard icon="📌" iconBg="#e7edfd" label="Status" value={humanizeStatus(demand.status)} />
      </StatGrid>

      <Card title="Demand Details" padding>
        <div className="fields">
          <div className="field"><span className="label">Demand No</span><span className="mono">{demand.demandNo}</span></div>
          <div className="field"><span className="label">Service</span><span>{demand.service || "—"}</span></div>
          <div className="field"><span className="label">Status</span><StatusPill status={demand.status} /></div>
        </div>
      </Card>

      <Card title="Head-wise lines">
        {demand.lines.length > 0 && !demand.linesReconciled ? (
          <p role="alert" style={{ padding: "8px 16px", color: "#b91c1c", fontSize: 13 }}>
            The head-wise lines total {formatMoney(demand.linesTotalMinor)}, which differs from the demand amount of {formatMoney(demand.amountMinor)}.
          </p>
        ) : null}
        <DemandLinesTable lines={demand.lines} />
      </Card>

      {editable ? (
        <Card title="Edit head-wise lines" padding>
          {heads && heads.source === "error" ? (
            <LoadErrorState result={heads} area="major heads" backHref="/finance/budget/demand-grants" />
          ) : (
            <DemandLinesEditor demandId={demand.id} demandAmountMinor={demand.amountMinor} lines={demand.lines} heads={heads?.data ?? []} />
          )}
        </Card>
      ) : null}
    </div>
  );
}
