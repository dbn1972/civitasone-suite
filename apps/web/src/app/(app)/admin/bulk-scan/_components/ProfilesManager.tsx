"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Button, ConfirmDialog, EmptyState, Field, Input, LoadErrorState, Modal, Select, Textarea } from "@/app/_components/ds";
import type { LoaderResult } from "@/app/_data/apiClient";
import { errorText, useBulkScanError, type BsError } from "@/lib/bulkScan/useBulkScanError";
import { bsRequest, QUEUED_RELOAD_DELAY_MS } from "@/lib/bulkScan/api";
import { changeDirections, overallDirection, profileView, requiresApprovalOf, type View } from "@/lib/bulkScan/changeDirection";
import { listView } from "@/lib/bulkScan/listView";
import { mapProfiles } from "@/lib/bulkScan/mappers";
import { EMPTY_PROFILE, formToBody, formToConfig, overrideKeys, profileToForm, type ProfileFormState } from "@/lib/bulkScan/profileForm";
import { validateProfile, type FieldIssue } from "@/lib/bulkScan/settingsSchema";
import type { ProfileRow, ProviderInfo } from "@/lib/bulkScan/types";
import { formatIndianDateTime } from "@/lib/formatters";
import Link from "next/link";
import { BulkScanShell, InlineError } from "./BulkScanShell";
import { DirectionHint, LanguageGroup, numFromInput, PercentField, ProviderChainEditor, StepsGroup, useIssueText } from "./SettingsFields";

interface Props {
  profiles: LoaderResult<ProfileRow[]>;
  providers: LoaderResult<ProviderInfo[]>;
  docTypes: Array<{ id: string; label: string }>;
  allowedTargets: string[];
  /** The tenant's current controls: a profile inherits them where it does not override, so loosening is judged against them. */
  tenantSettings?: View;
}

type Editing = { mode: "create" } | { mode: "edit"; profile: ProfileRow };

/** Checkbox that turns an override on (seeding a value) or off (back to the tenant setting). */
function OverrideToggle({ label, on, onChange }: { label: string; on: boolean; onChange: (on: boolean) => void }) {
  return (
    <label style={{ display: "inline-flex", gap: 6, alignItems: "center", fontWeight: 600 }}>
      <input type="checkbox" checked={on} onChange={(e) => onChange(e.target.checked)} />{label}
    </label>
  );
}

