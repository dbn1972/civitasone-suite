import { DataSourceBadge } from "../../../../_components/DataSourceBadge";
import Link from "next/link";
import { PageHeader, StatusPill, EmptyState } from "../../../../_components/ds";
import { RefreshErrorState } from "../../../../_components/ds/RefreshErrorState";
import { getDealById } from "../../../../_data/loaders";
import { formatMoney, formatIndianDate } from "@/lib/formatters";
import { getTranslations } from "next-intl/server";
import { toHumanError } from "@/lib/messages";
import { DealDetailActions } from "./DealDetailActions";
import { getSessionRoles, hasAnyRole, CRM_OPPORTUNITY_CLOSE_ROLES } from "@/lib/auth/roleGuard";

export default async function Page({ params }: { params: { id: string } }) {
  const { data: deal, source, status } = await getDealById(params.id);
  const tNf = await getTranslations("crm.dealDetail");

  if (!deal) {
    // GAP-CRM-DEALS-DETAIL-02: distinguish a genuinely-missing deal from an
    // outage. getDealById returns source:"error" for BOTH a real 404 (and a
    // 200 whose body carried no such deal, mapped to null) AND a transient
    // failure (5xx, 401, network). Only 404 / 200-null read as "removed";
    // everything else is a retriable load failure, so we must not tell the
    // clerk the deal "does not exist" when the real cause is the service
    // being down (that reads as an irreversible deletion). Mirrors the
    // RefreshErrorState pattern used on rti / service-requests detail pages.
    const notFound = source !== "error" || status === 404 || status === 200;
    if (!notFound) {
      const tErr = await getTranslations("crmDealDetail");
      return (
        <>
          <PageHeader title={tErr("detailTitle")} back="/crm/deals" />
          <RefreshErrorState
            error={toHumanError("load", { area: tErr("loadArea") })}
            backHref="/crm/deals"
            source={{ status, area: tErr("loadArea") }}
          />
        </>
      );
    }
    return (
      <>
        <PageHeader title={tNf("title")} back="/crm/deals" />
        <EmptyState icon="🎯" title={tNf("notFoundTitle")} message={tNf("notFoundMessage")} />
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
  // GAP-CRM-DEALS-DETAIL-07: 'qualification' is a real open stage in the deal
  // vocabulary (apiMappers.DEAL_STAGES keeps it as-is) but was missing from this
  // open path, so a qualification deal fell back to the index-0 'Prospecting'
  // guard — the current marker landed on the wrong step. Include it between
  // prospecting and proposal so such a deal shows 'Qualification' as current.
  const OPEN_PATH = ["prospecting", "qualification", "proposal", "negotiation"] as const;
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
        title={`Engagement ${deal.dealName}`}
        subtitle="Stakeholder Engagement System: leads, deals and pipeline."
        back="/crm/deals"
        actions={
          <DealDetailActions
            dealId={deal.id}
            dealName={deal.dealName}
            {...(deal.contactId ? { contactId: deal.contactId } : {})}
            status={deal.status}
            canClose={hasAnyRole(getSessionRoles(), CRM_OPPORTUNITY_CLOSE_ROLES)}
          />
        }
      />
      {source === "error" && <DataSourceBadge source={source} />}
      <div className="grid g-main" style={{ alignItems: "start" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div className="card">
            <div className="card-h"><h3>Engagement Details</h3></div>
            <div className="fields">
              {/* GAP-CRM-DEALS-DETAIL-05: the value is contactName ?? company (a
                  person OR an organisation), so the label is "Contact /
                  Organisation", not "Account". When a contactId is known the
                  name links to the contact record; otherwise it is plain text. */}
              <div className="fld">
                <div className="l">Contact / Organisation</div>
                <div className="v">
                  {deal.contactId ? (
                    <Link href={`/crm/contacts/${deal.contactId}`}>{deal.contactName ?? "—"}</Link>
                  ) : (
                    deal.contactName ?? "—"
                  )}
                </div>
              </div>
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
                        <span aria-hidden="true" style={{ marginInlineStart: 6, fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.4, color: step.cueTone === "lost" ? "var(--bad)" : "var(--good)" }}>
                          {step.cue}
                        </span>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          </div>
          {/* GAP-CRM-DEALS-DETAIL-05: the former "Parties" card duplicated the
              Account and Owner already shown in Engagement Details (neither
              linked), so it was removed. The contact/organisation link now lives
              once, in Engagement Details above. */}
        </div>
      </div>
    </>
  );
}
