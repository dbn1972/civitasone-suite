"use client";

/**
 * PR #2459 review B1 (ERP-head decision 2026-11-05): opening year-to-date for
 * an FY on the employee profile -- salary paid and TDS deducted by this
 * employer before payroll went live here, and previous-employer income and
 * TDS (Form 12B). Payroll staff enter it; a payroll administrator other than
 * the officer who entered it approves or rejects it (the server enforces
 * maker-checker). Only approved records feed the s.192 TDS projection, as
 * authoritative figures (no TDS is presumed once one exists).
 */
import { useCallback, useEffect, useId, useState } from "react";
import { useTranslations } from "next-intl";
import { Card, Modal } from "../../../../_components/ds";
import { rupeesToMinorString } from "@/lib/money";
import { formatMinorString } from "@/lib/payroll/runMoney";

export interface OpeningYtd {
  id: string; fy: string; source: "pre_go_live" | "prior_employer"; months: number;
  salaryMinor: string; tdsMinor: string; priorEmployerName: string | null; priorEmployerTan: string | null;
  note: string; status: "pending" | "approved" | "rejected"; decisionNote: string | null;
}

const KNOWN_ERRORS = ["OPENING_YTD_EXISTS", "OPENING_YTD_DECIDED", "MAKER_CHECKER_VIOLATION"] as const;
type KnownError = (typeof KNOWN_ERRORS)[number];

/** The current Indian financial year label (YYYY-YY) for a date. */
export function financialYearOf(d: Date): string {
  const y = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1;
  return `${y}-${String((y + 1) % 100).padStart(2, "0")}`;
}

