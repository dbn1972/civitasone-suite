"use client";

import { useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { AcceptedNotice, Button, Card, ConfirmDialog, Drawer, Field, Input, Select } from "../../../../../../_components/ds";
import { useAcceptedWrite } from "@/lib/useAcceptedWrite";
import { browserJson } from "@/lib/api/browserClient";
import {
  COMPONENT_CALC_TYPES, COST_PLACEMENTS, EMPLOYER_COST_CLASSES, RUN_CALC_TYPES, STATUTORY_DERIVED_CLASSES,
  emptyForm, formFromRow, parseComponentForm,
  type ComponentForm, type ComponentRow, type FormErrors, type StructureKind,
} from "@/lib/payComponents";

export type StructureView = {
  id: string; name: string; kind: StructureKind; isLocked: boolean; effectivelyLocked: boolean;
  templateVersion: number; effectiveFrom: string | null;
};
export type CheckIssue = { code: string; field: string; message: string };
export type StructureCheck = { errors: CheckIssue[]; warnings: CheckIssue[] };

const inr = (paise: string) => (Number(paise) / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 });

/**
 * Section 8 G2: pay-component admin for one structure (run structure or CTC template). Add / edit in a drawer,
 * deactivate with a reason (never deletes), reorder with buttons, lock (approve) and new version. Every write is
 * a CQRS command (202); the server re-validates and is the authority (flag S8_PAY_COMPONENTS_ENABLED).
 */
