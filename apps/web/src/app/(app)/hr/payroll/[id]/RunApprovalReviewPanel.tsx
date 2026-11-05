"use client";

/**
 * T-STAT review of PR #2449, SHOULD-FIX 4: the run summary shows, before
 * approval, the arrears the run pays (total, per employee, and which exceed
 * the review threshold and so need an acknowledgement) and how many slips have
 * no basic pay. Renders nothing when there is nothing to review or the read fails.
 */
import { useEffect, useId, useState } from "react";
import { useTranslations } from "next-intl";
import { formatMinorString } from "@/lib/payroll/runMoney";
import { loadApprovalReview, type ApprovalReview } from "./approvalReview";

export function RunApprovalReviewPanel({ runId }: { runId: string }) {
  const t = useTranslations("payroll.runApproval");
  const headingId = useId();
  const [review, setReview] = useState<ApprovalReview | null>(null);

  useEffect(() => {
    let live = true;
    void loadApprovalReview(runId).then((r) => { if (live) setReview(r); });
    return () => { live = false; };
  }, [runId]);

  if (!review) return null;
  const employees = review.arrears.employees;
  const nonPositive = review.nonPositiveNet ?? [];
  const tds = review.tds ?? [];
  if (employees.length === 0 && review.zeroBasic.length === 0 && nonPositive.length === 0 && tds.length === 0) return null;
  const needReview = employees.filter((e) => e.requiresReview).length;

  return (
    <section className="card" style={{ marginBottom: 16 }} aria-labelledby={headingId}>
      <div className="card-h">
        <h3 id={headingId}>{employees.length > 0 ? t("summaryTitle") : t("reviewTitle")}</h3>
      </div>
      <div className="pad">
        {employees.length > 0 && (
          <>
            <p>{t("summaryTotal", { count: employees.length, amount: formatMinorString(review.arrears.totalMinor) })}</p>
            {needReview > 0 && <p role="note" className="pill warn">{t("summaryNeedReview", { count: needReview })}</p>}
            <table className="table" style={{ marginTop: 10 }}>
              <thead>
                <tr>
                  <th scope="col">{t("colEmployee")}</th>
                  <th scope="col">{t("colArrears")}</th>
                  <th scope="col">{t("colRegularGross")}</th>
                  <th scope="col">{t("colReview")}</th>
                </tr>
              </thead>
              <tbody>
                {employees.map((e) => (
                  <tr key={e.employeeId}>
                    <td>{e.employeeNo}</td>
                    <td>{formatMinorString(e.arrearsMinor)}</td>
                    <td>{formatMinorString(e.regularGrossMinor)}</td>
                    <td>{e.requiresReview ? t("needsReview") : t("withinThreshold")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
        {review.zeroBasic.length > 0 && (
          <p role="note" className="pill warn" style={{ marginTop: 10 }}>{t("zeroBasicSummary", { count: review.zeroBasic.length })}</p>
        )}
        {nonPositive.length > 0 && (
          <p role="note" className="pill warn" style={{ marginTop: 10 }}>{t("netPaySummary", { count: nonPositive.length })}</p>
        )}
        {tds.length > 0 && (
          <>
            <h4 style={{ margin: "12px 0 6px", fontSize: 14 }}>{t("tdsHeading")}</h4>
            <ul style={{ margin: 0, paddingInlineStart: 18, fontSize: 13 }}>
              {tds.map((i) => (
                <li key={`${i.employeeId}-${i.kind}`}>
                  {t(`tdsKind.${i.kind}`, { employee: i.employeeNo, months: i.presumedMonths, amount: formatMinorString(i.amountMinor) })}
                  {i.kind === "shortfall" && i.finalMonth ? ` ${t("tdsUnrecoverable")}` : ""}
                  {i.requiresAck ? ` (${t("needsReview")})` : ""}
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </section>
  );
}
