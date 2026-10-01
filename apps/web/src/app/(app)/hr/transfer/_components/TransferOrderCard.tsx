"use client";
/**
 * TransferOrderCard — Sprint 13 / Lifecycle Phase 1
 * Shows: from-office, to-office, joining date, order no., order date (Indian format).
 * Status chip + pipeline position from the shared, real-enum transferStatus module.
 * Action buttons per stage. Horizontal progress timeline.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { StatusPill, ConfirmDialog, Button } from "@/app/_components/ds";
import { formatIndianDate } from "@/lib/formatters";
import { useToast } from "@/app/_components/ds/Toast";
import { useFormError } from "@/lib/useFormError";
import { isEofficeStatus, DIRECT_PIPELINE, directPipelineIndex } from "@/lib/hr/transferStatus";

export type TransferRow = {
  id: string;
  employee?: string;
  employeeId?: string;
  fromOffice?: string;
  fromDeptId?: string;
  toOffice?: string;
  toDeptId?: string;
  orderNo?: string | null;
  orderDate?: string | null;
  effectiveDate?: string | null;
  relievedDate?: string | null;
  joinedDate?: string | null;
  transferDate?: string | null;
  status: string;
  department?: string;
  createdAt?: string;
} & Record<string, unknown>;

interface Props {
  transfer: TransferRow;
  onAction?: () => void;
}

type PendingStage = {
  path: string;
  body: Record<string, string>;
  label: string;
  title: string;
  description: string;
};

/** IST calendar date as YYYY-MM-DD -- GAP-HR-TRANSFER-02: `new
 * Date().toISOString().split("T")[0]` is the UTC date, one day behind IST
 * between 00:00 and 05:30 IST. The fabricated-order-number question itself
 * (manual entry vs. a real server-generated series) is a real open product
 * decision the gap catalog explicitly says not to guess at -- left as-is
 * pending that decision -- but the date computation underneath it was a
 * plain, independently-fixable bug. */
function todayIST(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
}

