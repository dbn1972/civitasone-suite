"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, ConfirmDialog, DataTable, EmptyState, Field, Input, RefreshErrorState, StatusPill } from "../../../_components/ds";
import { useFormError } from "@/lib/useFormError";
import { toHumanError } from "@/lib/messages";
import {
  BAND_CODE_PATTERN, MAX_BAND_CODE_LENGTH, MAX_BAND_RANK, MIN_BAND_RANK,
  formatMinorAsRupees, rupeesToMinor, type GradeBand, type PayScaleKind,
} from "@/lib/gradeBands";

type Row = GradeBand & Record<string, unknown>;
type FormState = { code: string; name: string; rank: string; track: string; ctcMin: string; ctcMax: string; notice: string };
type FormErrors = Partial<Record<keyof FormState, string>>;
const EMPTY_FORM: FormState = { code: "", name: "", rank: "", track: "", ctcMin: "", ctcMax: "", notice: "" };

interface Props {
  initialBands: GradeBand[];
  loadFailed: boolean;
  canManage: boolean;
  canSwitchScale: boolean;
  payScale: PayScaleKind;
}

/**
 * S8-G4 admin screen for a tenant's private grade bands. Every write is a 202 command, so rows are updated
 * optimistically and the page is refreshed; the status line says "submitted", never "done".
 * Accessibility: every control has a visible label, hints/errors are wired with aria-describedby, the
 * status line is a polite live region, row actions carry the band code in their accessible name, and the
 * form heading takes focus when Edit is chosen so keyboard and screen-reader users land on the form.
 */