export function ProfilesManager({ profiles, providers, docTypes, allowedTargets, tenantSettings = {} }: Props) {
  const t = useTranslations("bulkScan");
  const describe = useBulkScanError();
  const [items, setItems] = useState<ProfileRow[]>(profiles.data);
  const [failed, setFailed] = useState(profiles.source === "error");
  const [editing, setEditing] = useState<Editing | null>(null);
  const [form, setForm] = useState<ProfileFormState>(EMPTY_PROFILE);
  const [issues, setIssues] = useState<FieldIssue[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<BsError | null>(null);
  const [deleting, setDeleting] = useState<ProfileRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [dialogError, setDialogError] = useState<string | undefined>(undefined);
  const [notice, setNotice] = useState<string | null>(null);
  /** a change went to second-approver approval (not applied): the notice then links to the pending requests */
  const [approvalSubmitted, setApprovalSubmitted] = useState(false);
  const [reason, setReason] = useState("");
  const [needsReason, setNeedsReason] = useState(false);
  const [deleteNeedsReason, setDeleteNeedsReason] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const issueText = useIssueText(issues);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  async function reload(): Promise<void> {
    const r = await bsRequest("/profiles");
    const list = r.ok ? mapProfiles(r.json) : null;
    if (!list) { setFailed(true); return; }
    setFailed(false);
    setItems(list);
  }
  /** `approval` is the server's requiresApproval: true = submitted for a second approver (not applied), false = applied, null = not stated. */
  const reloadSoon = (approval: boolean | null = null): void => {
    setApprovalSubmitted(approval === true);
    setNotice(approval === true ? t("profiles.submittedApproval") : approval === false ? t("profiles.applied") : t("profiles.queued"));
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { void reload().then(() => setNotice(null)); }, QUEUED_RELOAD_DELAY_MS);
  };

  const open = (e: Editing): void => {
    setEditing(e);
    setForm(e.mode === "edit" ? profileToForm(e.profile) : EMPTY_PROFILE);
    setIssues([]);
    setError(null);
    setReason("");
    setNeedsReason(false);
  };
  const before = profileView(tenantSettings, editing?.mode === "edit" ? editing.profile.config : {});
  const dirs = editing ? changeDirections(before, profileView(tenantSettings, formToConfig(form))) : {};
  const overall = overallDirection(dirs);
  const upd = (p: Partial<ProfileFormState>): void => setForm((f) => ({ ...f, ...p }));
  const drop = <K extends keyof ProfileFormState>(k: K): void => setForm((f) => { const n = { ...f }; delete n[k]; return n; });

  async function save(): Promise<void> {
    const body = formToBody(form);
    const v = validateProfile(body);
    setIssues(v.ok ? [] : v.issues);
    if (!v.ok) return;
    const why = reason.trim();
    const payload = { ...v.data, ...(why ? { reason: why } : {}) };
    setSaving(true);
    setError(null);
    const r = editing?.mode === "edit"
      ? await bsRequest(`/profiles/${encodeURIComponent(editing.profile.id)}`, { method: "PUT", body: { ...payload, expectedVersion: editing.profile.version } })
      : await bsRequest("/profiles", { method: "POST", body: payload });
    setSaving(false);
    if (!r.ok) {
      // A change that loosens a control needs a reason: ask for it (the form keeps everything typed) and let the admin resubmit.
      if (r.code === "REASON_REQUIRED") setNeedsReason(true);
      setError(r.status === 409 && r.code !== "REASON_REQUIRED" ? { message: t("profiles.versionConflict"), reference: r.reference } : describe(r));
      return;
    }
    setEditing(null);
    reloadSoon(requiresApprovalOf(r.json));
  }

  async function remove(reasonText?: string): Promise<void> {
    if (!deleting) return;
    setBusy(true);
    setDialogError(undefined);
    const why = reasonText?.trim();
    // A profile some batch still uses is deleted through second-approver approval: the server then needs the reason (?reason=).
    const r = await bsRequest(`/profiles/${encodeURIComponent(deleting.id)}${why ? `?reason=${encodeURIComponent(why)}` : ""}`, { method: "DELETE" });
    setBusy(false);
    if (!r.ok) {
      if (r.code === "REASON_REQUIRED") setDeleteNeedsReason(true);
      setDialogError(errorText(describe(r)));
      return;
    }
    setDeleting(null);
    setDeleteNeedsReason(false);
    reloadSoon(requiresApprovalOf(r.json));
  }

  const view = items.length > 0 ? "ready" : failed ? "error" : listView({ source: "api", data: items });

  return (
    <BulkScanShell title={t("profiles.title")} subtitle={t("profiles.subtitle")} active="profiles" actions={<Button onClick={() => open({ mode: "create" })}>{t("profiles.new")}</Button>}>
      <p role="status" aria-live="polite" style={{ minHeight: 18, margin: "0 0 8px" }}>
        {notice ?? ""}
        {notice && approvalSubmitted ? <> <Link href="/admin/bulk-scan/settings">{t("profiles.viewPending")}</Link></> : null}
      </p>
      {view === "error" ? (profiles.source === "error"
        ? <LoadErrorState result={profiles} area={t("profiles.area")} backHref="/admin/bulk-scan" />
        : <InlineError message={t("profiles.loadFailed")} onRetry={() => { void reload(); }} retryLabel={t("action.retry")} />) : null}
      {failed && items.length > 0 ? <InlineError message={t("profiles.loadFailed")} onRetry={() => { void reload(); }} retryLabel={t("action.retry")} /> : null}
      {view === "empty" ? <div className="card"><EmptyState icon="🗂" title={t("profiles.emptyTitle")} message={t("profiles.emptyMessage")} action={<Button onClick={() => open({ mode: "create" })}>{t("profiles.new")}</Button>} /></div> : null}
      {view === "ready" ? (
        <div className="card" style={{ overflowX: "auto" }}>
          <table className="tbl" style={{ width: "100%" }}>
            <caption className="sr-only">{t("profiles.tableCaption")}</caption>
            <thead><tr><th scope="col">{t("profiles.colName")}</th><th scope="col">{t("profiles.colOverrides")}</th><th scope="col">{t("profiles.colUpdated")}</th><th scope="col">{t("profiles.colActions")}</th></tr></thead>
            <tbody>
              {items.map((p) => (
                <tr key={p.id}>
                  <th scope="row" style={{ textAlign: "start" }}>{p.name}{p.description ? <span style={{ display: "block", fontSize: 12, fontWeight: 400 }}>{p.description}</span> : null}</th>
                  <td>{overrideKeys(p.config).length > 0 ? overrideKeys(p.config).map((k) => (["languages", "dpi", "preprocessingSteps", "reviewThreshold", "bestOf", "providerChain", "defaultDocType", "linkDefaults", "classification"].includes(k) ? t(`profiles.key.${k}`) : k)).join(", ") : t("profiles.noOverrides")}</td>
                  <td>{formatIndianDateTime(p.updatedAt)}</td>
                  <td>
                    <span style={{ display: "inline-flex", gap: 4 }}>
                      <Button size="sm" onClick={() => open({ mode: "edit", profile: p })} aria-label={t("profiles.editAria", { name: p.name })}>{t("action.edit")}</Button>
                      <Button size="sm" variant="danger" onClick={() => setDeleting(p)} aria-label={t("profiles.deleteAria", { name: p.name })}>{t("action.delete")}</Button>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      <Modal open={editing !== null} onClose={() => { if (!saving) setEditing(null); }} title={editing?.mode === "edit" ? t("profiles.editTitle") : t("profiles.newTitle")} size="lg">
        <form noValidate onSubmit={(e) => { e.preventDefault(); void save(); }} style={{ display: "grid", gap: 12 }} aria-label={t("profiles.formLabel")}>
          <p style={{ margin: 0, fontSize: 13 }}>{t("profiles.overrideHelp")}</p>
          <Field label={t("profiles.name")} required {...(issueText("name") ? { error: issueText("name") as string } : {})}>
            <Input value={form.name} onChange={(e) => upd({ name: e.target.value })} maxLength={120} />
          </Field>
          <Field label={t("profiles.description")} {...(issueText("description") ? { error: issueText("description") as string } : {})}>
            <Textarea rows={2} value={form.description} onChange={(e) => upd({ description: e.target.value })} maxLength={500} />
          </Field>

          <OverrideToggle label={t("profiles.overrideLanguages")} on={form.languages !== undefined} onChange={(on) => (on ? upd({ languages: ["eng"] }) : drop("languages"))} />
          {form.languages ? <LanguageGroup value={form.languages} onChange={(v) => upd({ languages: v })} error={issueText("config.languages")} /> : null}

          <OverrideToggle label={t("profiles.overrideDpi")} on={form.dpi !== undefined} onChange={(on) => (on ? upd({ dpi: 300 }) : drop("dpi"))} />
          {form.dpi !== undefined ? (
            <Field label={t("settings.dpi")} {...(issueText("config.dpi") ? { error: issueText("config.dpi") as string } : {})}>
              <Input type="number" min={150} max={600} value={Number.isNaN(form.dpi) ? "" : String(form.dpi)} onChange={(e) => upd({ dpi: numFromInput(e.target.value) })} />
            </Field>
          ) : null}

          <OverrideToggle label={t("profiles.overrideSteps")} on={form.preprocessingSteps !== undefined} onChange={(on) => (on ? upd({ preprocessingSteps: ["rotate", "deskew"] }) : drop("preprocessingSteps"))} />
          {form.preprocessingSteps ? <StepsGroup value={form.preprocessingSteps} onChange={(v) => upd({ preprocessingSteps: v })} error={issueText("config.preprocessingSteps")} /> : null}

          <OverrideToggle label={t("profiles.overrideThreshold")} on={form.reviewThreshold !== undefined} onChange={(on) => (on ? upd({ reviewThreshold: 0.8 }) : drop("reviewThreshold"))} />
          {form.reviewThreshold !== undefined ? <PercentField label={t("settings.reviewThreshold")} value={form.reviewThreshold} onChange={(v) => upd({ reviewThreshold: v ?? Number.NaN })} error={issueText("config.reviewThreshold", true)} /> : null}
          {form.reviewThreshold !== undefined ? <DirectionHint direction={dirs.reviewThreshold} /> : null}

          <OverrideToggle label={t("profiles.overrideChain")} on={form.providerChain !== undefined} onChange={(on) => (on ? upd({ providerChain: [{ id: "tesseract", timeoutMs: 120_000 }] }) : drop("providerChain"))} />
          {form.providerChain ? <ProviderChainEditor value={form.providerChain} onChange={(v) => upd({ providerChain: v })} providers={providers.data} providersFailed={providers.source === "error"} error={issueText("config.providerChain")} /> : null}
          {form.providerChain ? <DirectionHint direction={dirs.providerChain} /> : null}

          <OverrideToggle label={t("profiles.overrideBestOf")} on={form.bestOf !== undefined} onChange={(on) => (on ? upd({ bestOf: { enabled: true, threshold: 0.7 } }) : drop("bestOf"))} />
          {form.bestOf ? (
            <div style={{ display: "grid", gap: 8 }}>
              <label style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
                <input type="checkbox" checked={form.bestOf.enabled} onChange={(e) => upd({ bestOf: { ...form.bestOf!, enabled: e.target.checked } })} />{t("settings.bestOf")}
              </label>
              {issueText("config.bestOf.enabled") ? <div role="alert" style={{ color: "var(--bad)", fontSize: 13 }}>{issueText("config.bestOf.enabled")}</div> : null}
              <PercentField label={t("settings.bestOfThreshold")} value={form.bestOf.threshold} onChange={(v) => upd({ bestOf: { ...form.bestOf!, threshold: v ?? Number.NaN } })} error={issueText("config.bestOf.threshold", true)} />
            </div>
          ) : null}

          {form.bestOf ? <DirectionHint direction={dirs.bestOf} /> : null}
          <OverrideToggle label={t("profiles.overrideDocType")} on={form.defaultDocType !== undefined} onChange={(on) => (on ? upd({ defaultDocType: docTypes[0]?.id ?? "other" }) : drop("defaultDocType"))} />
          {form.defaultDocType !== undefined ? (
            <Field label={t("profiles.defaultDocType")}>
              <Select value={form.defaultDocType} onChange={(e) => upd({ defaultDocType: e.target.value })}>
                {docTypes.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
              </Select>
              <span style={{ fontSize: 12 }}>{t("profiles.presetTrusted")}</span>
              <DirectionHint direction={dirs.defaultDocType} />
            </Field>
          ) : null}

          <OverrideToggle label={t("profiles.overrideLink")} on={form.linkTarget !== undefined} onChange={(on) => (on ? upd({ linkTarget: allowedTargets[0] ?? "hr_employee" }) : drop("linkTarget"))} />
          {form.linkTarget !== undefined ? (
            <Field label={t("profiles.linkTarget")}>
              <Select value={form.linkTarget} onChange={(e) => upd({ linkTarget: e.target.value })}>
                {allowedTargets.map((x) => <option key={x} value={x}>{t(`target.${x}`)}</option>)}
              </Select>
            </Field>
          ) : null}

          <OverrideToggle label={t("profiles.overrideClassifier")} on={form.uncertainMargin !== undefined || form.minScore !== undefined} onChange={(on) => { if (on) upd({ uncertainMargin: 0.2 }); else { drop("uncertainMargin"); drop("minScore"); } }} />
          {form.uncertainMargin !== undefined || form.minScore !== undefined ? (
            <div style={{ display: "grid", gap: 8 }}>
              <PercentField label={t("settings.uncertainMargin")} optional value={form.uncertainMargin} onChange={(v) => (v === undefined ? drop("uncertainMargin") : upd({ uncertainMargin: v }))} error={issueText("config.classification.uncertainMargin", true)} help={t("settings.uncertainMarginHelp")} />
              <DirectionHint direction={dirs.uncertainMargin} />
              <PercentField label={t("settings.minScore")} optional value={form.minScore} onChange={(v) => (v === undefined ? drop("minScore") : upd({ minScore: v }))} error={issueText("config.classification.minScore", true)} help={t("settings.minScoreHelp")} />
              <DirectionHint direction={dirs.minScore} />
            </div>
          ) : null}

          {overall !== "unchanged" ? (
            <p role="note" style={{ margin: 0, fontSize: 13 }}>
              <span aria-hidden="true">{overall === "loosening" ? "⚠ " : "✓ "}</span>{overall === "loosening" ? t("settings.changeNeedsApproval") : t("settings.changeAppliesNow")}
            </p>
          ) : null}
          {needsReason || overall === "loosening" ? (
            <Field label={t("profiles.reasonLabel")} required={needsReason}>
              <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
              <span style={{ fontSize: 12 }}>{t("profiles.reasonHelp")}</span>
            </Field>
          ) : null}
          {error ? <InlineError message={error.message} reference={error.reference} /> : null}
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <Button variant="ghost" disabled={saving} onClick={() => setEditing(null)}>{t("action.cancel")}</Button>
            <Button type="submit" loading={saving}>{t("action.save")}</Button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        open={deleting !== null} title={t("profiles.deleteTitle")} description={t("profiles.deleteDesc", { name: deleting?.name ?? "" })} danger
        confirmLabel={t("action.delete")} cancelLabel={t("action.cancel")} busy={busy} {...(dialogError ? { errorMessage: dialogError } : {})}
        requireReason={deleteNeedsReason} optionalReason={!deleteNeedsReason} minReasonLength={3} maxReasonLength={500} reasonLabel={t("profiles.deleteReason")}
        onConfirm={(r) => { void remove(r); }} onCancel={() => { if (!busy) { setDeleting(null); setDialogError(undefined); setDeleteNeedsReason(false); } }}
      />
    </BulkScanShell>
  );
}
