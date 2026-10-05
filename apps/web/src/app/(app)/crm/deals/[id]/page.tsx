import { DataSourceBadge } from "../../../../_components/DataSourceBadge";
import { PageHeader, StatusPill, EmptyState } from "../../../../_components/ds";
import { getDealById } from "../../../../_data/loaders";
import { formatMoney, formatIndianDate } from "@/lib/formatters";
import { getTranslations } from "next-intl/server";
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

  // The workflow is driven by deal.status (won | lost | open/active), NOT by a fixed
  // index into a vocabulary that lists BOTH terminal stages. The previous version used
  // a static [...,'closed_won','closed_lost'] list and derived currentIdx from the
  // normalized stage: a lost deal (currentIdx 4) rendered 'Closed Won' (i=3) as "done"
  // and 'Closed Lost' as current — i.e. it looked like the deal had passed THROUGH a win
  // on the way to a loss, which is dangerously misleading in an approvals context.
  //
  // Instead, build the open path then exactly ONE terminal step reflecting the real
  // outcome: 'Closed Won' only when won, 'Closed Lost' only when lost, otherwise a
  // neutral 'Closed' todo. A non-colour text cue ("Lost"/"Won") is added to the terminal
  // step so the state is conveyed without relying on colour alone (WCAG 1.4.1).
  const t = await getTranslations("crmDealDetail");
  const OPEN_PATH = ["prospecting", "proposal", "negotiation"] as const;
  const isWon = deal.status === "won";
  const isLost = deal.status === "lost";
  const terminal: { key: string; label: string; cue?: string; cueTone?: "won" | "lost" } = isWon
    ? { key: "closed_won", label: t("steps.closedWon"), cue: t("cues.won"), cueTone: "won" }
    : isLost
      ? { key: "closed_lost", label: t("steps.closedLost"), cue: t("cues.lost"), cueTone: "lost" }
      : { key: "closed", label: t("steps.closed") };
  const steps: Array<{ key: string; label: string; cue?: string; cueTone?: "won" | "lost" }> = [
    ...OPEN_PATH.map((s) => ({ key: s, label: t(`steps.${s}`) })),
    terminal,
  ];

  // When the deal is closed (won/lost), every open-path step is complete and the
  // terminal step is current. When still open, locate the current open stage by the
  // normalized deal.stage; the terminal step is a future "todo".
  const closed = isWon || isLost;
  const openIdx = OPEN_PATH.indexOf(deal.stage as typeof OPEN_PATH[number]);
  const currentIdx = closed ? steps.length - 1 : openIdx >= 0 ? openIdx : 0;

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
                {steps.map((step, i) => (
                  <li key={step.key} className={i < currentIdx ? "done" : i === currentIdx ? "cur" : "todo"} aria-current={i === currentIdx ? "step" : undefined}>
                    <div className="t">
                      {step.label}
                      {step.cue ? <span className="sr-only"> — {step.cue}</span> : null}
                      {step.cue ? (
                        <span aria-hidden="true" style={{ marginInlineStart: 6, fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.4, color: step.cueTone === "lost" ? "#b42318" : "#047857" }}>
                          {step.cue}
                        </span>
                      ) : null}
                    </div>
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
