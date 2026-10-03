"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Card } from "../../../../../../_components/ds";
import { StatusPill } from "../../../../../../_components/ds/StatusPill";
import { formatIndianDate, formatMoney } from "@/lib/formatters";

// GAP-RECRUITMENT-DETAIL-APPLICATIONS-APPLICATION-06: fee status, offers and the application PDF,
// each loaded independently with its own error state (a failing fee call must not blank the page).

type Fee = { status: string; amountMinor?: string; exemptionReason?: string; paidAt?: string };
type Offer = { id: string; offerNo?: string | null; status: string; offerVersion?: number; grossCtcMinor?: string | null; joiningDate?: string | null };

// GAP-RECRUITMENT-DETAIL-APPLICATIONS-APPLICATION-06: interview scorecards. The service applies the same
// blind-scoring rule as the per-interview score routes (R-RA-0147), so a blinded interview arrives with no scores.
type Competency = { competency: string; weight?: number; maxScore: number };
export type Scorecard = {
  interviewId: string;
  roundNumber: number;
  roundType: string;
  scheduledDate: string;
  status: string;
  competencies: Competency[];
  cutoffScore: number | null;
  consolidated: boolean;
  panelScore: number | null;
  recommendation: string | null;
  blinded: boolean;
  submittedCount: number;
  panelSize: number;
  scores: Array<{ interviewer: string; scores: Record<string, number>; overallScore: number | null; comments: string | null }>;
};

/** "technical 8/10 - communication 7/10" for one interviewer's awarded scores (competency order from the template). */
export function scoreLine(scores: Record<string, number>, competencies: Competency[]): string {
  return competencies
    .filter((c) => typeof scores[c.competency] === "number")
    .map((c) => `${c.competency} ${scores[c.competency]}/${c.maxScore}`)
    .join(" · ");
}

type Section<T> = { state: "loading" } | { state: "ready"; data: T } | { state: "none" } | { state: "error" };

async function loadJson<T>(url: string): Promise<{ ok: true; body: T } | { ok: false; status: number }> {
  try {
    const res = await fetch(url);
    if (!res.ok) return { ok: false, status: res.status };
    return { ok: true, body: (await res.json()) as T };
  } catch {
    return { ok: false, status: 0 };
  }
}

