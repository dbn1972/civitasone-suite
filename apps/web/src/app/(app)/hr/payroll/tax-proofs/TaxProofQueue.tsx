"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { formatMoney, formatIndianDate } from "@/lib/formatters";
import { rupeesToMinorString } from "@/lib/money";
import { browserFetch, errorCodeFromResponse } from "@/lib/api/browserClient";
import { currentFinancialYear } from "@/lib/fiscalYear";
import {
  errorKeyForCode, isEmptyList, minorToRupeesInput, openProof, recentFinancialYears, formatBytes, PROOF_LINES, PROOF_MAX_MB, PROOF_MAX_FILES,
  type QueueItem, type QueueResponse,
} from "@/lib/payroll/taxProofs";
import { Button, ConfirmDialog, Select, StatusPill } from "../../../../_components/ds";

const PAGE_SIZE = 25;
type Action = { kind: "accept" | "reject" | "hold" | "release"; item: QueueItem };
const NO_ACTION: Action | null = null;
const NO_ERROR: string | undefined = undefined;
const NO_MESSAGE: { text: string; tone: "good" | "bad" } | null = null;

/**
 * GAP-PAYROLL-TAX-DECLARATION-02: payroll verification queue. Filter by FY and
 * status, open a proof (short-lived, audited link), accept or reject it
 * (maker != checker, enforced by the server: 403 SELF_VERIFY_FORBIDDEN), and --
 * for payroll_admin -- place or release a legal hold with a reason.
 */
