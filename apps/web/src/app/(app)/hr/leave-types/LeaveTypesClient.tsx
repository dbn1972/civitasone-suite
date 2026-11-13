"use client";

/**
 * S8-G3 -- leave types as data. Lists every leave type with its live allocations and open
 * applications, creates and edits types, and retires one through a two-person approval:
 * "Deactivate" shows exactly what will be ended (a dry run), a second admin approves, and only
 * then are the type hidden and its allocations ended. Nothing here is a delete: history stays.
 *
 * Accessibility: real <table> with a caption and column headers, every control labelled, state
 * conveyed by text (not colour alone), results announced through role="status"/"alert".
 */
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { PageHeader, Card, Button, ConfirmDialog, EmptyState, SkeletonTable } from "../../../_components/ds";
import { useFormError } from "@/lib/useFormError";

type LeaveType = {
  id: string; code: string; name: string; maxDays: number; isEncashable: boolean; carryForward: boolean;
  lopFractionBps: number; isActive: boolean; systemCode: string | null; category: string | null;
  genderRestriction: string | null; description: string | null; version: number;
  activeAllocations: number; openApplications: number; totalApplications: number; pendingChangeId: string | null;
};
type Change = {
  id: string; action?: string; leaveTypeCode: string | null; leaveTypeName: string | null; status: string; reason: string;
  impact: { activeAllocations?: number; employeesWithAllocations?: number; balanceDaysOnLiveAllocations?: number; balanceDays?: number; fy?: string };
  createdAt: string;
};
type Impact = { activeAllocations: number; employeesWithAllocations: number; balanceDaysOnLiveAllocations: number; openApplications: number };
type DryRun = { impact: Impact; blockers: Array<{ code: string; message: string }> };

const API = "/api/proxy/v1/hrms";
const SYSTEM_CODES = ["CL", "EL", "HPL", "COML", "ML", "PL", "CCL", "SL", "SCL", "CO"];
const CATEGORIES = ["paid", "unpaid", "statutory", "comp_off"];
const json = { "content-type": "application/json" };
const idem = () => ({ ...json, "x-idempotency-key": crypto.randomUUID() });

type Form = {
  id: string | null; code: string; name: string; maxDays: string; lopFractionBps: string; category: string;
  systemCode: string; genderRestriction: string; isEncashable: boolean; carryForward: boolean; description: string; version: number;
};
const BLANK: Form = {
  id: null, code: "", name: "", maxDays: "0", lopFractionBps: "", category: "", systemCode: "", genderRestriction: "",
  isEncashable: false, carryForward: false, description: "", version: 0,
};