export function ComponentManager({ structure, components, check, canWrite, canLock }: {
  structure: StructureView; components: ComponentRow[]; check: StructureCheck; canWrite: boolean; canLock: boolean;
}) {
  const t = useTranslations("payComponents");
  const router = useRouter();
  // The write is a 202 and a consumer applies it. Poll the structure until the expected change is visible; if it
  // never shows up (the consumer refused it, for example after a concurrent change) the notice says it is still
  // processing instead of claiming success. Synchronous refusals (validation, lock, duplicate) arrive as the 4xx below.
  const expectRef = useRef<(d: { structure: StructureView; components: ComponentRow[] }) => boolean>(() => true);
  const accepted = useAcceptedWrite<unknown, { structure: StructureView; components: ComponentRow[] }>({
    poll: () => browserJson<{ structure: StructureView; components: ComponentRow[] }>(`v1/payroll/structures/${encodeURIComponent(structure.id)}/components`),
    isDone: (d) => expectRef.current(d),
  });
  const kind = structure.kind;
  const editable = canWrite && !structure.effectivelyLocked;

  const [editing, setEditing] = useState<{ row: ComponentRow | null } | null>(null);
  const [form, setForm] = useState<ComponentForm>(emptyForm(kind));
  const [errors, setErrors] = useState<FormErrors>({});
  const [toggling, setToggling] = useState<ComponentRow | null>(null);
  const [confirm, setConfirm] = useState<"lock" | "version" | null>(null);
  const [busy, setBusy] = useState(false);
  const [dialogError, setDialogError] = useState<string | undefined>();
  const [message, setMessage] = useState<{ tone: "good" | "bad"; text: string } | null>(null);
  const ids = { code: useId(), name: useId(), type: useId(), calc: useId(), pb: useId(), pc: useId(), fx: useId(), cls: useId(), pl: useId() };

  const base = `v1/payroll/structures/${encodeURIComponent(structure.id)}`;
  const set = <K extends keyof ComponentForm>(k: K, v: ComponentForm[K]) => setForm((f) => ({ ...f, [k]: v }));
  const issueText = (i: CheckIssue) => (t.has(`check_${i.code}`) ? t(`check_${i.code}`) : i.message);

  async function send(fn: () => Promise<unknown>, okText: string, done: () => void, expectChange: (d: { structure: StructureView; components: ComponentRow[] }) => boolean = () => true) {
    setBusy(true);
    setDialogError(undefined);
    try {
      const res = await fn();
      expectRef.current = expectChange;
      done();
      setMessage({ tone: "good", text: okText });
      router.refresh();
      void accepted.accept(res);
    } catch (err) {
      setDialogError(err instanceof Error ? err.message : t("networkError"));
    } finally {
      setBusy(false);
    }
  }

  function openEditor(row: ComponentRow | null) {
    setForm(row ? formFromRow(row) : emptyForm(kind));
    setErrors({});
    setDialogError(undefined);
    setEditing({ row });
  }

  function save() {
    const isNew = editing?.row == null;
    const r = parseComponentForm(kind, form, isNew);
    if (!r.ok) { setErrors(r.errors); return; }
    setErrors({});
    const row = editing?.row;
    void send(
      () => (row
        ? browserJson(`${base}/components/${encodeURIComponent(row.id)}`, { method: "PATCH", body: JSON.stringify({ ...r.payload, version: row.version }) })
        : browserJson(`${base}/components`, { method: "POST", body: JSON.stringify(r.payload) })),
      row ? t("savedMessage", { code: row.code }) : t("addedMessage", { code: r.payload.code ?? "" }),
      () => setEditing(null),
      (d) => (row ? (d.components.find((c) => c.id === row.id)?.version ?? 0) > row.version : d.components.some((c) => c.code === r.payload.code)),
    );
  }

  function move(index: number, delta: -1 | 1) {
    const order = components.map((c) => c.id);
    const j = index + delta;
    if (j < 0 || j >= order.length) return;
    [order[index], order[j]] = [order[j]!, order[index]!];
    void send(() => browserJson(`${base}/components/reorder`, { method: "POST", body: JSON.stringify({ orderedIds: order }) }), t("reorderedMessage"), () => undefined,
      (d) => d.components.map((c) => c.id).join() === order.join());
  }

  const calcText = (c: ComponentRow): string => {
    if (c.employerCostClass && STATUTORY_DERIVED_CLASSES.includes(c.employerCostClass as never)) return t("calcStatutory");
    const calc = c.calc ?? (c.pctOfBasic && c.pctOfBasic > 0 ? "pct_of_basic" : c.fixedMinor != null ? "fixed" : null);
    if (calc === "pct_of_ctc") return t("calcPctCtcValue", { pct: ((c.pctOfCtcBps ?? 0) / 100).toFixed(2) });
    if (calc === "pct_of_basic") return t("calcPctBasicValue", { pct: Number(c.pctOfBasic ?? 0).toFixed(2) });
    if (calc === "fixed") return t("calcFixedValue", { amount: inr(c.fixedMinor ?? "0") });
    if (calc === "balancing") return t("calcBalancingValue");
    return t("calcEngine");
  };

  const statutory = form.employerCostClass !== "" && STATUTORY_DERIVED_CLASSES.includes(form.employerCostClass);
  const calcOptions = kind === "run" ? RUN_CALC_TYPES : COMPONENT_CALC_TYPES.filter((c) => c !== "balancing" || form.componentType === "earning");
  const typeOptions = kind === "run" ? (["earning", "deduction"] as const) : (["earning", "employer_cost"] as const);

  return (
    <>
      <AcceptedNotice {...accepted.noticeProps} />
      {message && (
        <p role={message.tone === "bad" ? "alert" : "status"} className={`pill ${message.tone}`} style={{ width: "fit-content", marginBottom: 12 }}>{message.text}</p>
      )}

      {structure.effectivelyLocked && <p role="status" className="pill warn" style={{ width: "fit-content", marginBottom: 12 }}>{t("lockedNotice")}</p>}

      {(check.errors.length > 0 || check.warnings.length > 0) && (
        <Card title={t("checkTitle")} padding>
          <ul style={{ margin: 0, paddingInlineStart: 20 }}>
            {check.errors.map((i) => <li key={i.code} className="pill bad" style={{ display: "list-item" }}>{issueText(i)}</li>)}
            {check.warnings.map((i) => <li key={i.code} style={{ color: "var(--ink2)" }}>{t("warningPrefix")} {issueText(i)}</li>)}
          </ul>
        </Card>
      )}

      <Card title={t("componentsTitle", { name: structure.name })}>
        <div className="pad" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {editable && <Button onClick={() => openEditor(null)} style={{ minHeight: 44 }}>{t("addBtn")}</Button>}
          {canWrite && <Button variant="ghost" onClick={() => { setDialogError(undefined); setConfirm("version"); }} style={{ minHeight: 44 }}>{t("newVersionBtn")}</Button>}
          {canLock && !structure.isLocked && <Button variant="ghost" onClick={() => { setDialogError(undefined); setConfirm("lock"); }} style={{ minHeight: 44 }}>{t("lockBtn")}</Button>}
        </div>
        {components.length === 0 ? (
          <p className="pad" style={{ color: "var(--ink2)" }}>{t("emptyMessage")}</p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <caption className="sr-only">{t("tableCaption", { name: structure.name })}</caption>
              <thead>
                <tr>
                  {["colOrder", "colCode", "colName", "colType", "colCalc", "colFlags", "colStatus", ...(editable ? ["colActions"] : [])].map((k) => (
                    <th key={k} scope="col" style={{ textAlign: "start", padding: "8px 12px" }}>{t(k)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {components.map((c, i) => {
                  const flags = [
                    c.employerCostClass ? t(`class_${c.employerCostClass}`) : null,
                    c.employerCostClass && c.costPlacement === "on_top" ? t("placement_on_top") : null,
                    c.countsForPfWage ? t("flagPf") : null, c.countsForEsiWage ? t("flagEsi") : null,
                    c.countsForGratuity ? t("flagGratuity") : null, c.lopApplicable ? t("flagLop") : null,
                    c.isTaxable ? t("flagTaxable") : null,
                  ].filter(Boolean).join(", ");
                  return (
                    <tr key={c.id} style={{ opacity: c.isActive ? 1 : 0.6 }}>
                      <td style={{ padding: "8px 12px" }}>{i + 1}</td>
                      <td style={{ padding: "8px 12px" }}><code>{c.code}</code></td>
                      <th scope="row" style={{ padding: "8px 12px", textAlign: "start", fontWeight: 600 }}>{c.name}</th>
                      <td style={{ padding: "8px 12px" }}>{t(`type_${c.componentType}`)}</td>
                      <td style={{ padding: "8px 12px" }}>{calcText(c)}</td>
                      <td style={{ padding: "8px 12px" }}>{flags || "—"}</td>
                      <td style={{ padding: "8px 12px" }}>{c.isActive ? t("statusActive") : t("statusInactive")}</td>
                      {editable && (
                        <td style={{ padding: "8px 12px", whiteSpace: "nowrap" }}>
                          <Button variant="ghost" onClick={() => openEditor(c)} disabled={busy} aria-label={t("editAria", { code: c.code })}>{t("editBtn")}</Button>
                          <Button variant="ghost" onClick={() => { setDialogError(undefined); setToggling(c); }} disabled={busy}
                            aria-label={t(c.isActive ? "deactivateAria" : "reactivateAria", { code: c.code })}>{t(c.isActive ? "deactivateBtn" : "reactivateBtn")}</Button>
                          <Button variant="ghost" onClick={() => move(i, -1)} disabled={busy || i === 0} aria-label={t("moveUpAria", { code: c.code })}>{"↑"}</Button>
                          <Button variant="ghost" onClick={() => move(i, 1)} disabled={busy || i === components.length - 1} aria-label={t("moveDownAria", { code: c.code })}>{"↓"}</Button>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Drawer
        open={editing !== null}
        onClose={() => setEditing(null)}
        busy={busy}
        title={editing?.row ? t("editTitle", { code: editing.row.code }) : t("addTitle")}
        footer={(
          <>
            <Button variant="ghost" onClick={() => setEditing(null)} disabled={busy}>{t("cancelBtn")}</Button>
            <Button onClick={save} disabled={busy} style={{ minHeight: 44 }}>{t("saveBtn")}</Button>
          </>
        )}
      >
        {dialogError && <p role="alert" className="pill bad">{dialogError}</p>}
        <Field id={ids.code} label={t("codeLabel")} required={editing?.row == null} hint={t("codeHint")} error={errors.code ? t(errors.code) : undefined}>
          <Input id={ids.code} value={form.code} maxLength={32} disabled={editing?.row != null}
            onChange={(e) => set("code", e.target.value.toUpperCase())} />
        </Field>
        <Field id={ids.name} label={t("nameLabel")} required error={errors.name ? t(errors.name) : undefined}>
          <Input id={ids.name} value={form.name} maxLength={128} onChange={(e) => set("name", e.target.value)} />
        </Field>
        <Field id={ids.type} label={t("typeLabel")}>
          <Select id={ids.type} value={form.componentType} onChange={(e) => {
            const v = e.target.value as ComponentForm["componentType"];
            setForm((f) => ({ ...f, componentType: v, employerCostClass: v === "employer_cost" ? f.employerCostClass : "", calc: v !== "earning" && f.calc === "balancing" ? "" : f.calc }));
          }}>
            {typeOptions.map((o) => <option key={o} value={o}>{t(`type_${o}`)}</option>)}
          </Select>
        </Field>
        {form.componentType === "employer_cost" && (
          <>
            <Field id={ids.cls} label={t("classLabel")} required error={errors.employerCostClass ? t(errors.employerCostClass) : undefined}>
              <Select id={ids.cls} value={form.employerCostClass} onChange={(e) => set("employerCostClass", e.target.value as ComponentForm["employerCostClass"])}>
                <option value="">{t("choose")}</option>
                {EMPLOYER_COST_CLASSES.map((o) => <option key={o} value={o}>{t(`class_${o}`)}</option>)}
              </Select>
            </Field>
            <Field id={ids.pl} label={t("placementLabel")}>
              <Select id={ids.pl} value={form.costPlacement} onChange={(e) => set("costPlacement", e.target.value as ComponentForm["costPlacement"])}>
                {COST_PLACEMENTS.map((o) => <option key={o} value={o}>{t(`placement_${o}`)}</option>)}
              </Select>
            </Field>
          </>
        )}
        {statutory ? (
          <p style={{ color: "var(--ink2)" }}>{t("statutoryNote")}</p>
        ) : (
          <>
            <Field id={ids.calc} label={t("calcLabel")} required error={errors.calc ? t(errors.calc) : undefined}>
              <Select id={ids.calc} value={form.calc} onChange={(e) => set("calc", e.target.value as ComponentForm["calc"])}>
                <option value="">{t("choose")}</option>
                {calcOptions.map((o) => <option key={o} value={o}>{t(`calc_${o}`)}</option>)}
              </Select>
            </Field>
            {form.calc === "pct_of_basic" && (
              <Field id={ids.pb} label={t("pctBasicLabel")} required hint={t("pctHint")} error={errors.amount ? t(errors.amount) : undefined}>
                <Input id={ids.pb} inputMode="decimal" value={form.pctOfBasic} onChange={(e) => set("pctOfBasic", e.target.value)} />
              </Field>
            )}
            {form.calc === "pct_of_ctc" && (
              <Field id={ids.pc} label={t("pctCtcLabel")} required hint={t("pctHint")} error={errors.amount ? t(errors.amount) : undefined}>
                <Input id={ids.pc} inputMode="decimal" value={form.pctOfCtc} onChange={(e) => set("pctOfCtc", e.target.value)} />
              </Field>
            )}
            {form.calc === "fixed" && (
              <Field id={ids.fx} label={t("fixedLabel")} required hint={t("fixedHint")} error={errors.amount ? t(errors.amount) : undefined}>
                <Input id={ids.fx} inputMode="decimal" value={form.fixedRupees} onChange={(e) => set("fixedRupees", e.target.value)} />
              </Field>
            )}
            {form.calc === "balancing" && <p style={{ color: "var(--ink2)" }}>{t("balancingNote")}</p>}
          </>
        )}
        <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
          <legend style={{ fontWeight: 600, marginBottom: 6 }}>{t("flagsLegend")}</legend>
          {([
            ["isTaxable", "flagTaxable", true], ["countsForPfWage", "flagPfLabel", kind === "ctc_template"],
            ["countsForEsiWage", "flagEsiLabel", kind === "ctc_template"], ["countsForGratuity", "flagGratuityLabel", kind === "ctc_template"],
            ["lopApplicable", "flagLopLabel", kind === "ctc_template"],
          ] as const).filter(([, , show]) => show).map(([k, label]) => (
            <label key={k} style={{ display: "flex", alignItems: "center", gap: 8, minHeight: 32 }}>
              <input type="checkbox" checked={form[k]} onChange={(e) => set(k, e.target.checked)} style={{ width: 18, height: 18 }} />
              {t(label)}
            </label>
          ))}
        </fieldset>
      </Drawer>

      <ConfirmDialog
        open={toggling !== null}
        title={toggling?.isActive ? t("deactivateTitle") : t("reactivateTitle")}
        confirmLabel={toggling?.isActive ? t("deactivateConfirm") : t("reactivateConfirm")}
        busy={busy}
        errorMessage={dialogError}
        requireReason
        minReasonLength={10}
        maxReasonLength={500}
        reasonLabel={t("reasonLabel")}
        description={toggling ? t(toggling.isActive ? "deactivateDescription" : "reactivateDescription", { code: toggling.code }) : null}
        onConfirm={(reason) => toggling && void send(
          () => browserJson(`${base}/components/${encodeURIComponent(toggling.id)}/${toggling.isActive ? "deactivate" : "reactivate"}`, { method: "POST", body: JSON.stringify({ reason }) }),
          t(toggling.isActive ? "deactivatedMessage" : "reactivatedMessage", { code: toggling.code }),
          () => setToggling(null),
          (d) => d.components.find((c) => c.id === toggling.id)?.isActive === !toggling.isActive,
        )}
        onCancel={() => !busy && setToggling(null)}
      />
      <ConfirmDialog
        open={confirm !== null}
        title={confirm === "lock" ? t("lockTitle") : t("newVersionTitle")}
        confirmLabel={confirm === "lock" ? t("lockConfirm") : t("newVersionConfirm")}
        busy={busy}
        errorMessage={dialogError}
        description={confirm === "lock" ? t("lockDescription", { kind: t(`kind_${kind}`) }) : t("newVersionDescription", { name: structure.name })}
        onConfirm={() => void send(
          () => browserJson(`${base}/${confirm === "lock" ? "lock" : "new-version"}`, { method: "POST", body: JSON.stringify({}) }),
          confirm === "lock" ? t("lockedMessage") : t("newVersionMessage"),
          () => setConfirm(null),
          confirm === "lock" ? (d) => d.structure.isLocked : () => true,
        )}
        onCancel={() => !busy && setConfirm(null)}
      />
    </>
  );
}