export function EmployeeOpeningYtdCard(props: { employeeId: string; canEnter: boolean; canDecide: boolean }) {
  const { employeeId, canEnter, canDecide } = props;
  const t = useTranslations("openingYtd");
  const ids = { fy: useId(), source: useId(), months: useId(), salary: useId(), tds: useId(), name: useId(), tan: useId(), note: useId(), decision: useId(), help: useId() };
  const [rows, setRows] = useState<OpeningYtd[]>([]);
  const [open, setOpen] = useState(false);
  const [fy, setFy] = useState(financialYearOf(new Date()));
  const [source, setSource] = useState<OpeningYtd["source"]>("pre_go_live");
  const [months, setMonths] = useState("");
  const [salary, setSalary] = useState("");
  const [tds, setTds] = useState("");
  const [name, setName] = useState("");
  const [tan, setTan] = useState("");
  const [note, setNote] = useState("");
  const [decisionNote, setDecisionNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/proxy/v1/payroll/opening-ytd?employeeId=${encodeURIComponent(employeeId)}`);
      if (!res.ok) { setMessage({ kind: "error", text: t("loadError") }); return; }
      const body = (await res.json()) as { data?: unknown };
      setRows(Array.isArray(body.data) ? (body.data as OpeningYtd[]) : []);
    } catch {
      setMessage({ kind: "error", text: t("loadError") });
    }
  }, [employeeId, t]);

  useEffect(() => { void load(); }, [load]);

  const errorText = async (res: Response): Promise<string> => {
    const body = (await res.json().catch(() => null)) as { code?: string } | null;
    const code = body?.code;
    if (code && (KNOWN_ERRORS as readonly string[]).includes(code)) return t(`error.${code as KnownError}`);
    return t("error.generic");
  };

  async function submit() {
    setFormError(null);
    if (!/^\d{4}-\d{2}$/.test(fy)) { setFormError(t("fyInvalid")); return; }
    const salaryMinor = rupeesToMinorString(salary, { allowZero: true });
    const tdsMinor = rupeesToMinorString(tds, { allowZero: true });
    if (salaryMinor === null || tdsMinor === null) { setFormError(t("amountInvalid")); return; }
    const m = Number(months);
    if (source === "pre_go_live" && !(Number.isInteger(m) && m >= 1 && m <= 11)) { setFormError(t("monthsInvalid")); return; }
    if (source === "prior_employer" && name.trim().length < 2) { setFormError(t("nameRequired")); return; }
    if (note.trim().length < 10) { setFormError(t("noteRequired")); return; }
    setBusy(true);
    try {
      const res = await fetch("/api/proxy/v1/payroll/opening-ytd", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          employeeId, fy, source, months: source === "pre_go_live" ? m : 0, salaryMinor, tdsMinor, note: note.trim(),
          ...(source === "prior_employer" ? { priorEmployerName: name.trim(), ...(tan.trim() ? { priorEmployerTan: tan.trim().toUpperCase() } : {}) } : {}),
        }),
      });
      if (!res.ok) { setFormError(await errorText(res)); return; }
      setOpen(false);
      setSalary(""); setTds(""); setMonths(""); setName(""); setTan(""); setNote("");
      setMessage({ kind: "ok", text: t("submitted") });
      await load();
    } catch {
      setFormError(t("error.generic"));
    } finally {
      setBusy(false);
    }
  }

  async function decide(row: OpeningYtd, action: "approve" | "reject") {
    setMessage(null);
    if (decisionNote.trim().length < 10) { setMessage({ kind: "error", text: t("decisionNoteRequired") }); return; }
    setBusy(true);
    try {
      const res = await fetch(`/api/proxy/v1/payroll/opening-ytd/${row.id}/${action}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reason: decisionNote.trim() }),
      });
      if (!res.ok) { setMessage({ kind: "error", text: await errorText(res) }); return; }
      setDecisionNote("");
      setMessage({ kind: "ok", text: action === "approve" ? t("approved") : t("rejected") });
      await load();
    } catch {
      setMessage({ kind: "error", text: t("error.generic") });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title={t("title")} padding>
      <p style={{ margin: "0 0 10px", color: "var(--mut)", fontSize: 13 }}>{t("intro")}</p>
      {rows.length === 0 ? (
        <p style={{ margin: "0 0 10px" }}>{t("empty")}</p>
      ) : (
        <table className="table" style={{ marginBottom: 10 }}>
          <thead>
            <tr>
              <th scope="col">{t("colFy")}</th>
              <th scope="col">{t("colSource")}</th>
              <th scope="col">{t("colSalary")}</th>
              <th scope="col">{t("colTds")}</th>
              <th scope="col">{t("colStatus")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>{r.fy}</td>
                <td>{r.source === "pre_go_live" ? t("sourcePreGoLiveMonths", { months: r.months }) : t("sourcePriorEmployerName", { name: r.priorEmployerName ?? "" })}</td>
                <td>{formatMinorString(r.salaryMinor)}</td>
                <td>{formatMinorString(r.tdsMinor)}</td>
                <td>
                  {t(`status.${r.status}`)}
                  {r.status === "pending" && canDecide && (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 6 }}>
                      <button type="button" className="btn" disabled={busy} onClick={() => void decide(r, "approve")} style={{ minHeight: 44 }}>{t("approveButton", { fy: r.fy })}</button>
                      <button type="button" className="btn ghost" disabled={busy} onClick={() => void decide(r, "reject")} style={{ minHeight: 44 }}>{t("rejectButton", { fy: r.fy })}</button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {canDecide && rows.some((r) => r.status === "pending") && (
        <>
          <label htmlFor={ids.decision} className="l" style={{ display: "block", fontSize: 13 }}>{t("decisionNoteLabel")}</label>
          <input id={ids.decision} className="inp" value={decisionNote} onChange={(e) => setDecisionNote(e.target.value)} maxLength={1000} style={{ minHeight: 44, width: "100%", marginBottom: 10 }} />
        </>
      )}
      {canEnter && (
        <button type="button" className="btn" onClick={() => { setFormError(null); setOpen(true); }} style={{ minHeight: 44 }}>{t("addButton")}</button>
      )}
      {message && <p role={message.kind === "error" ? "alert" : "status"} style={{ margin: "10px 0 0", fontSize: 13 }}>{message.text}</p>}

      <Modal open={open} onClose={() => !busy && setOpen(false)} title={t("dialogTitle")} describedById={ids.help}>
        <p id={ids.help} style={{ margin: "0 0 10px", color: "var(--mut)", fontSize: 13 }}>{t("dialogHelp")}</p>
        <div style={{ display: "grid", gap: 10 }}>
          <label htmlFor={ids.fy} className="l">{t("fyLabel")}</label>
          <input id={ids.fy} className="inp" value={fy} onChange={(e) => setFy(e.target.value)} placeholder="2026-27" aria-required="true" style={{ minHeight: 44 }} />
          <label htmlFor={ids.source} className="l">{t("sourceLabel")}</label>
          <select id={ids.source} className="inp" value={source} onChange={(e) => setSource(e.target.value as OpeningYtd["source"])} style={{ minHeight: 44 }}>
            <option value="pre_go_live">{t("sourcePreGoLive")}</option>
            <option value="prior_employer">{t("sourcePriorEmployer")}</option>
          </select>
          {source === "pre_go_live" ? (
            <>
              <label htmlFor={ids.months} className="l">{t("monthsLabel")}</label>
              <input id={ids.months} className="inp" inputMode="numeric" value={months} onChange={(e) => setMonths(e.target.value)} aria-required="true" style={{ minHeight: 44 }} />
            </>
          ) : (
            <>
              <label htmlFor={ids.name} className="l">{t("nameLabel")}</label>
              <input id={ids.name} className="inp" value={name} onChange={(e) => setName(e.target.value)} maxLength={200} aria-required="true" style={{ minHeight: 44 }} />
              <label htmlFor={ids.tan} className="l">{t("tanLabel")}</label>
              <input id={ids.tan} className="inp" value={tan} onChange={(e) => setTan(e.target.value)} maxLength={10} autoComplete="off" style={{ minHeight: 44 }} />
            </>
          )}
          <label htmlFor={ids.salary} className="l">{t("salaryLabel")}</label>
          <input id={ids.salary} className="inp" inputMode="decimal" value={salary} onChange={(e) => setSalary(e.target.value)} aria-required="true" style={{ minHeight: 44 }} />
          <label htmlFor={ids.tds} className="l">{t("tdsLabel")}</label>
          <input id={ids.tds} className="inp" inputMode="decimal" value={tds} onChange={(e) => setTds(e.target.value)} aria-required="true" style={{ minHeight: 44 }} />
          <label htmlFor={ids.note} className="l">{t("noteLabel")}</label>
          <textarea id={ids.note} className="inp" value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} rows={3} aria-required="true" />
          {formError && <p role="alert" className="pill bad" style={{ width: "fit-content", margin: 0 }}>{formError}</p>}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            <button type="button" className="btn" disabled={busy} onClick={() => void submit()} style={{ minHeight: 44 }}>{t("submitButton")}</button>
            <button type="button" className="btn ghost" disabled={busy} onClick={() => setOpen(false)} style={{ minHeight: 44 }}>{t("cancelButton")}</button>
          </div>
        </div>
      </Modal>
    </Card>
  );
}
