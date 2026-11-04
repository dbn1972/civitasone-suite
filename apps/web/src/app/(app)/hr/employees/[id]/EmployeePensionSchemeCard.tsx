"use client";

import { useCallback, useId, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Card, Modal } from "../../../../_components/ds";
import { formatIndianDate } from "@/lib/formatters";

const SCHEMES = ["GPF", "NPS", "EPF", "UPS"] as const;
type Scheme = (typeof SCHEMES)[number];
const KNOWN_ERRORS = [
  "PENSION_SCHEME_UNCHANGED", "PENSION_SCHEME_CHANGE_PENDING", "PENSION_SCHEME_CHANGE_NOT_PENDING",
  "PENSION_SCHEME_EFFECTIVE_BEFORE_JOINING", "PENSION_SCHEME_EFFECTIVE_NOT_AFTER_LAST", "UAN_REQUIRED",
  "MAKER_CHECKER_VIOLATION", "EMPLOYEE_EXITED",
  // Review SF5: outside the eligibility matrix / override by a non-super_admin.
  "PENSION_SCHEME_NOT_ALLOWED", "PENSION_SCHEME_OVERRIDE_FORBIDDEN",
] as const;
type KnownError = (typeof KNOWN_ERRORS)[number];

export interface SchemeChange {
  id: string; fromScheme: string; toScheme: string; effectiveFrom: string; reason: string;
  status: "pending" | "approved" | "rejected"; kind?: string; decisionNote?: string | null;
}

/**
 * UAT b18 (ERP-head decision 2026-11-05): pension scheme on the employee
 * profile. HR staff request a change (scheme, effective month, reason, UAN
 * for EPF) through POST .../pension-scheme-changes; an HR administrator other
 * than the requester approves or rejects the pending one (the server enforces
 * maker-checker and answers MAKER_CHECKER_VIOLATION otherwise).
 */
