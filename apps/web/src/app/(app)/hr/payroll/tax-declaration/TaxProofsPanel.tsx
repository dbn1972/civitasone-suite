"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { useFormError } from "@/lib/useFormError";
import { formatMoney, formatIndianDate } from "@/lib/formatters";
import { rupeesToMinorString } from "@/lib/money";
import { browserFetch, errorCodeFromResponse } from "@/lib/api/browserClient";
import {
  PROOF_LINES, PROOF_ACCEPT, PROOF_MAX_FILES, PROOF_MAX_MB, errorKeyForCode, isEmptyList, isLineFull,
  itemsForLine, openProof, uploadProof, validateProofFile, formatBytes,
  type MineResponse, type ProofItem, type ProofLine,
} from "@/lib/payroll/taxProofs";
import { Button, ConfirmDialog, StatusPill } from "../../../../_components/ds";

const NO_MESSAGE: { text: string; tone: "good" | "bad" } | null = null;
const NO_REMOVE: ProofItem | null = null;

/**
 * GAP-PAYROLL-TAX-DECLARATION-02: the employee's supporting documents (rent
 * receipts, 80C/80D/80G proofs, home-loan interest certificates) per
 * declaration line. Files go straight to private storage; a payroll officer
 * then accepts or rejects each one. A pending file can be removed.
 */
