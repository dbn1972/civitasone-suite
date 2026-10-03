"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, ConfirmDialog, StatusPill } from "../../../../_components/ds";
import { formatMoney } from "@/lib/formatters";
import { postWithErrorCode } from "../_lib/postWithErrorCode";
import type { PendingFlexElection } from "./flexPlans";

type Decision = "approve" | "reject";
type Target = { row: PendingFlexElection; decision: Decision };

const NO_TARGET: Target | null = null;
const NO_ERROR: string | undefined = undefined;
const NO_MESSAGE: string | null = null;

/**
 * GAP-PAYROLL-FLEX-BENEFITS-05: the approver queue for submitted flex-benefit
 * elections. POST /v1/payroll/flex-benefits/elections/:id/{approve,reject};
 * the server enforces maker != checker (403 SELF_APPROVAL_FORBIDDEN, when the
 * tenant switch is on) and a single decision (409 ELECTION_NOT_PENDING) and
 * that the election is still what was loaded (409 STALE_ELECTION).
 * A rejection needs a reason of at least 10 characters; it is audited.
 */
export function FlexElectionApprovals({ rows, total }: { rows: PendingFlexElection[]; total: number }) {
  const t = useTranslations("flexElectionApprovals");
  const router = useRouter();
  const [target, setTarget] = useState(NO_TARGET);
  const [busy, setBusy] = useState(false);
  const [dialogError, setDialogError] = useState(NO_ERROR);
  const [message, setMessage] = useState(NO_MESSAGE);

  const nameOf = (r: PendingFlexElection) => r.employeeName ?? t("unknownEmployee");

  async function decide(reason?: string) {
    if (!target) return;
    setBusy(true);
    setDialogError(undefined);
    try {
      await postWithErrorCode(
        `v1/payroll/flex-benefits/elections/${target.row.id}/${target.decision}`,
        reason ? { etag: target.row.etag, reason } : { etag: target.row.etag },
        {
          SELF_APPROVAL_FORBIDDEN: t("selfDecisionError"),
          ELECTION_NOT_PENDING: t("alreadyDecidedError"),
          STALE_ELECTION: t("staleElectionError"),
        },
      );
      setMessage(t(target.decision === "approve" ? "approvedMessage" : "rejectedMessage", { name: nameOf(target.row) }));
      setTarget(null);
      router.refresh();
    } catch (err) {
      setDialogError(err instanceof Error ? err.message : t("networkError"));
    } finally {
      setBusy(false);
    }
  }

  if (rows.length === 0) {
    return <p className="pad" style={{ fontSize: 13, color: "var(--ink2)", margin: 0 }}>{t("noneMessage")}</p>;
  }

  return (
    <div className="pad">
      {message && (
        <p role="status" aria-live="polite" className="pill good" style={{ width: "fit-content", marginBottom: 12 }}>
          {message}
        </p>
      )}
      <p style={{ fontSize: 12, color: "var(--ink2)", margin: "0 0 10px" }}>{t("checkerNote")}</p>
      {rows.length < total && (
        <p style={{ fontSize: 12, color: "var(--ink2)", margin: "0 0 10px" }}>{t("truncatedNote", { shown: rows.length, total })}</p>
      )}
      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 10 }}>
        {rows.map((row) => (
          <li key={row.id} style={{ border: "1px solid var(--line2)", borderRadius: 10, padding: "10px 14px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <div style={{ fontSize: 13 }}>
              <strong>{nameOf(row)}</strong>{" "}
              {t("summary", { plan: row.planName, fy: row.fy, total: formatMoney(row.totalElectedMinor) })}{" "}
              <StatusPill status={row.status} />
              {row.isOwnSubmission && <div style={{ fontSize: 12, color: "var(--ink2)" }}>{t("ownSubmissionNote")}</div>}
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <Button
                type="button"
                variant="primary"
                style={{ minHeight: 36 }}
                aria-label={t("approveAriaLabel", { name: nameOf(row) })}
                onClick={() => { setDialogError(undefined); setTarget({ row, decision: "approve" }); }}
              >
                {t("approveBtn")}
              </Button>
              <Button
                type="button"
                variant="ghost"
                style={{ minHeight: 36 }}
                aria-label={t("rejectAriaLabel", { name: nameOf(row) })}
                onClick={() => { setDialogError(undefined); setTarget({ row, decision: "reject" }); }}
              >
                {t("rejectBtn")}
              </Button>
            </div>
          </li>
        ))}
      </ul>

      <ConfirmDialog
        open={target !== null}
        title={target?.decision === "reject" ? t("rejectTitle") : t("approveTitle")}
        confirmLabel={target?.decision === "reject" ? t("rejectBtn") : t("approveBtn")}
        danger={target?.decision === "reject"}
        requireReason={target?.decision === "reject"}
        optionalReason={target?.decision === "approve"}
        minReasonLength={10}
        maxReasonLength={512}
        reasonLabel={t("reasonLabel")}
        busy={busy}
        errorMessage={dialogError}
        description={
          target
            ? t(target.decision === "reject" ? "rejectDescription" : "approveDescription", {
                name: nameOf(target.row),
                total: formatMoney(target.row.totalElectedMinor),
              })
            : null
        }
        onConfirm={(reason) => void decide(reason)}
        onCancel={() => !busy && setTarget(null)}
      />
    </div>
  );
}
