import { DataSourceBadge } from "../../../../_components/DataSourceBadge";
import { PageHeader, StatusPill, EmptyState } from "../../../../_components/ds";
import { getDealById } from "../../../../_data/loaders";
import { formatMoney, formatIndianDate } from "@/lib/formatters";
import { DealDetailActions } from "./DealDetailActions";

export default async function Page({ params }: { params: { id: string } }) {
  const { data: deal, source } = await getDealById(params.id);

  if (!deal) {
    return (
      <>
        <PageHeader title="Deal Detail" back="/crm/deals" />
        {source === "error" && <DataSourceBadge source={source} />}
        <EmptyState icon="🎯" title="Deal not found" message="This deal does not exist or has been removed." />
      </>
    );
  }

  const STAGES = ["Lead", "Proposal", "Negotiation", "Won", "Lost"] as const;
  const currentIdx = STAGES.indexOf(deal.stage as typeof STAGES[number]);

  return (
    <>
      <PageHeader
        title={`Deal ${deal.dealName}`}
        subtitle="Stakeholder Engagement System: leads, deals and pipeline."
        back="/crm/deals"
        actions={
          <DealDetailActions
            dealId={deal.id}
            dealName={deal.dealName}
            {...(deal.contactId ? { contactId: deal.contactId } : {})}
            status={deal.status}
          />
        }
      />
      {source === "error" && <DataSourceBadge source={source} />}
      <div className="grid g-main" style={{ alignItems: "start" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div className="card">
            <div className="card-h"><h3>Deal Details</h3></div>
            <div className="fields">
              <div className="fld"><div className="l">Account</div><div className="v">{deal.contactName ?? "—"}</div></div>
              <div className="fld"><div className="l">Value</div><div className="v">{formatMoney(deal.amount)}</div></div>
              <div className="fld"><div className="l">Stage</div><div className="v"><StatusPill status={deal.stage} label={deal.stage.replace(/_/g, " ")} /></div></div>
              <div className="fld"><div className="l">Status</div><div className="v"><StatusPill status={deal.status} /></div></div>
              <div className="fld"><div className="l">Owner</div><div className="v">{deal.owner}</div></div>
              <div className="fld"><div className="l">Close Date</div><div className="v">{deal.closeDate ? formatIndianDate(deal.closeDate) : "—"}</div></div>
              <div className="fld"><div className="l">Probability</div><div className="v">{deal.probability}%</div></div>
            </div>
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div className="card">
            <div className="card-h"><h3>Workflow</h3></div>
            <div className="pad">
              <ul className="tl">
                {STAGES.map((stage, i) => (
                  <li key={stage} className={i < currentIdx ? "done" : i === currentIdx ? "cur" : "todo"} aria-current={i === currentIdx ? "step" : undefined}>
                    <div className="t">{stage.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase())}</div>
                  </li>
                ))}
              </ul>
            </div>
          </div>
          <div className="card">
            <div className="card-h"><h3>Parties</h3></div>
            <div className="fields">
              <div className="fld"><div className="l">Account</div><div className="v">{deal.contactName ?? "—"}</div></div>
              <div className="fld"><div className="l">Owner</div><div className="v">{deal.owner}</div></div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