export function TaxProofQueue({ canDecide, canHold }: { canDecide: boolean; canHold: boolean }) {
  const t = useTranslations("taxProofs");
  const [fy, setFy] = useState(currentFinancialYear());
  const [status, setStatus] = useState("pending");
  const [offset, setOffset] = useState(0);
  const [data, setData] = useState<QueueResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [action, setAction] = useState(NO_ACTION);
  const [busy, setBusy] = useState(false);
  const [dialogError, setDialogError] = useState(NO_ERROR);
  const [message, setMessage] = useState(NO_MESSAGE);
  const [acceptAmount, setAcceptAmount] = useState("");

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoadFailed(false);
    const qs = new URLSearchParams({ fy, limit: String(PAGE_SIZE), offset: String(offset) });
    if (status !== "all") qs.set("status", status);
    try {
      const res = await browserFetch(`v1/payroll/tax-proofs?${qs.toString()}`, { signal });
      if (!res.ok) {
        setLoadFailed(true);
        return;
      }
      setData((await res.json()) as QueueResponse);
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return;
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  }, [fy, status, offset]);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const nameOf = (r: QueueItem) => r.employeeName ?? t("unknownEmployee");

  function errorText(code: string | null): string {
    const key = errorKeyForCode(code);
    return key ? t(`errors.${key}`, { mb: PROOF_MAX_MB, max: PROOF_MAX_FILES }) : t("errors.generic");
  }

  async function onView(r: QueueItem) {
    setMessage(null);
    try {
      const out = await openProof(r.id);
      if (!out.ok) setMessage({ text: t("errors.viewFailed"), tone: "bad" });
    } catch {
      setMessage({ text: t("errors.viewFailed"), tone: "bad" });
    }
  }

  async function confirm(reason?: string) {
    if (!action) return;
    let amountMinor: number | null = null;
    if (action.kind === "accept") {
      // Accepting verifies an amount: the officer confirms or corrects what the employee stated.
      if (acceptAmount.trim() === "") { setDialogError(t("errors.amountRequired")); return; }
      const minor = rupeesToMinorString(acceptAmount, { allowZero: true });
      if (minor === null) { setDialogError(t("errors.invalidAmount")); return; }
      amountMinor = Number(minor);
    }
    setBusy(true);
    setDialogError(undefined);
    try {
      const { kind, item } = action;
      const res = kind === "accept"
        ? await browserFetch(`v1/payroll/tax-proofs/${item.id}/accept`, { method: "POST", body: JSON.stringify({ amountMinor }) })
        : kind === "reject"
          ? await browserFetch(`v1/payroll/tax-proofs/${item.id}/reject`, { method: "POST", body: JSON.stringify({ reason }) })
          : await browserFetch(`v1/payroll/tax-proofs/${item.id}/legal-hold`, { method: "PUT", body: JSON.stringify({ hold: kind === "hold", reason }) });
      if (!res.ok) {
        setDialogError(errorText(await errorCodeFromResponse(res)));
        return;
      }
      setMessage({ text: t(`done.${kind}`, { name: nameOf(item) }), tone: "good" });
      setAction(null);
      await load();
      setTimeout(() => void load(), 1200);
    } catch {
      setDialogError(t("errors.generic"));
    } finally {
      setBusy(false);
    }
  }

  const rows = data?.data ?? [];
  const total = data?.meta.total ?? 0;
  const from = total < 1 ? 0 : offset + 1;
  const to = Math.min(offset + PAGE_SIZE, total);

  return (
    <section className="card" style={{ marginBottom: 16 }}>
      <div className="card-h"><h3>{t("queue.heading")}</h3></div>
      <div className="pad" style={{ display: "grid", gap: 14 }}>
        <div style={{ display: "flex", gap: 14, flexWrap: "wrap", alignItems: "end" }}>
          <label style={{ display: "grid", gap: 4, fontSize: 12, fontWeight: 600 }}>
            {t("queue.fyLabel")}
            <Select value={fy} onChange={(e) => { setOffset(0); setFy(e.target.value); }}>
              {recentFinancialYears(currentFinancialYear()).map((y) => <option key={y} value={y}>{y}</option>)}
            </Select>
          </label>
          <label style={{ display: "grid", gap: 4, fontSize: 12, fontWeight: 600 }}>
            {t("queue.statusLabel")}
            <Select value={status} onChange={(e) => { setOffset(0); setStatus(e.target.value); }}>
              <option value="pending">{t("status.pending")}</option>
              <option value="accepted">{t("status.accepted")}</option>
              <option value="rejected">{t("status.rejected")}</option>
              <option value="all">{t("queue.allStatuses")}</option>
            </Select>
          </label>
          {data && (
            <span style={{ fontSize: 12, color: "var(--ink2)" }}>
              {t("queue.counts", { pending: data.meta.counts.pending ?? 0, accepted: data.meta.counts.accepted ?? 0, rejected: data.meta.counts.rejected ?? 0 })}
            </span>
          )}
        </div>

        {message && <p role="status" aria-live="polite" className={`pill ${message.tone}`} style={{ width: "fit-content", margin: 0 }}>{message.text}</p>}
        {canDecide && <p style={{ fontSize: 12, color: "var(--ink2)", margin: 0 }}>{t("queue.checkerNote")}</p>}

        {loading ? (
          <p style={{ fontSize: 13, margin: 0 }}>{t("loading")}</p>
        ) : loadFailed ? (
          <div role="alert" style={{ color: "var(--bad)", fontSize: 13, display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
            <span>{t("queue.loadFailed")}</span>
            <Button type="button" variant="ghost" style={{ minHeight: 32 }} onClick={() => { setLoading(true); void load(); }}>{t("retry")}</Button>
          </div>
        ) : isEmptyList(rows) ? (
          <p style={{ fontSize: 13, color: "var(--ink2)", margin: 0 }}>{t("queue.none")}</p>
        ) : (
          <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 10 }}>
            {rows.map((r) => (
              <li key={r.id} style={{ border: "1px solid var(--line2)", borderRadius: 10, padding: "10px 14px", display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
                <div style={{ fontSize: 13, display: "grid", gap: 4 }}>
                  <div>
                    <strong>{nameOf(r)}</strong>{r.employeeNo ? ` (${r.employeeNo})` : ""} {" · "}
                    {t(`lines.${PROOF_LINES.includes(r.line) ? r.line : "other"}`)}
                  </div>
                  <div style={{ color: "var(--ink2)", fontSize: 12, wordBreak: "break-all" }}>
                    {r.filename} · {formatBytes(r.sizeBytes)}{r.amountMinor ? ` · ${formatMoney(r.amountMinor)}` : ""} · {t("queue.uploadedOn", { date: formatIndianDate(r.createdAt) })}
                  </div>
                  <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                    <StatusPill status={r.status} label={t(`status.${r.status}`)} />
                    {r.legalHold && <StatusPill status="blocked" label={t("queue.onHold")} />}
                    {r.status === "rejected" && r.rejectionReason && <span style={{ fontSize: 12, color: "var(--bad)" }}>{t("rejectedReason", { reason: r.rejectionReason })}</span>}
                  </div>
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <Button type="button" variant="ghost" style={{ minHeight: 36 }} aria-label={t("viewAria", { name: r.filename })} onClick={() => void onView(r)}>{t("viewBtn")}</Button>
                  {canDecide && r.status === "pending" && (
                    <>
                      <Button type="button" variant="primary" style={{ minHeight: 36 }} aria-label={t("queue.acceptAria", { name: nameOf(r) })} onClick={() => { setDialogError(undefined); setAcceptAmount(minorToRupeesInput(r.amountMinor)); setAction({ kind: "accept", item: r }); }}>{t("queue.acceptBtn")}</Button>
                      <Button type="button" variant="ghost" style={{ minHeight: 36 }} aria-label={t("queue.rejectAria", { name: nameOf(r) })} onClick={() => { setDialogError(undefined); setAction({ kind: "reject", item: r }); }}>{t("queue.rejectBtn")}</Button>
                    </>
                  )}
                  {canHold && (
                    <Button type="button" variant="ghost" style={{ minHeight: 36 }} aria-label={t(r.legalHold ? "queue.releaseAria" : "queue.holdAria", { name: r.filename })} onClick={() => { setDialogError(undefined); setAction({ kind: r.legalHold ? "release" : "hold", item: r }); }}>
                      {r.legalHold ? t("queue.releaseBtn") : t("queue.holdBtn")}
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}

        {total > PAGE_SIZE && (
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <Button type="button" variant="ghost" style={{ minHeight: 36 }} disabled={offset < 1} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}>{t("queue.prev")}</Button>
            <span style={{ fontSize: 12 }}>{t("queue.range", { from, to, total })}</span>
            <Button type="button" variant="ghost" style={{ minHeight: 36 }} disabled={offset + PAGE_SIZE >= total} onClick={() => setOffset(offset + PAGE_SIZE)}>{t("queue.next")}</Button>
          </div>
        )}
      </div>

      <ConfirmDialog
        open={action !== null}
        title={action ? t(`dialog.${action.kind}Title`) : ""}
        description={action ? t(`dialog.${action.kind}Description`, { name: nameOf(action.item), file: action.item.filename }) : null}
        confirmLabel={action ? t(`dialog.${action.kind}Confirm`) : undefined}
        cancelLabel={t("cancelBtn")}
        danger={action?.kind === "reject"}
        requireReason={action?.kind === "reject" || action?.kind === "hold" || action?.kind === "release"}
        minReasonLength={10}
        maxReasonLength={500}
        reasonLabel={action ? t(`dialog.${action.kind === "reject" ? "reject" : "hold"}ReasonLabel`) : undefined}
        busy={busy}
        errorMessage={dialogError}
        onConfirm={(reason) => void confirm(reason)}
        onCancel={() => !busy && setAction(null)}
      >
        {action?.kind === "accept" && (
          <div style={{ display: "grid", gap: 6, marginTop: 12 }}>
            <label htmlFor="tax-proof-accept-amount" style={{ fontSize: 13, fontWeight: 600 }}>{t("dialog.amountLabel")}</label>
            <input
              id="tax-proof-accept-amount"
              type="number"
              min="0"
              step="0.01"
              value={acceptAmount}
              disabled={busy}
              onChange={(e) => setAcceptAmount(e.target.value)}
              style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
            />
            <span style={{ fontSize: 12, color: "var(--ink2)" }}>{t("dialog.amountHint")}</span>
          </div>
        )}
      </ConfirmDialog>
    </section>
  );
}
