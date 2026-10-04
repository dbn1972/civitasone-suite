"use client";

import { UserFacingError } from "@/lib/userFacingError";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, Card, ConfirmDialog } from "../../../../../_components/ds";
import { browserFetch } from "@/lib/api/browserClient";
import { useFormError } from "@/lib/useFormError";
import { useAsyncMutation } from "@/lib/useAsyncMutation";
import { formatIndianDate, formatMoney } from "@/lib/formatters";
import { isOpenEnded, type PtPendingRequest } from "./viewModel";

type Accepted = { id: string };
type Outcome = { status: string; code: string | null; decidedByViewer?: boolean };

/**
 * GAP-PAYROLL-STATUTORY-PT-04 [HUMAN REVIEW: statutory compliance]: PT changes
 * waiting for approval. maker != checker: the person who requested a change
 * cannot approve it (the API refuses, and the consumer re-checks); a DIFFERENT
 * payroll administrator approves or rejects. The rules are re-run when the
 * approval is processed, so an approval can still come back "rejected".
 */
export function PtApprovals({ pending, viewerId, canDecide, stateName }: {
  pending: PtPendingRequest[]; viewerId: string; canDecide: boolean; stateName: (code: string) => string;
}) {
  const t = useTranslations("ptApprovals");
  const router = useRouter();
  const formError = useFormError(t("area"));
  const [target, setTarget] = useState<{ req: PtPendingRequest; decision: "approve" | "reject" } | null>(null);
  const [dialogError, setDialogError] = useState<string | undefined>();
  const [done, setDone] = useState<string | null>(null);
  const noteRef = useRef<string | undefined>(undefined);

  const ruleText = (code: string | null): string => {
    const known: Record<string, string> = {
      PT_VERSION_EXISTS: t("errVersionExists"),
      PT_BACKDATE_BEFORE_FINALISED_RUN: t("errBackdateFinalised"),
      PT_BACKDATE_REASON_REQUIRED: t("errReasonRequired"),
    };
    return (code && known[code]) || t("errRuleFailed");
  };

  const mutation = useAsyncMutation<Accepted, Outcome>({
    mutate: async () => {
      if (!target) throw new Error(t("errGeneric"));
      let res: Response;
      try {
        res = await browserFetch(`v1/payroll/statutory/pt/versions/requests/${encodeURIComponent(target.req.id)}/${target.decision}`, {
          method: "PATCH",
          body: JSON.stringify(noteRef.current ? { note: noteRef.current } : {}),
        });
      } catch (caught) {
        throw UserFacingError.from(formError.fromException("save", caught));
      }
      if (!res.ok) {
        let code: string | undefined;
        try { code = ((await res.clone().json()) as { code?: string }).code; } catch { code = undefined; }
        if (code === "SELF_APPROVAL_FORBIDDEN") throw new Error(t("errSelf"));
        if (code === "INVALID_STATE") throw new Error(t("errNotPending"));
        throw UserFacingError.from(await formError.fromResponse(res, "save"));
      }
      return (await res.json()) as Accepted;
    },
    poll: async (accepted) => {
      const res = await browserFetch(`v1/payroll/statutory/pt/versions/requests/${encodeURIComponent(accepted.id)}`);
      if (!res.ok) throw new Error("not available");
      return (await res.json()) as Outcome;
    },
    isDone: (o) => o.status !== "pending_approval" && o.status !== "pending",
    onConfirmed: (o) => {
      if (o.status === "rejected") {
        setDialogError(ruleText(o.code));
        return;
      }
      setTarget(null);
      // Another administrator decided first (this decision was ignored): say what actually happened.
      const other = o.decidedByViewer === false;
      setDone(
        o.status === "cancelled" ? t("decidedCancelled")
        : o.status === "declined" ? t(other ? "decidedRejectedByOther" : "decidedRejected")
        : t(other ? "decidedApprovedByOther" : "decidedApproved"),
      );
      router.refresh();
    },
    onTimeout: () => { setTarget(null); setDone(t("stillProcessing")); },
    maxAttempts: 8,
  });
  const busy = mutation.isBusy;

  async function decide(note?: string) {
    noteRef.current = note;
    setDialogError(undefined);
    mutation.reset();
    await mutation.run();
  }

  return (
    <Card title={t("title")} padding>
      <div style={{ display: "grid", gap: 14 }}>
        <p role="note" style={{ margin: 0, fontSize: 13, color: "var(--mut)" }}>{t("makerCheckerNote")}</p>
        {done && <p role="status" aria-live="polite" className="pill good" style={{ width: "fit-content", margin: 0 }}>{done}</p>}
        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 12 }}>
          {pending.map((req) => {
            const mine = req.makerId === viewerId;
            return (
              <li key={req.id} style={{ border: "1px solid var(--line)", borderRadius: 10, padding: 12, display: "grid", gap: 6 }}>
                <strong>
                  {req.kind === "checker_off"
                    ? t("checkerOffSummary")
                    : t("versionSummary", { state: stateName(req.stateCode ?? ""), date: formatIndianDate(req.effectiveFrom), count: req.slabs.length })}
                </strong>
                {req.kind === "version" && (
                  <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>
                    {req.slabs.map((s, i) => (
                      <li key={i}>
                        {t("slabLine", {
                          from: formatMoney(s.fromMinor),
                          to: isOpenEnded(s.toMinor) ? t("noUpperBound") : formatMoney(s.toMinor),
                          tax: formatMoney(s.taxMinor),
                        })}
                        {s.februaryTaxMinor != null ? ` ${t("februarySuffix", { amount: formatMoney(s.februaryTaxMinor) })}` : ""}
                        {s.appliesToGender !== "all" ? ` ${t("genderSuffix", { gender: s.appliesToGender === "female" ? t("genderFemale") : t("genderMale") })}` : ""}
                      </li>
                    ))}
                  </ul>
                )}
                {req.reason && <span style={{ fontSize: 13 }}>{t("reasonLine", { reason: req.reason })}</span>}
                <span style={{ fontSize: 12, color: "var(--mut)" }}>{mine ? t("requestedByYou") : t("requestedByOther")}</span>
                {canDecide && mine && <span role="note" className="pill warn" style={{ width: "fit-content" }}>{t("waitingOther")}</span>}
                {canDecide && !mine && (
                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                    <Button type="button" style={{ minHeight: 44 }} disabled={busy} onClick={() => { setDialogError(undefined); setTarget({ req, decision: "approve" }); }}>{t("approve")}</Button>
                    <Button type="button" variant="ghost" style={{ minHeight: 44 }} disabled={busy} onClick={() => { setDialogError(undefined); setTarget({ req, decision: "reject" }); }}>{t("reject")}</Button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </div>

      <ConfirmDialog
        open={target !== null}
        title={target?.decision === "reject" ? t("rejectTitle") : t("approveTitle")}
        confirmLabel={target?.decision === "reject" ? t("rejectConfirm") : t("approveConfirm")}
        danger={target?.decision === "reject"}
        optionalReason
        reasonLabel={t("noteLabel")}
        maxReasonLength={500}
        busy={busy}
        errorMessage={dialogError ?? mutation.error ?? undefined}
        description={<p style={{ margin: 0 }}>{target?.decision === "reject" ? t("rejectDescription") : t("approveDescription")}</p>}
        onConfirm={(note) => void decide(note)}
        onCancel={() => !busy && setTarget(null)}
      />
    </Card>
  );
}