export function EmployeePensionSchemeCard(props: {
  employeeId: string; currentScheme?: string; incomplete?: string[]; canRequest: boolean; canDecide: boolean;
  /** History loaded by the page (server side, no-store); null when it could not be loaded. */
  initialChanges: SchemeChange[] | null;
}) {
  const { employeeId, currentScheme, incomplete, canRequest, canDecide, initialChanges } = props;
  const t = useTranslations("pensionSchemeChange");
  const router = useRouter();
  const ids = { scheme: useId(), month: useId(), reason: useId(), uan: useId(), note: useId(), help: useId() };
  const [changes, setChanges] = useState<SchemeChange[]>(Array.isArray(initialChanges) ? initialChanges : []);
  const [open, setOpen] = useState(false);
  // Review nit: open on a scheme other than the current one.
  const [scheme, setScheme] = useState<Scheme>(SCHEMES.find((s) => s !== currentScheme) ?? "EPF");
  const [month, setMonth] = useState("");
  const [reason, setReason] = useState("");
  const [uan, setUan] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(
    initialChanges === null ? { kind: "error", text: t("loadError") } : null,
  );

  // Re-read after a request / decision (the page loaded the first copy).
  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/proxy/v1/hrms/employees/${employeeId}/pension-scheme-changes`);
      if (!res.ok) {
        setMessage({ kind: "error", text: t("loadError") });
        return;
      }
      const body = (await res.json()) as { data?: unknown };
      setChanges(Array.isArray(body.data) ? (body.data as SchemeChange[]) : []);
    } catch {
      setMessage({ kind: "error", text: t("loadError") });
    }
  }, [employeeId, t]);

  const errorText = async (res: Response): Promise<string> => {
    const body = (await res.json().catch(() => null)) as { code?: string } | null;
    const code = body?.code;
    if (code && (KNOWN_ERRORS as readonly string[]).includes(code)) return t(`error.${code as KnownError}`);
    if (code === "VALIDATION_FAILED") return t("error.REASON_REQUIRED");
    return t("error.generic");
  };

  async function submitRequest() {
    setFormError(null);
    if (!/^\d{4}-\d{2}$/.test(month)) { setFormError(t("monthRequired")); return; }
    if (reason.trim().length < 10) { setFormError(t("error.REASON_REQUIRED")); return; }
    if (scheme === "EPF" && uan.trim() !== "" && !/^\d{12}$/.test(uan.trim())) { setFormError(t("uanInvalid")); return; }
    setBusy(true);
    try {
      const res = await fetch(`/api/proxy/v1/hrms/employees/${employeeId}/pension-scheme-changes`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          toScheme: scheme, effectiveFrom: `${month}-01`, reason: reason.trim(),
          ...(scheme === "EPF" && uan.trim() !== "" ? { uanNumber: uan.trim() } : {}),
        }),
      });
      if (!res.ok) { setFormError(await errorText(res)); return; }
      setOpen(false);
      setReason(""); setUan(""); setMonth("");
      setMessage({ kind: "ok", text: t("submitted") });
      await load();
    } catch {
      setFormError(t("error.generic"));
    } finally {
      setBusy(false);
    }
  }

  async function decide(change: SchemeChange, action: "approve" | "reject") {
    setMessage(null);
    if (action === "reject" && note.trim().length < 3) { setMessage({ kind: "error", text: t("rejectNoteRequired") }); return; }
    setBusy(true);
    try {
      const res = await fetch(`/api/proxy/v1/hrms/pension-scheme-changes/${change.id}/${action}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(note.trim() ? { note: note.trim() } : {}),
      });
      if (!res.ok) { setMessage({ kind: "error", text: await errorText(res) }); return; }
      setNote("");
      setMessage({ kind: "ok", text: action === "approve" ? t("approved") : t("rejected") });
      await load();
      router.refresh();
    } catch {
      setMessage({ kind: "error", text: t("error.generic") });
    } finally {
      setBusy(false);
    }
  }

  const schemeLabel = (s: string) => (s === "NONE" ? t("schemes.NONE") : (SCHEMES as readonly string[]).includes(s) ? t(`schemes.${s as Scheme}`) : s);
  const day = (iso: string) => formatIndianDate(iso);
  const pending = changes.find((c) => c.status === "pending") ?? null;
  const decided = changes.filter((c) => c.status !== "pending");

  return (
    <Card title={t("title")} padding>
      <p style={{ margin: "0 0 8px" }}>
        <span style={{ color: "var(--mut)", fontSize: 13 }}>{t("currentLabel")}: </span>
        <strong>{currentScheme ? schemeLabel(currentScheme) : t("notRecorded")}</strong>
      </p>
      {incomplete?.includes("UAN_MISSING") && (
        <p role="note" className="pill bad" style={{ width: "fit-content", margin: "0 0 10px" }}>{t("uanMissingWarning")}</p>
      )}

      {pending && (
        <section aria-label={t("pendingTitle")} style={{ border: "1px solid var(--line)", borderRadius: 10, padding: 12, margin: "8px 0" }}>
          <h3 style={{ margin: "0 0 6px", fontSize: 14 }}>{t("pendingTitle")}</h3>
          <p style={{ margin: "0 0 4px" }}>{t("changeLine", { from: schemeLabel(pending.fromScheme), to: schemeLabel(pending.toScheme), date: day(pending.effectiveFrom) })}</p>
          <p style={{ margin: "0 0 8px", color: "var(--mut)", fontSize: 13 }}>{t("reasonText", { reason: pending.reason })}</p>
          {canDecide && (
            <>
              <label htmlFor={ids.note} className="l" style={{ display: "block", fontSize: 13 }}>{t("decisionNoteLabel")}</label>
              <input id={ids.note} className="inp" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} style={{ minHeight: 44, width: "100%" }} />
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 8 }}>
                <button type="button" className="btn" disabled={busy} onClick={() => void decide(pending, "approve")} style={{ minHeight: 44 }}>{t("approveButton")}</button>
                <button type="button" className="btn ghost" disabled={busy} onClick={() => void decide(pending, "reject")} style={{ minHeight: 44 }}>{t("rejectButton")}</button>
              </div>
            </>
          )}
        </section>
      )}

      {canRequest && !pending && (
        <button type="button" className="btn" onClick={() => { setFormError(null); setOpen(true); }} style={{ minHeight: 44 }}>{t("changeButton")}</button>
      )}

      {decided.length > 0 && (
        <>
          <h3 style={{ margin: "14px 0 6px", fontSize: 14 }}>{t("historyTitle")}</h3>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>
            {decided.map((c) => (
              <li key={c.id}>
                {t("changeLine", { from: schemeLabel(c.fromScheme), to: schemeLabel(c.toScheme), date: day(c.effectiveFrom) })} — {t(`status.${c.status}`)}
              </li>
            ))}
          </ul>
        </>
      )}

      {message && <p role={message.kind === "error" ? "alert" : "status"} style={{ margin: "10px 0 0", fontSize: 13 }}>{message.text}</p>}

      <Modal open={open} onClose={() => !busy && setOpen(false)} title={t("dialogTitle")} describedById={ids.help}>
        <p id={ids.help} style={{ margin: "0 0 10px", color: "var(--mut)", fontSize: 13 }}>{t("dialogHelp")}</p>
        <div style={{ display: "grid", gap: 10 }}>
          <label htmlFor={ids.scheme} className="l">{t("schemeLabel")}</label>
          <select id={ids.scheme} className="inp" value={scheme} onChange={(e) => setScheme(e.target.value as Scheme)} style={{ minHeight: 44 }}>
            {SCHEMES.map((s) => <option key={s} value={s}>{schemeLabel(s)}</option>)}
          </select>
          <label htmlFor={ids.month} className="l">{t("effectiveMonthLabel")}</label>
          <input id={ids.month} type="month" className="inp" value={month} onChange={(e) => setMonth(e.target.value)} aria-required="true" style={{ minHeight: 44 }} />
          <label htmlFor={ids.reason} className="l">{t("reasonLabel")}</label>
          <textarea id={ids.reason} className="inp" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} rows={3} aria-required="true" />
          {scheme === "EPF" && (
            <>
              <label htmlFor={ids.uan} className="l">{t("uanLabel")}</label>
              <input id={ids.uan} className="inp" inputMode="numeric" value={uan} onChange={(e) => setUan(e.target.value)} maxLength={12} autoComplete="off" style={{ minHeight: 44 }} />
            </>
          )}
          {formError && <p role="alert" className="pill bad" style={{ width: "fit-content", margin: 0 }}>{formError}</p>}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            <button type="button" className="btn" disabled={busy} onClick={() => void submitRequest()} style={{ minHeight: 44 }}>{t("submitButton")}</button>
            <button type="button" className="btn ghost" disabled={busy} onClick={() => setOpen(false)} style={{ minHeight: 44 }}>{t("cancelButton")}</button>
          </div>
        </div>
      </Modal>
    </Card>
  );
}