export default function LeaveTypesClient() {
  const t = useTranslations("leaveTypes");
  const err = useFormError("leave type");
  const uid = useId();
  const [types, setTypes] = useState<LeaveType[]>([]);
  const [changes, setChanges] = useState<Change[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [showInactive, setShowInactive] = useState(true);
  const [customRules, setCustomRules] = useState(false);
  const [form, setForm] = useState<Form | null>(null);
  const [fieldMsg, setFieldMsg] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [target, setTarget] = useState<{ type: LeaveType; dry: DryRun } | null>(null);
  const [rejecting, setRejecting] = useState<Change | null>(null);
  const [dialogError, setDialogError] = useState<string | undefined>();
  const formRef = useRef<HTMLFormElement>(null);

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const [a, b, c] = await Promise.all([
        fetch(`${API}/admin/leave-types?includeInactive=true`, { signal }),
        fetch(`${API}/leave-type-changes?status=pending`, { signal }),
        fetch(`${API}/leave-config/custom-rules`, { signal }),
      ]);
      if (!a.ok) { await err.fromResponse(a, "load"); setState("error"); return; }
      setTypes(((await a.json()) as { data: LeaveType[] }).data ?? []);
      setChanges(b.ok ? ((await b.json()) as { data: Change[] }).data ?? [] : []);
      setCustomRules(c.ok ? ((await c.json()) as { enabled: boolean }).enabled === true : false);
      setState("ready");
    } catch (e) {
      if (e instanceof Error && e.name === "AbortError") return;
      err.fromException("load", e);
      setState("error");
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- err is stable enough; only reload on demand
  }, []);

  useEffect(() => {
    const c = new AbortController();
    void load(c.signal);
    return () => c.abort();
  }, [load]);

  // A 202 means "queued": re-read after a beat so the list shows the applied change.
  const settle = useCallback((message: string) => {
    setNote(message);
    setTimeout(() => { void load(); }, 900);
  }, [load]);

  async function codeOf(res: Response): Promise<string | null> {
    try { return ((await res.clone().json()) as { code?: string }).code ?? null; } catch { return null; }
  }
  async function failure(res: Response): Promise<string> {
    const code = await codeOf(res);
    if (code && t.has(`errors.${code}`)) return t(`errors.${code}`);
    return (await err.fromResponse(res, "save")).message;
  }

  function startEdit(lt: LeaveType) {
    setNote(""); setFieldMsg("");
    setForm({
      id: lt.id, code: lt.code, name: lt.name, maxDays: String(lt.maxDays), lopFractionBps: String(lt.lopFractionBps),
      category: lt.category ?? "", systemCode: lt.systemCode ?? "", genderRestriction: lt.genderRestriction ?? "",
      isEncashable: lt.isEncashable, carryForward: lt.carryForward, description: lt.description ?? "", version: lt.version,
    });
    setTimeout(() => formRef.current?.querySelector<HTMLElement>("input,select")?.focus(), 0);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!form) return;
    setFieldMsg(""); setNote("");
    const maxDays = Number(form.maxDays);
    if (!form.name.trim()) { setFieldMsg(t("errors.nameRequired")); return; }
    if (!form.id && !/^[A-Za-z0-9_-]{1,16}$/.test(form.code)) { setFieldMsg(t("errors.codeInvalid")); return; }
    if (!Number.isInteger(maxDays) || maxDays < 0) { setFieldMsg(t("errors.maxDaysInvalid")); return; }
    // Payroll treats an unclassified type as fully unpaid; make the admin say so on purpose.
    if (form.lopFractionBps === "") { setFieldMsg(t("errors.lopRequired")); return; }
    const lop = Number(form.lopFractionBps);
    if (!Number.isInteger(lop) || lop < 0 || lop > 10000) { setFieldMsg(t("errors.lopInvalid")); return; }
    setBusy(true);
    try {
      const shared = {
        name: form.name.trim(), maxDays, isEncashable: form.isEncashable, carryForward: form.carryForward, lopFractionBps: lop,
        category: form.category || null, systemCode: form.systemCode || null,
        genderRestriction: form.genderRestriction || null, description: form.description.trim() || null,
      };
      const res = form.id
        ? await fetch(`${API}/leave-types/${form.id}`, { method: "PATCH", headers: idem(), body: JSON.stringify({ ...shared, expectedVersion: form.version }) })
        : await fetch(`${API}/leave-types`, { method: "POST", headers: idem(), body: JSON.stringify({ code: form.code.trim(), ...shared }) });
      if (!res.ok) { setFieldMsg(await failure(res)); return; }
      setForm(null);
      settle(form.id ? t("savedEdit") : t("savedCreate"));
    } catch (caught) {
      setFieldMsg(err.fromException("save", caught).message);
    } finally { setBusy(false); }
  }

  async function openDeactivate(lt: LeaveType) {
    setNote(""); setDialogError(undefined);
    const res = await fetch(`${API}/leave-types/${lt.id}/deactivate`, {
      method: "POST", headers: json, body: JSON.stringify({ reason: "dry run for impact preview", dryRun: true }),
    });
    if (!res.ok) { setNote(await failure(res)); return; }
    setTarget({ type: lt, dry: (await res.json()) as DryRun });
  }

  async function confirmDeactivate(reason?: string) {
    if (!target) return;
    setBusy(true); setDialogError(undefined);
    try {
      const res = await fetch(`${API}/leave-types/${target.type.id}/deactivate`, { method: "POST", headers: idem(), body: JSON.stringify({ reason: reason ?? "" }) });
      if (!res.ok) { setDialogError(await failure(res)); return; }
      setTarget(null);
      settle(t("requested"));
    } finally { setBusy(false); }
  }

  async function decide(c: Change, decision: "approve" | "reject", reason?: string) {
    setBusy(true); setDialogError(undefined);
    try {
      const res = await fetch(`${API}/leave-type-changes/${c.id}/${decision}`, { method: "POST", headers: idem(), body: JSON.stringify(reason ? { note: reason } : {}) });
      if (!res.ok) { const m = await failure(res); if (decision === "reject") setDialogError(m); else setNote(m); return; }
      setRejecting(null);
      settle(decision === "approve" ? t("approved") : t("rejected"));
    } finally { setBusy(false); }
  }

  async function reactivate(lt: LeaveType) {
    setNote("");
    const res = await fetch(`${API}/leave-types/${lt.id}/reactivate`, { method: "POST", headers: idem(), body: "{}" });
    if (!res.ok) { setNote(await failure(res)); return; }
    settle(t("reactivated"));
  }

  async function toggleCustomRules(next: boolean) {
    setNote("");
    const res = await fetch(`${API}/leave-config/custom-rules`, { method: "PUT", headers: idem(), body: JSON.stringify({ enabled: next }) });
    if (!res.ok) { setNote(await failure(res)); return; }
    setCustomRules(next);
    setNote(t("switchSaved"));
  }

  const rows = types.filter((x) => showInactive || x.isActive);
  const statusText = (lt: LeaveType) => (lt.pendingChangeId ? t("statusPending") : lt.isActive ? t("statusActive") : t("statusInactive"));
  const label = (key: string, value: string) => (t.has(`${key}.${value}`) ? t(`${key}.${value}`) : value.replace(/_/g, " "));

  return (
    <div className="page-main wrap">
      <PageHeader title={t("title")} subtitle={t("subtitle")} back="/hr" backLabel={t("backToHr")}
        actions={<Button onClick={() => { setNote(""); setFieldMsg(""); setForm({ ...BLANK }); setTimeout(() => formRef.current?.querySelector<HTMLElement>("input")?.focus(), 0); }}>{t("addType")}</Button>} />

      <div role="status" aria-live="polite" style={{ minHeight: 20, fontSize: 13, color: "var(--ink2)" }}>{note}</div>

      <Card title={t("switchTitle")}>
        <div className="pad" style={{ display: "grid", gap: 8 }}>
          <p style={{ margin: 0, fontSize: 13, color: "var(--ink2)" }}>{t("switchHelp")}</p>
          <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 14 }}>
            <input type="checkbox" checked={customRules} onChange={(e) => void toggleCustomRules(e.target.checked)} />
            {t("switchLabel")}
          </label>
        </div>
      </Card>

      {form && (
        <Card title={form.id ? t("editTitle", { code: form.code }) : t("addTitle")}>
          <form ref={formRef} onSubmit={(e) => void save(e)} className="pad" style={{ display: "grid", gap: 12, maxWidth: 640 }} noValidate>
            {!form.id && (
              <div>
                <label htmlFor={`${uid}-code`}>{t("fCode")}</label>
                <input id={`${uid}-code`} value={form.code} maxLength={16} aria-describedby={`${uid}-code-h`} onChange={(e) => setForm({ ...form, code: e.target.value })} />
                <div id={`${uid}-code-h`} style={{ fontSize: 12, color: "var(--ink2)" }}>{t("fCodeHelp")}</div>
              </div>
            )}
            <div>
              <label htmlFor={`${uid}-name`}>{t("fName")}</label>
              <input id={`${uid}-name`} value={form.name} maxLength={128} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div>
              <label htmlFor={`${uid}-max`}>{t("fMaxDays")}</label>
              <input id={`${uid}-max`} inputMode="numeric" value={form.maxDays} onChange={(e) => setForm({ ...form, maxDays: e.target.value })} />
            </div>
            <div>
              <label htmlFor={`${uid}-lop`}>{t("fLop")}</label>
              <select id={`${uid}-lop`} value={form.lopFractionBps} aria-describedby={`${uid}-lop-h`} onChange={(e) => setForm({ ...form, lopFractionBps: e.target.value })}>
                <option value="">{t("lopChoose")}</option>
                <option value="0">{t("lopPaid")}</option>
                <option value="5000">{t("lopHalf")}</option>
                <option value="10000">{t("lopUnpaid")}</option>
              </select>
              <div id={`${uid}-lop-h`} style={{ fontSize: 12, color: "var(--ink2)" }}>{t("fLopHelp")}</div>
            </div>
            <div>
              <label htmlFor={`${uid}-cat`}>{t("fCategory")}</label>
              <select id={`${uid}-cat`} value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
                <option value="">{t("none")}</option>
                {CATEGORIES.map((c) => <option key={c} value={c}>{label("categories", c)}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor={`${uid}-sys`}>{t("fSystem")}</label>
              <select id={`${uid}-sys`} value={form.systemCode} aria-describedby={`${uid}-sys-h`} onChange={(e) => setForm({ ...form, systemCode: e.target.value })}>
                <option value="">{t("systemNone")}</option>
                {SYSTEM_CODES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
              <div id={`${uid}-sys-h`} style={{ fontSize: 12, color: "var(--ink2)" }}>{t("fSystemHelp")}</div>
            </div>
            <div>
              <label htmlFor={`${uid}-gen`}>{t("fGender")}</label>
              <select id={`${uid}-gen`} value={form.genderRestriction} onChange={(e) => setForm({ ...form, genderRestriction: e.target.value })}>
                <option value="">{t("genderAll")}</option>
                <option value="female">{t("genderFemale")}</option>
                <option value="male">{t("genderMale")}</option>
              </select>
            </div>
            <fieldset style={{ border: 0, padding: 0, margin: 0, display: "grid", gap: 6 }}>
              <legend style={{ fontSize: 13 }}>{t("fFlags")}</legend>
              <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input type="checkbox" checked={form.isEncashable} onChange={(e) => setForm({ ...form, isEncashable: e.target.checked })} />{t("fEncashable")}
              </label>
              <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input type="checkbox" checked={form.carryForward} onChange={(e) => setForm({ ...form, carryForward: e.target.checked })} />{t("fCarry")}
              </label>
            </fieldset>
            <div>
              <label htmlFor={`${uid}-desc`}>{t("fDescription")}</label>
              <textarea id={`${uid}-desc`} rows={2} maxLength={1000} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </div>
            <div role="alert" style={{ color: "var(--bad)", fontSize: 13, minHeight: 18 }}>{fieldMsg}</div>
            <div style={{ display: "flex", gap: 8 }}>
              <Button type="submit" disabled={busy}>{busy ? t("saving") : t("save")}</Button>
              <Button type="button" variant="secondary" onClick={() => { setForm(null); setFieldMsg(""); }}>{t("cancel")}</Button>
            </div>
          </form>
        </Card>
      )}

      {changes.length > 0 && (
        <Card title={t("pendingTitle", { count: changes.length })}>
          <div className="pad" style={{ display: "grid", gap: 10 }}>
            <p style={{ margin: 0, fontSize: 13, color: "var(--ink2)" }}>{t("pendingHelp")}</p>
            <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 10 }}>
              {changes.map((c) => (
                <li key={c.id} style={{ border: "1px solid var(--line)", borderRadius: 8, padding: 12, display: "grid", gap: 6 }}>
                  {c.action === "end_allocation" || c.action === "reinstate_allocation" ? (
                    <>
                      <strong>{t(c.action === "end_allocation" ? "pendingItemEnd" : "pendingItemReinstate", { code: c.leaveTypeCode ?? "?", fy: c.impact.fy ?? "" })}</strong>
                      <span style={{ fontSize: 13 }}>{t("pendingAllocDays", { days: c.impact.balanceDays ?? 0 })}</span>
                    </>
                  ) : (
                    <>
                      <strong>{t("pendingItem", { code: c.leaveTypeCode ?? "?", name: c.leaveTypeName ?? "" })}</strong>
                      <span style={{ fontSize: 13 }}>{t("pendingImpact", { allocations: c.impact.activeAllocations ?? 0, employees: c.impact.employeesWithAllocations ?? 0, days: c.impact.balanceDaysOnLiveAllocations ?? 0 })}</span>
                    </>
                  )}
                  <span style={{ fontSize: 13, color: "var(--ink2)" }}>{t("pendingReason", { reason: c.reason })}</span>
                  <div style={{ display: "flex", gap: 8 }}>
                    <Button size="sm" disabled={busy} onClick={() => void decide(c, "approve")}>{t("approve")}<span className="sr-only"> {c.leaveTypeCode}</span></Button>
                    <Button size="sm" variant="secondary" disabled={busy} onClick={() => { setDialogError(undefined); setRejecting(c); }}>{t("reject")}<span className="sr-only"> {c.leaveTypeCode}</span></Button>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </Card>
      )}

      <Card>
        <div className="pad" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 14 }}>
            <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />{t("showInactive")}
          </label>
        </div>
        {state === "loading" && <SkeletonTable rows={5} />}
        {state === "error" && <p role="alert" className="pad" style={{ color: "var(--bad)" }}>{err.message || t("loadFailed")}</p>}
        {state === "ready" && rows.length === 0 && <EmptyState title={t("emptyTitle")} />}
        {state === "ready" && rows.length > 0 && (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <caption className="sr-only">{t("tableCaption")}</caption>
              <thead>
                <tr>
                  {["colCode", "colName", "colBuiltIn", "colCategory", "colAllocs", "colOpen", "colStatus", "colActions"].map((k) => (
                    <th key={k} scope="col" style={{ textAlign: "start", padding: "8px 10px", fontSize: 12 }}>{t(k)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((lt) => (
                  <tr key={lt.id} style={{ borderTop: "1px solid var(--line)" }}>
                    <th scope="row" style={{ textAlign: "start", padding: "8px 10px" }}>{lt.code}</th>
                    <td style={{ padding: "8px 10px" }}>{lt.name}</td>
                    <td style={{ padding: "8px 10px" }}>{lt.systemCode ?? t("custom")}</td>
                    <td style={{ padding: "8px 10px" }}>{lt.category ? label("categories", lt.category) : "—"}</td>
                    <td style={{ padding: "8px 10px" }}>{lt.activeAllocations}</td>
                    <td style={{ padding: "8px 10px" }}>{lt.openApplications}</td>
                    <td style={{ padding: "8px 10px" }}>{statusText(lt)}</td>
                    <td style={{ padding: "8px 10px", display: "flex", gap: 6, flexWrap: "wrap" }}>
                      {lt.isActive && <Button size="sm" variant="secondary" onClick={() => startEdit(lt)}>{t("edit")}<span className="sr-only"> {lt.code}</span></Button>}
                      {lt.isActive && !lt.pendingChangeId && <Button size="sm" variant="secondary" onClick={() => void openDeactivate(lt)}>{t("deactivate")}<span className="sr-only"> {lt.code}</span></Button>}
                      {!lt.isActive && <Button size="sm" variant="secondary" onClick={() => void reactivate(lt)}>{t("reactivate")}<span className="sr-only"> {lt.code}</span></Button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <ConfirmDialog
        open={target !== null}
        title={t("deactivateTitle", { code: target?.type.code ?? "" })}
        confirmLabel={t("sendForApproval")}
        danger
        requireReason
        minReasonLength={10}
        maxReasonLength={500}
        reasonLabel={t("reasonLabel")}
        busy={busy}
        errorMessage={dialogError}
        description={target ? (
          <div style={{ display: "grid", gap: 6 }}>
            <p style={{ margin: 0 }}>{t("deactivateImpact", { allocations: target.dry.impact.activeAllocations, employees: target.dry.impact.employeesWithAllocations, days: target.dry.impact.balanceDaysOnLiveAllocations })}</p>
            <p style={{ margin: 0 }}>{t("deactivateKeeps")}</p>
            {target.dry.blockers.length > 0 && <p role="alert" style={{ margin: 0, color: "var(--bad)" }}>{t("errors.OPEN_APPLICATIONS")}</p>}
          </div>
        ) : ""}
        onConfirm={(reason) => void confirmDeactivate(reason)}
        onCancel={() => !busy && setTarget(null)}
      />
      <ConfirmDialog
        open={rejecting !== null}
        title={t("rejectTitle", { code: rejecting?.leaveTypeCode ?? "" })}
        confirmLabel={t("reject")}
        requireReason
        minReasonLength={3}
        reasonLabel={t("rejectReasonLabel")}
        busy={busy}
        errorMessage={dialogError}
        description={t("rejectHelp")}
        onConfirm={(reason) => rejecting && void decide(rejecting, "reject", reason)}
        onCancel={() => !busy && setRejecting(null)}
      />
    </div>
  );
}