export function ApplicationExtras({ appId }: { appId: string }) {
  const t = useTranslations("recruitmentApplicationDetail");
  const base = `/api/proxy/v1/hrms/applications/${encodeURIComponent(appId)}`;
  const [fee, setFee] = useState<Section<Fee>>({ state: "loading" });
  const [offers, setOffers] = useState<Section<Offer[]>>({ state: "loading" });
  const [cards, setCards] = useState<Section<Scorecard[]>>({ state: "loading" });

  const loadFee = useCallback(async () => {
    setFee({ state: "loading" });
    const r = await loadJson<{ data?: Fee }>(`${base}/fee`);
    // 404 = no fee has been assessed for this application: a real, empty answer, not a failure.
    if (!r.ok) return setFee(r.status === 404 ? { state: "none" } : { state: "error" });
    setFee(r.body.data ? { state: "ready", data: r.body.data } : { state: "none" });
  }, [base]);

  const loadOffers = useCallback(async () => {
    setOffers({ state: "loading" });
    const r = await loadJson<{ data?: Offer[] }>(`${base}/offers`);
    if (!r.ok) return setOffers({ state: "error" });
    const list = r.body.data;
    setOffers(Array.isArray(list) ? { state: "ready", data: list } : { state: "error" });
  }, [base]);

  const loadCards = useCallback(async () => {
    setCards({ state: "loading" });
    const r = await loadJson<{ data?: Scorecard[] }>(`${base}/scorecards`);
    // 403 = the viewer may not see scorecards (not a failure of the page); anything else non-OK is an error.
    if (!r.ok) return setCards(r.status === 403 ? { state: "none" } : { state: "error" });
    const list = r.body.data;
    setCards(Array.isArray(list) ? { state: "ready", data: list } : { state: "error" });
  }, [base]);

  useEffect(() => {
    void loadFee();
    void loadOffers();
    void loadCards();
  }, [loadFee, loadOffers, loadCards]);

  const muted = { color: "var(--mut)", fontSize: 14, margin: 0 } as const;
  const retry = (onClick: () => void) => (
    <button type="button" className="btn ghost sm" onClick={onClick} style={{ marginInlineStart: 8 }}>{t("retry")}</button>
  );

  return (
    <>
      <Card title={t("feeTitle")}>
        <div style={{ padding: "16px 20px" }}>
          {fee.state === "loading" && <p style={muted} aria-busy="true">{t("sectionLoading")}</p>}
          {fee.state === "error" && <p role="alert" style={muted}>{t("feeLoadError")}{retry(() => void loadFee())}</p>}
          {fee.state === "none" && <p style={muted}>{t("feeNone")}</p>}
          {fee.state === "ready" && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px 24px", fontSize: 14 }}>
              <div><span style={{ color: "var(--mut)", marginInlineEnd: 8 }}>{t("feeStatus")}</span><StatusPill status={fee.data.status} /></div>
              <div><span style={{ color: "var(--mut)", marginInlineEnd: 8 }}>{t("feeAmount")}</span>{formatMoney(fee.data.amountMinor)}</div>
              {fee.data.exemptionReason && <div><span style={{ color: "var(--mut)", marginInlineEnd: 8 }}>{t("feeExemption")}</span>{fee.data.exemptionReason}</div>}
              {fee.data.paidAt && <div><span style={{ color: "var(--mut)", marginInlineEnd: 8 }}>{t("feePaidOn")}</span>{formatIndianDate(fee.data.paidAt)}</div>}
            </div>
          )}
        </div>
      </Card>

      <Card title={t("offersTitle")}>
        <div style={{ padding: "16px 20px" }}>
          {offers.state === "loading" && <p style={muted} aria-busy="true">{t("sectionLoading")}</p>}
          {offers.state === "error" && <p role="alert" style={muted}>{t("offersLoadError")}{retry(() => void loadOffers())}</p>}
          {offers.state === "ready" && offers.data.length === 0 && <p style={muted}>{t("offersNone")}</p>}
          {offers.state === "ready" && offers.data.length > 0 && (
            <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 8, fontSize: 14 }}>
              {offers.data.map((o) => (
                <li key={o.id} style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
                  <code style={{ fontSize: 12 }}>{o.offerNo ?? o.id.slice(0, 8)}</code>
                  <StatusPill status={o.status} />
                  {o.offerVersion != null && <span style={{ color: "var(--mut)" }}>{t("offerVersion", { version: o.offerVersion })}</span>}
                  <span>{t("offerGrossCtc")} {formatMoney(o.grossCtcMinor)}</span>
                  {o.joiningDate && <span style={{ color: "var(--mut)" }}>{t("offerJoining")} {formatIndianDate(o.joiningDate)}</span>}
                </li>
              ))}
            </ul>
          )}
        </div>
      </Card>

      <Card title={t("scorecardsTitle")}>
        <div style={{ padding: "16px 20px", display: "grid", gap: 16 }}>
          {cards.state === "loading" && <p style={muted} aria-busy="true">{t("sectionLoading")}</p>}
          {cards.state === "error" && <p role="alert" style={muted}>{t("scorecardsLoadError")}{retry(() => void loadCards())}</p>}
          {cards.state === "none" && <p style={muted}>{t("scorecardsRestricted")}</p>}
          {cards.state === "ready" && cards.data.length === 0 && <p style={muted}>{t("scorecardsNone")}</p>}
          {cards.state === "ready" && cards.data.map((c) => (
            <section key={c.interviewId} aria-label={t("scorecardRound", { round: c.roundNumber })} style={{ display: "grid", gap: 8, fontSize: 14 }}>
              <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
                <strong>{t("scorecardRound", { round: c.roundNumber })}</strong>
                <span style={{ color: "var(--mut)" }}>{c.roundType} · {formatIndianDate(c.scheduledDate)}</span>
                <StatusPill status={c.status} />
              </div>
              {c.blinded ? (
                <p role="note" style={muted}>{t("scorecardBlinded", { submitted: c.submittedCount, total: c.panelSize })}</p>
              ) : (
                <>
                  <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
                    <span>{t("scorecardPanelScore")} {c.panelScore != null ? c.panelScore : t("scorecardNotConsolidated")}</span>
                    {c.cutoffScore != null && <span style={{ color: "var(--mut)" }}>{t("scorecardCutoff", { cutoff: c.cutoffScore })}</span>}
                    {c.recommendation && <span>{t("scorecardRecommendation")} <StatusPill status={c.recommendation} /></span>}
                  </div>
                  {c.scores.length === 0 ? (
                    <p style={muted}>{t("scorecardNoScores")}</p>
                  ) : (
                    <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 6 }}>
                      {c.scores.map((s, i) => (
                        <li key={`${c.interviewId}-${i}`}>
                          <strong>{s.interviewer}</strong>
                          {s.overallScore != null && <span> · {t("scorecardOverall", { score: s.overallScore })}</span>}
                          <div style={{ color: "var(--mut)" }}>{scoreLine(s.scores, c.competencies)}</div>
                          {s.comments && <div>{s.comments}</div>}
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              )}
            </section>
          ))}
        </div>
      </Card>

      <Card title={t("documentsTitle")}>
        <div style={{ padding: "16px 20px" }}>
          <a className="btn ghost" href={`${base}/pdf`} download>{t("downloadPdf")}</a>
        </div>
      </Card>
    </>
  );
}