export function TaxProofsPanel({ fy }: { fy: string }) {
  const t = useTranslations("taxProofs");
  const formError = useFormError("investment proof");
  const [data, setData] = useState<MineResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [employeeOnly, setEmployeeOnly] = useState(false);
  const [busyLine, setBusyLine] = useState<ProofLine | null>(null);
  const [message, setMessage] = useState(NO_MESSAGE);
  const [removeTarget, setRemoveTarget] = useState(NO_REMOVE);
  const [removing, setRemoving] = useState(false);
  const [amounts, setAmounts] = useState<Partial<Record<ProofLine, string>>>({});
  const fileRefs = useRef<Partial<Record<ProofLine, HTMLInputElement | null>>>({});
  const idPrefix = useId();

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoadFailed(false);
    try {
      const res = await browserFetch(`v1/payroll/tax-proofs/mine?fy=${encodeURIComponent(fy)}`, { signal });
      if (res.status === 403) {
        setEmployeeOnly(true);
        return;
      }
      if (!res.ok) {
        setLoadFailed(true);
        return;
      }
      const body = (await res.json()) as Partial<MineResponse> | null;
      // A payload without the expected lists is a failed load, not a crash on `data.items.filter`.
      if (!body || !Array.isArray(body.items) || !Array.isArray(body.summary)) {
        setLoadFailed(true);
        return;
      }
      setData(body as MineResponse);
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return;
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  }, [fy]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  function errorText(code: string | null): string {
    const key = errorKeyForCode(code);
    return key ? t(`errors.${key}`, { mb: PROOF_MAX_MB, max: PROOF_MAX_FILES }) : formError.fromException("save").message;
  }

  async function onFileChosen(line: ProofLine, input: HTMLInputElement) {
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;
    setMessage(null);
    const check = validateProofFile(file);
    if (check !== "ok") {
      setMessage({ text: t(check === "size" ? "errors.tooLarge" : check === "type" ? "errors.wrongType" : "errors.emptyFile", { mb: PROOF_MAX_MB }), tone: "bad" });
      return;
    }
    const rawAmount = (amounts[line] ?? "").trim();
    const amountMinor = rawAmount ? rupeesToMinorString(rawAmount, { allowZero: true }) : null;
    if (rawAmount && amountMinor === null) {
      setMessage({ text: t("errors.invalidAmount"), tone: "bad" });
      return;
    }
    setBusyLine(line);
    try {
      const result = await uploadProof({ fy, line, file, amountMinor });
      if (!result.ok) {
        setMessage({ text: errorText(result.code), tone: "bad" });
        return;
      }
      setAmounts((a) => ({ ...a, [line]: "" }));
      setMessage({ text: t("uploadedMessage"), tone: "good" });
      // The row is created by an async consumer: refresh now and again shortly after.
      await load();
      setTimeout(() => void load(), 1500);
    } catch (caught) {
      setMessage({ text: formError.fromException("save", caught).message, tone: "bad" });
    } finally {
      setBusyLine(null);
    }
  }

  async function onView(item: ProofItem) {
    setMessage(null);
    try {
      const r = await openProof(item.id);
      if (!r.ok) setMessage({ text: t("errors.viewFailed"), tone: "bad" });
    } catch {
      setMessage({ text: t("errors.viewFailed"), tone: "bad" });
    }
  }

  async function confirmRemove() {
    if (!removeTarget) return;
    setRemoving(true);
    try {
      const res = await browserFetch(`v1/payroll/tax-proofs/${removeTarget.id}`, { method: "DELETE" });
      if (!res.ok) {
        setMessage({ text: errorText(await errorCodeFromResponse(res)), tone: "bad" });
      } else {
        setMessage({ text: t("removedMessage"), tone: "good" });
        setRemoveTarget(null);
        await load();
        setTimeout(() => void load(), 1500);
      }
    } catch (caught) {
      setMessage({ text: formError.fromException("save", caught).message, tone: "bad" });
    } finally {
      setRemoving(false);
      setRemoveTarget(null);
    }
  }

  if (loading) {
    return <div className="card"><div className="pad" style={{ textAlign: "center", padding: 24 }}>{t("loading")}</div></div>;
  }
  if (employeeOnly) {
    return <div className="card"><div className="pad" style={{ fontSize: 13, color: "var(--ink2)" }}>{t("employeeOnly")}</div></div>;
  }
  if (loadFailed || !data) {
    return (
      <div role="alert" className="card" style={{ border: "1px solid var(--bad)" }}>
        <div className="pad" style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", color: "var(--bad)", fontSize: 13 }}>
          <span>{t("loadFailed")}</span>
          <Button type="button" variant="ghost" onClick={() => { setLoading(true); void load(); }} style={{ minHeight: 32 }}>{t("retry")}</Button>
        </div>
      </div>
    );
  }

  return (
    <section className="card" aria-labelledby={`${idPrefix}-h`} style={{ marginBottom: 16 }}>
      <div className="card-h"><h3 id={`${idPrefix}-h`}>{t("heading", { fy })}</h3></div>
      <div className="pad" style={{ display: "grid", gap: 16 }}>
        <p style={{ fontSize: 12, color: "var(--ink2)", margin: 0 }}>
          {t("intro", { mb: PROOF_MAX_MB, max: PROOF_MAX_FILES })}
          {data.verifiedTdsEnabled && data.cutoffDate ? ` ${t("introCutoff", { date: formatIndianDate(data.cutoffDate) })}` : ""}
        </p>

        {message && (
          <p role="status" aria-live="polite" className={`pill ${message.tone}`} style={{ width: "fit-content", margin: 0 }}>{message.text}</p>
        )}

        {PROOF_LINES.map((line) => {
          const files = itemsForLine(data.items, line);
          const summary = data.summary.find((s) => s.line === line);
          const full = isLineFull(summary, data.items, line);
          const amountId = `${idPrefix}-${line}-amt`;
          const fileId = `${idPrefix}-${line}-file`;
          return (
            <div key={line} style={{ border: "1px solid var(--line2)", borderRadius: 10, padding: "12px 14px", display: "grid", gap: 10 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                <strong style={{ fontSize: 14 }}>{t(`lines.${line}`)}</strong>
                <span style={{ fontSize: 12, color: "var(--ink2)" }}>
                  {summary?.declaredMinor != null
                    ? t("declaredVsVerified", { declared: formatMoney(summary.declaredMinor), verified: formatMoney(summary.verifiedMinor) })
                    : t("verifiedOnly", { verified: formatMoney(summary?.verifiedMinor ?? "0") })}
                </span>
              </div>

              {isEmptyList(files) ? (
                <p style={{ fontSize: 12, color: "var(--ink2)", margin: 0 }}>{t("noFiles")}</p>
              ) : (
                <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 8 }}>
                  {files.map((f) => (
                    <li key={f.id} style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", fontSize: 13 }}>
                      <span style={{ wordBreak: "break-all" }}>{f.filename}</span>
                      <span style={{ color: "var(--ink2)", fontSize: 12 }}>{formatBytes(f.sizeBytes)}{f.amountMinor ? ` · ${formatMoney(f.amountMinor)}` : ""}</span>
                      <StatusPill status={f.status} label={t(`status.${f.status}`)} />
                      {f.status === "rejected" && f.rejectionReason && (
                        <span style={{ fontSize: 12, color: "var(--bad)" }}>{t("rejectedReason", { reason: f.rejectionReason })}</span>
                      )}
                      <Button type="button" variant="ghost" style={{ minHeight: 32 }} aria-label={t("viewAria", { name: f.filename })} onClick={() => void onView(f)}>{t("viewBtn")}</Button>
                      {f.status === "pending" && (
                        <Button type="button" variant="ghost" style={{ minHeight: 32 }} aria-label={t("removeAria", { name: f.filename })} onClick={() => setRemoveTarget(f)}>{t("removeBtn")}</Button>
                      )}
                    </li>
                  ))}
                </ul>
              )}

              <div style={{ display: "flex", gap: 10, alignItems: "end", flexWrap: "wrap" }}>
                <div style={{ display: "grid", gap: 4 }}>
                  <label htmlFor={amountId} style={{ fontSize: 12, fontWeight: 600 }}>{t("amountLabel")}</label>
                  <input
                    id={amountId}
                    type="number"
                    min="0"
                    step="0.01"
                    value={amounts[line] ?? ""}
                    disabled={full || busyLine !== null}
                    onChange={(e) => setAmounts((a) => ({ ...a, [line]: e.target.value }))}
                    style={{ padding: "8px 10px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 40, width: 160 }}
                  />
                </div>
                <input
                  id={fileId}
                  ref={(el) => { fileRefs.current[line] = el; }}
                  type="file"
                  accept={PROOF_ACCEPT}
                  hidden
                  onChange={(e) => void onFileChosen(line, e.currentTarget)}
                />
                <Button
                  type="button"
                  variant="secondary"
                  style={{ minHeight: 40 }}
                  disabled={full || busyLine !== null}
                  aria-label={t("addFileAria", { line: t(`lines.${line}`) })}
                  onClick={() => fileRefs.current[line]?.click()}
                >
                  {busyLine === line ? t("uploading") : full ? t("lineFull") : t("addFileBtn")}
                </Button>
              </div>
            </div>
          );
        })}
      </div>

      <ConfirmDialog
        open={removeTarget !== null}
        title={t("removeTitle")}
        description={removeTarget ? t("removeDescription", { name: removeTarget.filename }) : null}
        confirmLabel={t("removeBtn")}
        cancelLabel={t("cancelBtn")}
        danger
        busy={removing}
        onConfirm={() => void confirmRemove()}
        onCancel={() => !removing && setRemoveTarget(null)}
      />
    </section>
  );
}