export function TransferOrderCard({ transfer, onAction }: Props) {
  // GAP-HR-TRANSFER-10: all copy comes from the transferUi namespace.
  const tr = useTranslations("transferUi");
  const statusText = (s: string) => (tr.has(`status.${s}`) ? tr(`status.${s}`) : s);
  const { toast } = useToast();
  const router = useRouter();
  const [acting, setActing] = useState(false);
  const [pending, setPending] = useState<PendingStage | null>(null);
  const [dialogError, setDialogError] = useState<string | undefined>();
  const formError = useFormError("transfer order");
  const statusLabel = statusText(transfer.status);
  const currentIdx = directPipelineIndex(transfer.status);
  const today = todayIST();
  const isClosed = ["joined", "completed", "cancelled"].includes(transfer.status);
  const isCancelled = transfer.status === "cancelled";
  const isEoffice = isEofficeStatus(transfer.status);
  const empLabel = transfer.employee ?? transfer.employeeId ?? tr("unknown");

  const postAction = async (path: string, body: Record<string, string>) => {
    setActing(true);
    setDialogError(undefined);
    try {
      const res = await fetch(
        `/api/proxy/v1/hrms/lifecycle/transfers/${transfer.id}/${path}`,
        { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) },
      );
      if (!res.ok) {
        const resolved = await formError.fromResponse(res, "save");
        throw new Error(resolved.message);
      }
      toast.success(tr("updatedToast"));
      router.refresh();
      setPending(null);
      onAction?.();
    } catch (err) {
      setDialogError(err instanceof Error ? err.message : formError.fromException("save").message);
    } finally {
      setActing(false);
    }
  };

  const fromLabel = transfer.fromOffice ?? transfer.fromDeptId ?? "—";
  const toLabel   = transfer.toOffice   ?? transfer.toDeptId   ?? "—";

  return (
    <div className="card" style={{ marginBottom: 0 }} aria-label={tr("cardAria", { name: empLabel })}>
      <div className="card-h" style={{ alignItems: "flex-start", gap: 12 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h3 style={{ margin: 0, fontSize: "0.9375rem", fontWeight: 600 }}>{empLabel}</h3>
          <p style={{ margin: "3px 0 0", fontSize: "0.8125rem", color: "var(--ink2)" }}>
            {fromLabel} &rarr; {toLabel}
          </p>
        </div>
        <StatusPill status={transfer.status} label={statusLabel} />
      </div>

      <div className="pad" style={{ paddingTop: 4 }}>
        <div className="fields" style={{ marginTop: 8 }}>
          {transfer.orderNo != null && (
            <div className="fld">
              <span className="l">{tr("orderNo")}</span>
              <span className="v" style={{ fontFamily: "monospace", fontSize: "0.8125rem" }}>{transfer.orderNo}</span>
            </div>
          )}
          {transfer.orderDate && (
            <div className="fld">
              <span className="l">{tr("orderDate")}</span>
              <span className="v">{formatIndianDate(transfer.orderDate)}</span>
            </div>
          )}
          {(transfer.effectiveDate ?? transfer.transferDate) && (
            <div className="fld">
              <span className="l">{tr("effectiveJoining")}</span>
              <span className="v">{formatIndianDate((transfer.effectiveDate ?? transfer.transferDate) as string)}</span>
            </div>
          )}
          {transfer.relievedDate && (
            <div className="fld">
              <span className="l">{tr("relievedOn")}</span>
              <span className="v">{formatIndianDate(transfer.relievedDate)}</span>
            </div>
          )}
          {transfer.joinedDate && (
            <div className="fld">
              <span className="l">{tr("joinedOn")}</span>
              <span className="v">{formatIndianDate(transfer.joinedDate)}</span>
            </div>
          )}
        </div>

        {/* Stage progress -- GAP-HR-TRANSFER-08: previously showed a fixed
            4-step "Initiated/HOD Approved/Admin Approved/Order Issued..."
            timeline with no corresponding backend transitions for the
            middle two steps at all, and defaulted an unrecognised status
            (e.g. "cancelled") to index 0, contradicting the status pill
            shown right next to it (see the cancelled branch below, which
            predates this fix and is unchanged). An eOffice-path transfer
            (pending_approval/pending_effective/completed) has its own
            simpler shape and doesn't belong on the direct 4-step pipeline
            at all -- shown as plain status text instead. */}
        {isCancelled ? (
          <p style={{ margin: "16px 0 6px", fontSize: "0.8125rem", color: "var(--ink2)" }}>
            {tr("cancelledNote")}
          </p>
        ) : isEoffice ? (
          <p style={{ margin: "16px 0 6px", fontSize: "0.8125rem", color: "var(--ink2)" }}>
            {transfer.status === "pending_approval" ? tr("awaitingEoffice") : tr("approvedEoffice")}
          </p>
        ) : (
        <ol
          aria-label={tr("timelineAria")}
          style={{ display: "flex", alignItems: "flex-start", margin: "16px 0 6px", overflowX: "auto", paddingBottom: 4, paddingInlineStart: 0, listStyle: "none" }}
        >
          {DIRECT_PIPELINE.map(({ key }, i) => {
            const label = statusText(key);
            const done   = i < currentIdx;
            const active = i === currentIdx;
            const bg  = done ? "var(--good, #16a34a)" : active ? "var(--info, #2563eb)" : "var(--line, #e2e8f0)";
            const fg  = done || active ? "var(--panel, #fff)" : "var(--mut)";
            const connBg = done ? "var(--good, #16a34a)" : "var(--line, #e2e8f0)";
            return (
              <li
                key={key}
                aria-current={active ? "step" : undefined}
                style={{ display: "flex", alignItems: "center", flexShrink: 0 }}
              >
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                  <div
                    title={label}
                    style={{
                      width: 26, height: 26, borderRadius: "50%",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      fontSize: 11, fontWeight: 700, background: bg, color: fg,
                      // GAP-HR-TRANSFER-11: a non-colour cue for the active
                      // step (colour alone previously distinguished active
                      // from upcoming; done steps already had a check mark).
                      boxShadow: active ? "0 0 0 2px var(--panel, #fff), 0 0 0 4px var(--info, #2563eb)" : undefined,
                    }}
                  >
                    {done ? "✓" : i + 1}
                  </div>
                  <span style={{
                    fontSize: "0.625rem", marginTop: 3,
                    color: active ? "var(--info, #2563eb)" : done ? "var(--good, #16a34a)" : "var(--ink3)",
                    fontWeight: active ? 600 : 400,
                    whiteSpace: "nowrap", maxWidth: 56, textAlign: "center",
                  }}>
                    {label}
                    <span style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>
                      {done ? tr("stepCompleted") : active ? tr("stepCurrent") : tr("stepUpcoming")}
                    </span>
                  </span>
                </div>
                {i < DIRECT_PIPELINE.length - 1 && (
                  <div style={{ width: 20, height: 2, background: connBg, flexShrink: 0, margin: "0 2px", marginBottom: 16 }} />
                )}
              </li>
            );
          })}
        </ol>
        )}

        {/* Action buttons per stage -- each is a real, hard-to-reverse
            lifecycle transition (an issued order number, an official
            relieving date, a join date), so each is gated by a
            ConfirmDialog naming the employee and the exact effective date
            rather than firing on a bare click. Gates now match the REAL
            backend statuses (requested/ordered/relieved) -- GAP-HR-
            TRANSFER-08's evidence: the previous gates (pending/initiated,
            order_issued/approved) never matched what POST /transfers or
            issue-order actually set, so "Issue Order" never appeared on a
            freshly-created transfer. */}
        {!isClosed && !isEoffice && (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
            {transfer.status === "requested" && (
              <Button style={{ fontSize: 13 }} disabled={acting} loading={acting}
                onClick={() => setPending({
                  path: "issue-order",
                  body: { orderNo: `TO-${transfer.id.slice(0, 8).toUpperCase()}`, orderDate: today },
                  label: tr("issueOrder"),
                  title: tr("issueTitle"),
                  description: tr("issueDesc", { name: empLabel, from: fromLabel, to: toLabel, date: today }),
                })}>
                {acting ? tr("processing") : tr("issueOrder")}
              </Button>
            )}
            {transfer.status === "ordered" && !transfer.relievedDate && (
              <Button style={{ fontSize: 13 }} disabled={acting} loading={acting}
                onClick={() => setPending({
                  path: "relieve",
                  body: { relievedDate: today },
                  label: tr("markRelieved"),
                  title: tr("relieveTitle"),
                  description: tr("relieveDesc", { name: empLabel, from: fromLabel, date: today }),
                })}>
                {acting ? tr("processing") : tr("markRelieved")}
              </Button>
            )}
            {transfer.status === "relieved" && !transfer.joinedDate && (
              <Button style={{ fontSize: 13 }} disabled={acting} loading={acting}
                onClick={() => setPending({
                  path: "join",
                  body: { joinedDate: today },
                  label: tr("markJoined"),
                  title: tr("joinTitle"),
                  description: tr("joinDesc", { name: empLabel, to: toLabel, date: today }),
                })}>
                {acting ? tr("processing") : tr("markJoined")}
              </Button>
            )}
          </div>
        )}
      </div>

      <ConfirmDialog
        open={pending !== null}
        title={pending?.title ?? tr("confirm")}
        description={pending?.description}
        confirmLabel={pending?.label ?? tr("confirm")}
        busy={acting}
        errorMessage={dialogError}
        onConfirm={() => pending && void postAction(pending.path, pending.body)}
        onCancel={() => { if (!acting) { setPending(null); setDialogError(undefined); } }}
      />
    </div>
  );
}
