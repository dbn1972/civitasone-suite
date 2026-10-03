"use client";

/**
 * fp-finance-01: changes held for a second officer (maker != checker).
 * Fiscal-year activation, opening balances and HoA-code changes each wait here
 * until a DIFFERENT finance_admin approves or rejects them; the server enforces
 * the rule, this panel only avoids offering the maker a button that would fail.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import type { FinanceChangeRequest } from "@civitasone/types";
import { ActionButton, Card } from "@/app/_components/ds";
import { browserFetch, errorCodeFromResponse, errorMessageFromResponse } from "@/lib/api/browserClient";
import { formatIndianDateTime, formatMoney } from "@/lib/formatters";
import { toChangeRequestView } from "./changeRequests";

type Decision = "approve" | "reject" | "cancel";

export function ChangeRequestsPanel({
  requests,
  viewerId,
  canDecide,
  title,
}: {
  requests: FinanceChangeRequest[];
  viewerId: string | null;
  canDecide: boolean;
  title?: string;
}) {
  const t = useTranslations("financeApprovals");
  const router = useRouter();
  const [note, setNote] = useState<string | null>(null);
  const views = requests.map((r) => toChangeRequestView(r, viewerId, canDecide, (m) => formatMoney(m)));

  async function decide(id: string, decision: Decision, text?: string) {
    const res = await browserFetch(`v1/finance/change-requests/${encodeURIComponent(id)}/${decision}`, {
      method: "POST",
      body: JSON.stringify(decision === "reject" ? { note: text ?? "" } : decision === "approve" ? { note: text || undefined } : {}),
    });
    if (!res.ok) {
      const code = await errorCodeFromResponse(res);
      if (code === "MAKER_CHECKER_VIOLATION") throw new Error(t("errSelf"));
      if (code === "NOT_PENDING") throw new Error(t("errNotPending"));
      throw new Error(await errorMessageFromResponse(res, "save", t("area")));
    }
  }

  return (
    <Card title={title ?? t("title")}>
      <div className="pad" style={{ display: "grid", gap: 12 }}>
        <p style={{ color: "var(--mut)", fontSize: 13.5, margin: 0 }}>{t("intro")}</p>
        {views.length === 0 ? (
          <p role="status" style={{ margin: 0, fontSize: 13.5 }}>{t("none")}</p>
        ) : (
          <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 12 }}>
            {views.map((v) => (
              <li key={v.id} style={{ border: "1px solid var(--line)", borderRadius: 10, padding: 12, display: "grid", gap: 6 }}>
                <div style={{ fontWeight: 600 }}>
                  {t(`kind.${v.kind}`)}: {v.subject}
                </div>
                {v.kind === "hoa_change" ? <div style={{ fontSize: 13 }}>{t("hoaChange", { change: v.details[0] ?? "" })}</div> : null}
                {v.kind === "opening_balances_enter" ? (
                  <div style={{ fontSize: 13 }}>{t("balancesSummary", { count: Number(v.details[0] ?? 0), total: v.details[1] ?? "" })}</div>
                ) : null}
                {v.kind === "settings_relax" ? (
                  <div style={{ fontSize: 13 }}>{t("settingsRelaxSummary", { controls: v.details.map((d) => t(`settingsControl.${d}`)).join(", ") })}</div>
                ) : null}
                <div style={{ fontSize: 13 }}>{t("reason", { reason: v.reason })}</div>
                <div style={{ fontSize: 12, color: "var(--mut)" }}>
                  {v.mine ? t("raisedByYou") : t("raisedByOther")} · {formatIndianDateTime(v.requestedAt)}
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                  {v.action === "decide" ? (
                    <>
                      <ActionButton
                        label={t("approve")}
                        confirmTitle={t("approveTitle")}
                        confirmDescription={t(`approveHelp.${v.kind}`)}
                        confirmLabel={t("approve")}
                        onConfirm={(text) => decide(v.id, "approve", text)}
                        onSuccess={() => { setNote(t("decided")); router.refresh(); }}
                      />
                      <ActionButton
                        label={t("reject")}
                        className="btn ghost"
                        danger
                        confirmTitle={t("rejectTitle")}
                        confirmLabel={t("reject")}
                        requireReason
                        reasonLabel={t("rejectReason")}
                        minReasonLength={5}
                        maxReasonLength={500}
                        onConfirm={(text) => decide(v.id, "reject", text)}
                        onSuccess={() => { setNote(t("decided")); router.refresh(); }}
                      />
                    </>
                  ) : null}
                  {v.action === "withdraw" ? (
                    <>
                      <span style={{ fontSize: 13, color: "var(--mut)" }}>{t("waitingForOther")}</span>
                      <ActionButton
                        label={t("withdraw")}
                        className="btn ghost"
                        confirmTitle={t("withdrawTitle")}
                        confirmLabel={t("withdraw")}
                        onConfirm={() => decide(v.id, "cancel")}
                        onSuccess={() => { setNote(t("withdrawn")); router.refresh(); }}
                      />
                    </>
                  ) : null}
                  {v.action === "wait" ? <span style={{ fontSize: 13, color: "var(--mut)" }}>{t("needsAdmin")}</span> : null}
                </div>
              </li>
            ))}
          </ul>
        )}
        {note ? <p role="status" style={{ margin: 0, fontSize: 13 }}>{note}</p> : null}
      </div>
    </Card>
  );
}