export function GradeBandsAdmin({ initialBands, loadFailed, canManage, canSwitchScale, payScale }: Props) {
  const t = useTranslations("gradeBands");
  const router = useRouter();
  const formError = useFormError("grade band");
  const formId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);

  const [bands, setBands] = useState<GradeBand[]>(initialBands);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<GradeBand | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [errors, setErrors] = useState<FormErrors>({});
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [confirm, setConfirm] = useState<{ kind: "deactivate" | "delete"; band: GradeBand } | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [confirmError, setConfirmError] = useState<string | undefined>();
  const [scale, setScale] = useState<PayScaleKind>(payScale);
  const [savedScale, setSavedScale] = useState<PayScaleKind>(payScale);
  const [scaleBusy, setScaleBusy] = useState(false);
  const [scaleMsg, setScaleMsg] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  useEffect(() => { if (formOpen) headingRef.current?.focus(); }, [formOpen, editing]);

  function openCreate() {
    setEditing(null); setForm(EMPTY_FORM); setErrors({}); setStatus(null); formError.clear(); setFormOpen(true);
  }
  function openEdit(b: GradeBand) {
    setEditing(b);
    setForm({
      code: b.code, name: b.name, rank: String(b.rank), track: b.track ?? "",
      ctcMin: formatMinorAsRupees(b.ctcMinMinor)?.replace(/,/g, "") ?? "",
      ctcMax: formatMinorAsRupees(b.ctcMaxMinor)?.replace(/,/g, "") ?? "",
      notice: b.noticeDays === null ? "" : String(b.noticeDays),
    });
    setErrors({}); setStatus(null); formError.clear(); setFormOpen(true);
  }
  function closeForm() { setFormOpen(false); setEditing(null); setErrors({}); formError.clear(); }

  function validate(): { ok: true; body: Record<string, unknown> } | { ok: false } {
    const e: FormErrors = {};
    const code = form.code.trim();
    if (!editing) {
      if (code === "") e.code = t("errCodeRequired");
      else if (code.length > MAX_BAND_CODE_LENGTH || !BAND_CODE_PATTERN.test(code)) e.code = t("errCodeFormat");
    }
    if (form.name.trim().length < 2) e.name = t("errNameRequired");
    const rank = Number(form.rank.trim());
    if (!/^\d+$/.test(form.rank.trim()) || rank < MIN_BAND_RANK || rank > MAX_BAND_RANK) e.rank = t("errRank");
    const min = rupeesToMinor(form.ctcMin);
    const max = rupeesToMinor(form.ctcMax);
    if (min === "invalid") e.ctcMin = t("errCtcNumber");
    if (max === "invalid") e.ctcMax = t("errCtcNumber");
    if (typeof min === "string" && min !== "invalid" && typeof max === "string" && max !== "invalid" && BigInt(min) > BigInt(max)) e.ctcMin = t("errCtcOrder");
    const noticeRaw = form.notice.trim();
    if (noticeRaw !== "" && (!/^\d+$/.test(noticeRaw) || Number(noticeRaw) > 365)) e.notice = t("errNotice");
    setErrors(e);
    if (Object.keys(e).length > 0) return { ok: false };
    const body: Record<string, unknown> = {
      name: form.name.trim(), rank,
      track: form.track.trim() === "" ? null : form.track.trim(),
      ctcMinMinor: min === "invalid" ? null : min, ctcMaxMinor: max === "invalid" ? null : max,
      noticeDays: noticeRaw === "" ? null : Number(noticeRaw),
    };
    if (!editing) body.code = code;
    else body.expectedVersion = editing.version;
    return { ok: true, body };
  }

  async function submit(ev: React.FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    setStatus(null); formError.clear();
    const v = validate();
    if (!v.ok) { setStatus({ tone: "error", text: t("errFixFields") }); return; }
    setBusy(true);
    try {
      const res = await fetch(editing ? `/api/proxy/v1/hrms/admin/grade-bands/${editing.id}` : "/api/proxy/v1/hrms/admin/grade-bands", {
        method: editing ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(v.body),
      });
      if (!res.ok) {
        const resolved = await formError.fromResponse(res, "save");
        setStatus({ tone: "error", text: resolved.message });
        return;
      }
      const accepted = (await res.json().catch(() => ({}))) as { id?: string };
      const b = v.body;
      if (editing) {
        setBands((prev) => prev.map((x) => x.id === editing.id ? {
          ...x, name: b.name as string, rank: b.rank as number, track: b.track as string | null,
          ctcMinMinor: b.ctcMinMinor as string | null, ctcMaxMinor: b.ctcMaxMinor as string | null,
          noticeDays: b.noticeDays as number | null, version: x.version + 1,
        } : x).sort((p, q) => p.rank - q.rank || p.code.localeCompare(q.code)));
        setStatus({ tone: "success", text: t("msgUpdated", { code: editing.code }) });
      } else {
        const code = String(b.code).toUpperCase();
        if (accepted.id) {
          setBands((prev) => [...prev, {
            id: accepted.id!, code, name: b.name as string, rank: b.rank as number, track: b.track as string | null,
            ctcMinMinor: b.ctcMinMinor as string | null, ctcMaxMinor: b.ctcMaxMinor as string | null,
            noticeDays: b.noticeDays as number | null, isActive: true, version: 1, designationCount: 0,
          }].sort((p, q) => p.rank - q.rank || p.code.localeCompare(q.code)));
        }
        setStatus({ tone: "success", text: t("msgCreated", { code }) });
      }
      closeForm();
      try { router.refresh(); } catch { /* ignore */ }
    } catch (caught) {
      setStatus({ tone: "error", text: formError.fromException("save", caught).message });
    } finally {
      setBusy(false);
    }
  }

  async function runConfirmed() {
    if (!confirm) return;
    const { kind, band } = confirm;
    setConfirmBusy(true); setConfirmError(undefined); formError.clear();
    try {
      const res = kind === "delete"
        ? await fetch(`/api/proxy/v1/hrms/admin/grade-bands/${band.id}`, { method: "DELETE" })
        : await fetch(`/api/proxy/v1/hrms/admin/grade-bands/${band.id}/deactivate`, { method: "POST" });
      if (!res.ok) { setConfirmError((await formError.fromResponse(res, "save")).message); return; }
      setBands((prev) => kind === "delete" ? prev.filter((x) => x.id !== band.id) : prev.map((x) => x.id === band.id ? { ...x, isActive: false } : x));
      setStatus({ tone: "success", text: t(kind === "delete" ? "msgDeleted" : "msgDeactivated", { code: band.code }) });
      setConfirm(null);
      try { router.refresh(); } catch { /* ignore */ }
    } catch (caught) {
      setConfirmError(formError.fromException("save", caught).message);
    } finally {
      setConfirmBusy(false);
    }
  }

  async function reactivate(band: GradeBand) {
    setStatus(null); formError.clear();
    try {
      const res = await fetch(`/api/proxy/v1/hrms/admin/grade-bands/${band.id}/reactivate`, { method: "POST" });
      if (!res.ok) { setStatus({ tone: "error", text: (await formError.fromResponse(res, "save")).message }); return; }
      setBands((prev) => prev.map((x) => x.id === band.id ? { ...x, isActive: true } : x));
      setStatus({ tone: "success", text: t("msgReactivated", { code: band.code }) });
      try { router.refresh(); } catch { /* ignore */ }
    } catch (caught) {
      setStatus({ tone: "error", text: formError.fromException("save", caught).message });
    }
  }

  async function saveScale() {
    setScaleBusy(true); setScaleMsg(null); formError.clear();
    try {
      const res = await fetch("/api/proxy/v1/hrms/policy-settings/pay_scale", {
        method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind: scale }),
      });
      if (!res.ok) { setScaleMsg({ tone: "error", text: (await formError.fromResponse(res, "save")).message }); return; }
      setSavedScale(scale);
      setScaleMsg({ tone: "success", text: t("scaleSaved") });
    } catch (caught) {
      setScaleMsg({ tone: "error", text: formError.fromException("save", caught).message });
    } finally {
      setScaleBusy(false);
    }
  }

  const rows = bands as Row[];
  const ctcText = (b: GradeBand): string => {
    const min = formatMinorAsRupees(b.ctcMinMinor);
    const max = formatMinorAsRupees(b.ctcMaxMinor);
    if (min && max) return t("ctcRange", { min, max });
    if (min) return t("ctcFrom", { min });
    if (max) return t("ctcUpTo", { max });
    return t("none");
  };

  const columns = [
    { key: "code" as const, label: t("colCode"), render: (b: Row) => <strong>{b.code}</strong> },
    { key: "name" as const, label: t("colName"), render: (b: Row) => b.name },
    { key: "rank" as const, label: t("colRank"), align: "right" as const, render: (b: Row) => b.rank },
    { key: "track" as const, label: t("colTrack"), render: (b: Row) => b.track ?? t("none") },
    { key: "ctcMinMinor" as const, label: t("colCtc"), sortable: false, render: (b: Row) => ctcText(b) },
    { key: "noticeDays" as const, label: t("colNotice"), sortable: false, render: (b: Row) => b.noticeDays === null ? t("none") : t("noticeDaysValue", { days: b.noticeDays }) },
    { key: "designationCount" as const, label: t("colDesignations"), align: "right" as const, render: (b: Row) => b.designationCount ?? t("none") },
    {
      key: "isActive" as const, label: t("colStatus"),
      render: (b: Row) => <StatusPill status={b.isActive ? "active" : "inactive"} variant={b.isActive ? "good" : "mut"} label={b.isActive ? t("statusActive") : t("statusInactive")} />,
    },
    ...(canManage ? [{
      key: "id" as const, label: t("colActions"), sortable: false,
      render: (b: Row) => {
        const inUse = (b.designationCount ?? 0) > 0;
        const hintId = `${formId}-inuse-${b.id}`;
        return (
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <Button variant="ghost" size="sm" onClick={() => openEdit(b)} aria-label={t("editAria", { code: b.code })}>{t("editBtn")}</Button>
            {b.isActive ? (
              <Button variant="ghost" size="sm" onClick={() => { setConfirmError(undefined); setConfirm({ kind: "deactivate", band: b }); }} aria-label={t("deactivateAria", { code: b.code })}>{t("deactivateBtn")}</Button>
            ) : (
              <Button variant="ghost" size="sm" onClick={() => void reactivate(b)} aria-label={t("reactivateAria", { code: b.code })}>{t("reactivateBtn")}</Button>
            )}
            {/* aria-disabled (not disabled) keeps the button reachable by keyboard so its reason is read out. */}
            <Button
              variant="danger" size="sm"
              onClick={() => { if (inUse) return; setConfirmError(undefined); setConfirm({ kind: "delete", band: b }); }}
              aria-label={t("deleteAria", { code: b.code })}
              aria-disabled={inUse ? true : undefined}
              aria-describedby={inUse ? hintId : undefined}
              style={inUse ? { opacity: 0.5, cursor: "not-allowed" } : undefined}
            >{t("deleteBtn")}</Button>
            {inUse && <span id={hintId} style={{ display: "block", flexBasis: "100%", fontSize: 11, color: "var(--mut)" }}>{t("deleteInUseHint", { count: b.designationCount ?? 0 })}</span>}
          </div>
        );
      },
    }] : []),
  ];

  const nameId = `${formId}-name`; const codeId = `${formId}-code`; const rankId = `${formId}-rank`;
  const codeHintId = `${formId}-code-hint`; const rankHintId = `${formId}-rank-hint`; const ctcHintId = `${formId}-ctc-hint`;
  const scaleLabel = (k: PayScaleKind) => (k === "private_bands" ? t("scalePrivate") : t("scaleCpc7"));

  return (
    <div style={{ display: "grid", gap: 16 }}>
      {/* Status line: one polite live region for every outcome on this screen. */}
      <div aria-live="polite" aria-atomic="true">
        {status && (
          <p
            role={status.tone === "error" ? "alert" : "status"}
            style={{
              margin: 0, padding: "10px 14px", borderRadius: 8, fontSize: 14,
              background: status.tone === "success" ? "var(--goodbg)" : "var(--badbg)",
              border: `1px solid ${status.tone === "success" ? "var(--goodbd)" : "var(--badbd)"}`,
              color: status.tone === "success" ? "var(--good)" : "var(--bad)",
            }}
          >{status.text}</p>
        )}
      </div>

      <section aria-labelledby={`${formId}-scale-h`} className="pad" style={{ border: "1px solid var(--line)", borderRadius: 12 }}>
        <h3 id={`${formId}-scale-h`} style={{ margin: "0 0 4px", fontSize: 15 }}>{t("scaleHeading")}</h3>
        <p style={{ margin: "0 0 10px", fontSize: 13, color: "var(--mut)" }}>{t("scaleDesc")}</p>
        {canSwitchScale ? (
          <fieldset style={{ border: 0, padding: 0, margin: 0, display: "grid", gap: 8 }}>
            <legend style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>{t("scaleLegend")}</legend>
            {(["cpc7", "private_bands"] as const).map((k) => (
              <label key={k} style={{ display: "flex", gap: 8, alignItems: "flex-start", minHeight: 44, fontSize: 14 }}>
                <input type="radio" name={`${formId}-scale`} value={k} checked={scale === k} onChange={() => setScale(k)} style={{ marginTop: 4, width: 18, height: 18 }} />
                <span>
                  {scaleLabel(k)}
                  {k === "private_bands" && <span style={{ display: "block", fontSize: 12, color: "var(--mut)" }}>{t("scalePrivateNote")}</span>}
                </span>
              </label>
            ))}
            <div>
              <Button variant="primary" onClick={() => void saveScale()} loading={scaleBusy} disabled={scaleBusy || scale === savedScale} style={{ minHeight: 44 }}>
                {scaleBusy ? t("scaleSaving") : t("scaleSave")}
              </Button>
            </div>
            <div aria-live="polite" aria-atomic="true">
              {scaleMsg && <p role={scaleMsg.tone === "error" ? "alert" : "status"} style={{ margin: 0, fontSize: 13, color: scaleMsg.tone === "success" ? "var(--good)" : "var(--bad)" }}>{scaleMsg.text}</p>}
            </div>
          </fieldset>
        ) : (
          <>
            <p style={{ margin: 0, fontSize: 14 }}>{t("scaleCurrent", { kind: scaleLabel(savedScale) })}</p>
            <p style={{ margin: "4px 0 0", fontSize: 12, color: "var(--mut)" }}>{t("scaleNotAdmin")}</p>
          </>
        )}
      </section>

      {canManage && !formOpen && (
        <div><Button variant="primary" onClick={openCreate} style={{ minHeight: 44 }}><span aria-hidden="true" style={{ marginInlineEnd: 6 }}>+</span>{t("newBtn")}</Button></div>
      )}

      {canManage && formOpen && (
        <form onSubmit={(e) => void submit(e)} noValidate aria-labelledby={`${formId}-form-h`} className="card">
          <div className="card-h">
            <h3 id={`${formId}-form-h`} ref={headingRef} tabIndex={-1}>
              {editing ? t("formHeadingEdit", { code: editing.code }) : t("formHeadingCreate")}
            </h3>
          </div>
          <div className="pad" style={{ display: "grid", gap: 14 }}>
            <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))" }}>
              <div>
                <Field id={codeId} label={t("fieldCode")} required error={errors.code || formError.fieldError("code")}>
                  <Input
                    value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })}
                    placeholder={t("fieldCodePlaceholder")} maxLength={MAX_BAND_CODE_LENGTH} disabled={!!editing}
                    aria-describedby={codeHintId} autoComplete="off"
                  />
                </Field>
                <p id={codeHintId} style={{ margin: "4px 0 0", fontSize: 12, color: "var(--mut)" }}>{t("fieldCodeHint")}</p>
              </div>
              <Field id={nameId} label={t("fieldName")} required error={errors.name || formError.fieldError("name")}>
                <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder={t("fieldNamePlaceholder")} maxLength={120} />
              </Field>
              <div>
                <Field id={rankId} label={t("fieldRank")} required error={errors.rank || formError.fieldError("rank")}>
                  <Input
                    type="text" inputMode="numeric" value={form.rank} onChange={(e) => setForm({ ...form, rank: e.target.value })}
                    aria-describedby={rankHintId}
                  />
                </Field>
                <p id={rankHintId} style={{ margin: "4px 0 0", fontSize: 12, color: "var(--mut)" }}>{t("fieldRankHint")}</p>
              </div>
              <Field label={t("fieldTrack")} error={errors.track || formError.fieldError("track")}>
                <Input value={form.track} onChange={(e) => setForm({ ...form, track: e.target.value })} placeholder={t("fieldTrackPlaceholder")} maxLength={40} />
              </Field>
              <div>
                <Field label={t("fieldCtcMin")} error={errors.ctcMin || formError.fieldError("ctcMinMinor")}>
                  <Input type="text" inputMode="decimal" value={form.ctcMin} onChange={(e) => setForm({ ...form, ctcMin: e.target.value })} aria-describedby={ctcHintId} />
                </Field>
              </div>
              <div>
                <Field label={t("fieldCtcMax")} error={errors.ctcMax || formError.fieldError("ctcMaxMinor")}>
                  <Input type="text" inputMode="decimal" value={form.ctcMax} onChange={(e) => setForm({ ...form, ctcMax: e.target.value })} aria-describedby={ctcHintId} />
                </Field>
                <p id={ctcHintId} style={{ margin: "4px 0 0", fontSize: 12, color: "var(--mut)" }}>{t("fieldCtcHint")}</p>
              </div>
              <Field label={t("fieldNotice")} error={errors.notice || formError.fieldError("noticeDays")}>
                <Input type="text" inputMode="numeric" value={form.notice} onChange={(e) => setForm({ ...form, notice: e.target.value })} />
              </Field>
            </div>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <Button type="submit" loading={busy} style={{ minHeight: 44, minWidth: 140 }}>
                {busy ? t("saving") : editing ? t("saveEdit") : t("saveCreate")}
              </Button>
              <Button type="button" variant="ghost" onClick={closeForm} disabled={busy} style={{ minHeight: 44 }}>{t("cancel")}</Button>
            </div>
          </div>
        </form>
      )}

      {loadFailed ? (
        <RefreshErrorState error={toHumanError("load", { area: "grade bands" })} backHref="/hr" />
      ) : bands.length === 0 ? (
        <EmptyState icon="🏷️" title={t("emptyTitle")} message={t("emptyMessage")} />
      ) : (
        <DataTable<Row>
          columns={columns}
          rows={rows}
          sortable
          filterable
          filterPlaceholder={t("filterPlaceholder")}
          filterKeys={["code", "name", "track"]}
          pageSize={15}
          mobileStack
          caption={t("tableCaption")}
          emptyIcon="🏷️"
          emptyTitle={t("noMatchTitle")}
          emptyMessage={t("noMatchMessage")}
        />
      )}

      <ConfirmDialog
        open={confirm !== null}
        title={confirm ? t(confirm.kind === "delete" ? "deleteConfirmTitle" : "deactivateConfirmTitle", { code: confirm.band.code }) : ""}
        description={confirm ? t(confirm.kind === "delete" ? "deleteConfirmDesc" : "deactivateConfirmDesc") : ""}
        danger={confirm?.kind === "delete"}
        confirmLabel={confirm ? t(confirm.kind === "delete" ? "deleteConfirmBtn" : "deactivateConfirmBtn") : ""}
        busy={confirmBusy}
        errorMessage={confirmError}
        onConfirm={() => void runConfirmed()}
        onCancel={() => { if (!confirmBusy) { setConfirm(null); setConfirmError(undefined); } }}
      />
    </div>
  );
}
