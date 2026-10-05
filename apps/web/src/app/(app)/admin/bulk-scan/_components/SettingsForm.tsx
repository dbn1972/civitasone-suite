"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Button, ConfirmDialog, EmptyState, Field, Input, LoadErrorState, Select, Textarea } from "@/app/_components/ds";
import type { LoaderResult } from "@/app/_data/apiClient";
import { errorText, useBulkScanError, type BsError } from "@/lib/bulkScan/useBulkScanError";
import { bsRequest, QUEUED_RELOAD_DELAY_MS } from "@/lib/bulkScan/api";
import { changeDirections, overallDirection, requiresApprovalOf, routeOf, type View } from "@/lib/bulkScan/changeDirection";
import { mapSettings } from "@/lib/bulkScan/mappers";
import {
  bytesToMb, changedKeys, DUPLICATE_POLICIES, FIELD_KINDS, isSensitiveChange, LINK_TARGET_IDS, mbToBytes, PII_ACTIONS, PII_TYPES, pivotExamples,
  reasonSchema, settingsSchema, TWO_DIGIT_YEAR_PIVOT_DEFAULT, validateSettings, type BulkScanSettings, type FieldIssue,
} from "@/lib/bulkScan/settingsSchema";
import type { ChangeRequest, ProviderInfo, SettingsPayload } from "@/lib/bulkScan/types";
import { formatIndianDateTime } from "@/lib/formatters";
import { Chip } from "./Chips";
import { BulkScanShell, InlineError } from "./BulkScanShell";
import { Fieldset, DirectionHint, LanguageGroup, numFromInput, PercentField, ProviderChainEditor, StepsGroup, useIssueText } from "./SettingsFields";

/** Settings as loaded from the server: validated when it parses, otherwise used as-is so the admin can still see and fix it. */
export function initialDraft(payload: SettingsPayload | null): BulkScanSettings | null {
  if (!payload) return null;
  const r = settingsSchema.safeParse(payload.settings);
  return r.success ? r.data : (payload.settings as unknown as BulkScanSettings);
}

/** Who may do what with a pending change request: never the maker; a sensitive one needs a super_admin. */
export function requestActions(cr: Pick<ChangeRequest, "maker" | "sensitive">, currentUserId: string | null, isSuperAdmin: boolean): { approve: boolean; reject: boolean; reason: "own" | "superAdmin" | null } {
  const own = currentUserId !== null && cr.maker === currentUserId;
  if (own) return { approve: false, reject: false, reason: "own" };
  if (cr.sensitive && !isSuperAdmin) return { approve: false, reject: true, reason: "superAdmin" };
  return { approve: true, reject: true, reason: null };
}

const shortId = (id: string | null): string => (id ? id.slice(0, 8) : "—");

/** A pending request that changes a scan profile (create / update / delete) rather than the tenant settings. */
export const isProfileChange = (cr: Pick<ChangeRequest, "kind" | "profileId" | "profileChange">): boolean => cr.kind === "profile" || cr.profileId !== null || cr.profileChange !== null;

interface Props {
  settings: LoaderResult<SettingsPayload | null>;
  providers: LoaderResult<ProviderInfo[]>;
  currentUserId: string | null;
  isSuperAdmin: boolean;
}

export function SettingsForm({ settings, providers, currentUserId, isSuperAdmin }: Props) {
  const t = useTranslations("bulkScan");
  const describe = useBulkScanError();
  const [loaded, setLoaded] = useState<SettingsPayload | null>(settings.data);
  const [draft, setDraft] = useState<BulkScanSettings | null>(() => initialDraft(settings.data));
  const [issues, setIssues] = useState<FieldIssue[]>([]);
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<BsError | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState<{ kind: "approve" | "reject"; cr: ChangeRequest } | null>(null);
  const [busy, setBusy] = useState(false);
  const [dialogError, setDialogError] = useState<string | undefined>(undefined);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const issueText = useIssueText(issues);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const current = loaded?.settings as unknown as BulkScanSettings | undefined;
  const dirty = useMemo(() => (draft && current ? JSON.stringify(draft) !== JSON.stringify(current) : false), [draft, current]);
  const sensitive = draft && current ? isSensitiveChange(current, draft) : false;
  // Mirror of the server's tightening / loosening rule (the server stays authoritative).
  const dirs = useMemo(() => (draft && current ? changeDirections(current as unknown as View, draft as unknown as View) : {}), [draft, current]);
  const overall = overallDirection(dirs);
  const route = draft && current ? routeOf(current as unknown as View, draft as unknown as View, "settings") : "none";

  async function reloadSettings(): Promise<void> {
    const r = await bsRequest("/settings");
    const p = r.ok ? mapSettings(r.json) : null;
    if (p) setLoaded(p);
  }

  if (!draft || !loaded) {
    return (
      <BulkScanShell title={t("settings.title")} active="settings">
        {settings.source === "error"
          ? <LoadErrorState result={settings} area={t("settings.area")} backHref="/admin/bulk-scan" />
          : <div className="card"><EmptyState icon="⚙️" title={t("settings.noneTitle")} message={t("settings.noneMessage")} /></div>}
      </BulkScanShell>
    );
  }
  const d = draft;
  const set = (p: Partial<BulkScanSettings>): void => setDraft({ ...d, ...p });

  async function submit(): Promise<void> {
    setNotice(null);
    setError(null);
    const v = validateSettings(d);
    setIssues(v.ok ? [] : v.issues);
    let rErr = false;
    if (sensitive && !reasonSchema.safeParse(reason).success) rErr = true;
    if (reason.trim() !== "" && !reasonSchema.safeParse(reason).success) rErr = true;
    setReasonError(rErr);
    if (!v.ok || rErr) return;
    setSaving(true);
    const r = await bsRequest("/settings", { method: "PUT", body: { settings: v.data, ...(reason.trim() ? { reason: reason.trim() } : {}) } });
    setSaving(false);
    if (!r.ok) { setError(describe(r)); return; }
    const approval = requiresApprovalOf(r.json);
    setNotice(approval === true ? t("settings.submittedApproval") : approval === false ? t("settings.applied") : sensitive ? t("settings.submittedSensitive") : t("settings.submitted"));
    setReason("");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { void reloadSettings(); }, QUEUED_RELOAD_DELAY_MS);
  }

  async function decide(reasonText?: string): Promise<void> {
    if (!pending) return;
    setBusy(true);
    setDialogError(undefined);
    const r = await bsRequest(`/settings/change-requests/${encodeURIComponent(pending.cr.id)}/${pending.kind}`, {
      method: "POST", body: pending.kind === "reject" ? { reason: reasonText ?? "" } : (reasonText ? { reason: reasonText } : {}),
    });
    setBusy(false);
    if (!r.ok) { setDialogError(errorText(describe(r))); return; }
    setPending(null);
    setNotice(t("settings.decisionQueued"));
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      void bsRequest("/settings").then((x) => {
        const p = x.ok ? mapSettings(x.json) : null;
        if (p) { setLoaded(p); setDraft(initialDraft(p)); setNotice(null); }
      });
    }, QUEUED_RELOAD_DELAY_MS);
  }

  const ex = pivotExamples(Number.isFinite(d.twoDigitYearPivot) ? d.twoDigitYearPivot : TWO_DIGIT_YEAR_PIVOT_DEFAULT);

  return (
    <BulkScanShell title={t("settings.title")} subtitle={t("settings.subtitle")} active="settings">
      <div role="note" className="card" style={{ padding: 12, marginBottom: 16, borderInlineStart: "4px solid var(--info)" }}>
        <strong><span aria-hidden="true">ℹ </span>{t("settings.makerCheckerTitle")}</strong>
        <p style={{ margin: "4px 0 0" }}>{t("settings.makerChecker")}</p>
      </div>
      {loaded.degraded ? <div role="alert" className="card" style={{ padding: 12, marginBottom: 16, borderInlineStart: "4px solid var(--warn)" }}><span aria-hidden="true">⚠ </span>{t("settings.degraded")}</div> : null}

      <PendingRequests
        requests={loaded.pendingRequests} current={current ?? d} currentUserId={currentUserId} isSuperAdmin={isSuperAdmin}
        onAction={(kind, cr) => setPending({ kind, cr })}
      />

      <form noValidate onSubmit={(e) => { e.preventDefault(); void submit(); }} aria-label={t("settings.formLabel")} style={{ display: "grid", gap: 16 }}>
        {issues.length > 0 ? (
          <div role="alert" className="card" style={{ padding: 12, borderInlineStart: "4px solid var(--bad)" }}>
            <strong>{t("settings.fixErrors", { count: issues.length })}</strong>
            <ul style={{ margin: "4px 0 0", paddingInlineStart: 20 }}>{issues.slice(0, 8).map((i, n) => <li key={n}><code>{i.path || "—"}</code>: {t(`settings.${i.key}`, i.params)}</li>)}</ul>
          </div>
        ) : null}

        <Fieldset legend={t("settings.secProviders")}>
          <ProviderChainEditor value={d.providerChain} onChange={(v) => set({ providerChain: v as BulkScanSettings["providerChain"] })} providers={providers.data} providersFailed={providers.source === "error"} error={issueText("providerChain")} />
          <DirectionHint direction={dirs.providerChain} />
          <label style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
            <input type="checkbox" checked={d.bestOf.enabled} onChange={(e) => set({ bestOf: { ...d.bestOf, enabled: e.target.checked } })} />
            {t("settings.bestOf")}
          </label>
          {issueText("bestOf.enabled") ? <div role="alert" style={{ color: "var(--bad)", fontSize: 13 }}>{issueText("bestOf.enabled")}</div> : null}
          <DirectionHint direction={dirs.bestOf} />
          <PercentField label={t("settings.bestOfThreshold")} value={d.bestOf.threshold} onChange={(v) => set({ bestOf: { ...d.bestOf, threshold: v ?? Number.NaN } })} error={issueText("bestOf.threshold", true)} help={t("settings.bestOfHelp")} />
        </Fieldset>

        <Fieldset legend={t("settings.secRecognition")}>
          <LanguageGroup value={d.languages} onChange={(v) => set({ languages: v as BulkScanSettings["languages"] })} error={issueText("languages")} />
          <Field label={t("settings.dpi")} {...(issueText("dpi") ? { error: issueText("dpi") as string } : {})}>
            <Input type="number" min={150} max={600} value={Number.isNaN(d.dpi) ? "" : String(d.dpi)} onChange={(e) => set({ dpi: numFromInput(e.target.value) })} />
          </Field>
          <StepsGroup value={d.preprocessingSteps} onChange={(v) => set({ preprocessingSteps: v as BulkScanSettings["preprocessingSteps"] })} error={issueText("preprocessingSteps")} />
          <PercentField label={t("settings.reviewThreshold")} value={d.reviewThreshold} onChange={(v) => set({ reviewThreshold: v ?? Number.NaN })} error={issueText("reviewThreshold", true)} help={t("settings.reviewThresholdHelp")} />
          <DirectionHint direction={dirs.reviewThreshold} />
        </Fieldset>

        <Fieldset legend={t("settings.secClassification")} help={t("settings.classificationHelp")}>
          <DocTypesEditor d={d} onChange={(docTypes) => set({ classification: { ...d.classification, docTypes } })} issueText={issueText} />
          <PercentField label={t("settings.uncertainBelow")} value={d.classification.uncertainBelow} onChange={(v) => set({ classification: { ...d.classification, uncertainBelow: v ?? Number.NaN } })} error={issueText("classification.uncertainBelow", true)} help={t("settings.uncertainBelowHelp")} />
          <DirectionHint direction={dirs.classification} />
          <PercentField label={t("settings.uncertainMargin")} optional value={d.classification.uncertainMargin} onChange={(v) => set({ classification: omitUndefined({ ...d.classification, uncertainMargin: v }) })} error={issueText("classification.uncertainMargin", true)} help={t("settings.uncertainMarginHelp")} />
          <DirectionHint direction={dirs.uncertainMargin} />
          <PercentField label={t("settings.minScore")} optional value={d.classification.minScore} onChange={(v) => set({ classification: omitUndefined({ ...d.classification, minScore: v }) })} error={issueText("classification.minScore", true)} help={t("settings.minScoreHelp")} />
          <DirectionHint direction={dirs.minScore} />
        </Fieldset>

        <Fieldset legend={t("settings.secPii")} help={t("settings.piiHelp")}>
          {PII_TYPES.map((p) => (
            <Field key={p} label={t(`pii.${p}`)}>
              <Select value={d.pii.policy[p]} onChange={(e) => set({ pii: { ...d.pii, policy: { ...d.pii.policy, [p]: e.target.value as BulkScanSettings["pii"]["policy"][typeof p] } } })}>
                {PII_ACTIONS.map((a) => <option key={a} value={a}>{t(`piiAction.${a}`)}</option>)}
              </Select>
            </Field>
          ))}
          <label style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
            <input type="checkbox" checked={d.pii.reviewOnDetect} onChange={(e) => set({ pii: { ...d.pii, reviewOnDetect: e.target.checked } })} />
            {t("settings.reviewOnDetect")}
          </label>
          <DirectionHint direction={dirs.pii} />
        </Fieldset>

        <Fieldset legend={t("settings.secSafety")}>
          <label style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
            <input type="checkbox" checked={d.malwareFailClosed} onChange={(e) => set({ malwareFailClosed: e.target.checked })} aria-describedby="malware-help" />
            <strong>{t("settings.malwareFailClosed")}</strong>
          </label>
          <p id="malware-help" style={{ margin: 0, fontSize: 13 }}>{t("settings.malwareHelp")}</p>
          <DirectionHint direction={dirs.malwareFailClosed} />
          {sensitive ? (
            <div role="alert" className="card" style={{ padding: 12, borderInlineStart: "4px solid var(--bad)" }}>
              <strong><span aria-hidden="true">⚠ </span>{t("settings.malwareOffTitle")}</strong>
              <p style={{ margin: "4px 0" }}>{t("settings.malwareOffBody")}</p>
              <Field label={t("settings.malwareOffReason")} required {...(reasonError ? { error: t("settings.err.reasonRequired") } : {})}>
                <Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
              </Field>
            </div>
          ) : null}
          <Field label={t("settings.duplicatePolicy")}>
            <Select value={d.duplicatePolicy} onChange={(e) => set({ duplicatePolicy: e.target.value as BulkScanSettings["duplicatePolicy"] })}>
              {DUPLICATE_POLICIES.map((p) => <option key={p} value={p}>{t(`duplicate.${p}`)}</option>)}
            </Select>
          </Field>
          <DirectionHint direction={dirs.duplicatePolicy} />
        </Fieldset>

        <Fieldset legend={t("settings.secLimits")}>
          <Field label={t("settings.maxFileMb")} {...(issueText("limits.maxFileBytes") ? { error: issueText("limits.maxFileBytes") as string } : {})}>
            <Input type="number" min={0.01} step={1} value={Number.isNaN(d.limits.maxFileBytes) ? "" : String(bytesToMb(d.limits.maxFileBytes))} onChange={(e) => set({ limits: { ...d.limits, maxFileBytes: mbToBytes(numFromInput(e.target.value)) } })} />
          </Field>
          <Field label={t("settings.maxFiles")} {...(issueText("limits.maxFilesPerBatch") ? { error: issueText("limits.maxFilesPerBatch") as string } : {})}>
            <Input type="number" min={1} value={Number.isNaN(d.limits.maxFilesPerBatch) ? "" : String(d.limits.maxFilesPerBatch)} onChange={(e) => set({ limits: { ...d.limits, maxFilesPerBatch: numFromInput(e.target.value) } })} />
          </Field>
          <Field label={t("settings.maxBatchMb")} {...(issueText("limits.maxBatchBytes") ? { error: issueText("limits.maxBatchBytes") as string } : {})}>
            <Input type="number" min={0.01} step={1} value={Number.isNaN(d.limits.maxBatchBytes) ? "" : String(bytesToMb(d.limits.maxBatchBytes))} onChange={(e) => set({ limits: { ...d.limits, maxBatchBytes: mbToBytes(numFromInput(e.target.value)) } })} />
          </Field>
          <Field label={t("settings.concurrency")} {...(issueText("concurrency") ? { error: issueText("concurrency") as string } : {})}>
            <Input type="number" min={1} max={8} value={Number.isNaN(d.concurrency) ? "" : String(d.concurrency)} onChange={(e) => set({ concurrency: numFromInput(e.target.value) })} />
          </Field>
          <Field label={t("settings.maxAttempts")} {...(issueText("maxAttempts") ? { error: issueText("maxAttempts") as string } : {})}>
            <Input type="number" min={1} max={10} value={Number.isNaN(d.maxAttempts) ? "" : String(d.maxAttempts)} onChange={(e) => set({ maxAttempts: numFromInput(e.target.value) })} />
          </Field>
        </Fieldset>

        <Fieldset legend={t("settings.secLinking")}>
          <div role="group" aria-label={t("settings.allowedTargets")}>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>{t("settings.allowedTargets")}</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
              {LINK_TARGET_IDS.map((x) => (
                <label key={x} style={{ display: "inline-flex", gap: 4, alignItems: "center" }}>
                  <input type="checkbox" checked={d.allowedLinkTargets.includes(x)} onChange={(e) => set({ allowedLinkTargets: e.target.checked ? [...d.allowedLinkTargets, x] : d.allowedLinkTargets.filter((y) => y !== x) })} />
                  {t(`target.${x}`)}
                </label>
              ))}
            </div>
            <DirectionHint direction={dirs.allowedLinkTargets} />
          </div>
          <label style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
            <input type="checkbox" checked={d.filingMakerChecker} onChange={(e) => set({ filingMakerChecker: e.target.checked })} />
            {t("settings.filingMakerChecker")}
          </label>
          <span style={{ fontSize: 13 }}>{t("settings.filingMakerCheckerHelp")}</span>
          <DirectionHint direction={dirs.filingMakerChecker} />
        </Fieldset>

        <Fieldset legend={t("settings.secRetention")} help={t("settings.retentionHelp")}>
          {d.classification.docTypes.map((dt) => (
            <Field key={dt.id} label={t("settings.retentionFor", { type: dt.label })} {...(issueText(`retentionDaysByType.${dt.id}`) ? { error: issueText(`retentionDaysByType.${dt.id}`) as string } : {})}>
              <Input type="number" min={1} max={36500} placeholder={t("settings.retentionNone")} value={d.retentionDaysByType[dt.id] === undefined ? "" : String(d.retentionDaysByType[dt.id])}
                onChange={(e) => {
                  const next = { ...d.retentionDaysByType };
                  if (e.target.value.trim() === "") delete next[dt.id]; else next[dt.id] = numFromInput(e.target.value);
                  set({ retentionDaysByType: next });
                }} />
            </Field>
          ))}
          <DirectionHint direction={dirs.retention} />
        </Fieldset>

        <Fieldset legend={t("settings.secDates")}>
          <Field label={t("settings.pivot")} {...(issueText("twoDigitYearPivot") ? { error: issueText("twoDigitYearPivot") as string } : {})}>
            <Input type="number" min={0} max={99} step={1} aria-describedby="pivot-help" value={Number.isNaN(d.twoDigitYearPivot) ? "" : String(d.twoDigitYearPivot)} onChange={(e) => set({ twoDigitYearPivot: numFromInput(e.target.value) })} />
          </Field>
          <p id="pivot-help" style={{ margin: 0, fontSize: 13 }}>{t("settings.pivotHelp", { low: ex.low, high: ex.high, default: TWO_DIGIT_YEAR_PIVOT_DEFAULT })}</p>
        </Fieldset>

        {!sensitive ? (
          <Field label={t("settings.reasonOptional")} {...(reasonError ? { error: t("settings.err.reasonRequired") } : {})}>
            <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
          </Field>
        ) : null}
        {dirty && overall !== "unchanged" ? (
          <p role="note" style={{ margin: 0, fontSize: 13 }}>
            <span aria-hidden="true">{overall === "loosening" ? "⚠ " : "✓ "}</span>{overall === "loosening" ? t("settings.changeNeedsApproval") : route === "request" ? t("settings.changeNeedsRequest") : t("settings.changeAppliesNow")}
          </p>
        ) : null}
        {error ? <InlineError message={error.message} reference={error.reference} /> : null}
        <p role="status" aria-live="polite" style={{ margin: 0, minHeight: 18 }}>{notice ?? ""}</p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Button type="submit" loading={saving} disabled={!dirty}>{t("settings.submit")}</Button>
          <Button variant="ghost" disabled={!dirty || saving} onClick={() => { setDraft(initialDraft(loaded)); setIssues([]); setReason(""); setReasonError(false); }}>{t("settings.discard")}</Button>
          {!dirty ? <span style={{ fontSize: 13, alignSelf: "center" }}>{t("settings.noChanges")}</span> : null}
        </div>
      </form>

      <ConfirmDialog
        open={pending !== null} title={pending?.kind === "approve" ? t("settings.approveTitle") : t("settings.rejectTitle")}
        description={pending?.kind === "approve" ? (pending.cr.sensitive ? t("settings.approveSensitiveDesc") : t("settings.approveDesc")) : t("settings.rejectDesc")}
        danger={pending?.kind === "reject" || pending?.cr.sensitive === true} requireReason={pending?.kind === "reject"} optionalReason={pending?.kind === "approve"} minReasonLength={3} maxReasonLength={500}
        reasonLabel={t("settings.decisionReason")} confirmLabel={pending?.kind === "approve" ? t("action.approve") : t("action.reject")} cancelLabel={t("action.cancel")} busy={busy}
        {...(dialogError ? { errorMessage: dialogError } : {})}
        onConfirm={(r) => { void decide(r); }} onCancel={() => { if (!busy) { setPending(null); setDialogError(undefined); } }}
      />
    </BulkScanShell>
  );
}

function omitUndefined<T extends Record<string, unknown>>(o: T): T {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;
}

function PendingRequests({ requests, current, currentUserId, isSuperAdmin, onAction }: {
  requests: ChangeRequest[]; current: BulkScanSettings; currentUserId: string | null; isSuperAdmin: boolean; onAction: (kind: "approve" | "reject", cr: ChangeRequest) => void;
}) {
  const t = useTranslations("bulkScan");
  return (
    <section aria-labelledby="pending-h" className="card" style={{ padding: 16, marginBottom: 16 }}>
      <h2 id="pending-h" style={{ margin: "0 0 8px", fontSize: 16 }}>{t("settings.pendingTitle")}</h2>
      {requests.length < 1 ? <p style={{ margin: 0 }}>{t("settings.pendingNone")}</p> : (
        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 8 }}>
          {requests.map((cr) => {
            const a = requestActions(cr, currentUserId, isSuperAdmin);
            const profile = isProfileChange(cr);
            const pc = cr.profileChange;
            const op = pc && typeof pc.op === "string" && ["create", "update", "delete"].includes(pc.op) ? pc.op : "other";
            const profileName = pc && typeof pc.name === "string" ? pc.name : null;
            const profileConfig = pc && pc.config !== null && typeof pc.config === "object" ? (pc.config as Record<string, unknown>) : cr.proposed;
            const keys = profile ? Object.keys(profileConfig) : changedKeys(current as unknown as Record<string, unknown>, cr.proposed);
            return (
              <li key={cr.id} className="card" style={{ padding: 12, display: "grid", gap: 4 }}>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                  <Chip tone="warn" icon="⏳">{t("settings.awaitingSecond")}</Chip>
                  {profile ? <Chip tone="info" icon="🗂">{t(`settings.profileOp_${op}`)}</Chip> : null}
                  {cr.sensitive ? <Chip tone="bad" icon="⚠">{t("settings.needsSuperAdmin")}</Chip> : null}
                  <span style={{ fontSize: 13 }}>{t("settings.requestedBy", { who: shortId(cr.maker) })}{currentUserId !== null && cr.maker === currentUserId ? ` (${t("links.you")})` : ""} · {formatIndianDateTime(cr.createdAt)}</span>
                </div>
                {profile && profileName ? <div style={{ fontSize: 13 }}>{t("settings.profileName", { name: profileName })}</div> : null}
                <div style={{ fontSize: 13 }}>{profile ? t("settings.profileChange") : t("settings.changes")}: {keys.length > 0 ? keys.join(", ") : "—"}</div>
                {cr.reason ? <div style={{ fontSize: 13 }}>{t("settings.reason")}: {cr.reason}</div> : null}
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                  <Button size="sm" disabled={!a.approve} onClick={() => onAction("approve", cr)} aria-label={t("settings.approveAria", { who: shortId(cr.maker) })}>{t("action.approve")}</Button>
                  <Button size="sm" variant="danger" disabled={!a.reject} onClick={() => onAction("reject", cr)} aria-label={t("settings.rejectAria", { who: shortId(cr.maker) })}>{t("action.reject")}</Button>
                  {a.reason === "own" ? <span style={{ fontSize: 13 }}>{t("settings.ownRequest")}</span> : null}
                  {a.reason === "superAdmin" ? <span style={{ fontSize: 13 }}>{t("settings.superAdminOnly")}</span> : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function DocTypesEditor({ d, onChange, issueText }: {
  d: BulkScanSettings; onChange: (v: BulkScanSettings["classification"]["docTypes"]) => void; issueText: (p: string, percent?: boolean) => string | undefined;
}) {
  const t = useTranslations("bulkScan");
  const list = d.classification.docTypes;
  const [rowIds, setRowIds] = useState<number[]>(() => list.map((_, i) => i));
  const nextId = useRef(list.length);
  const patch = (i: number, p: Partial<(typeof list)[number]>): void => onChange(list.map((x, n) => (n === i ? { ...x, ...p } : x)));
  const err = issueText("classification.docTypes");
  return (
    <div role="group" aria-labelledby="dt-h">
      <div id="dt-h" style={{ fontWeight: 600, marginBottom: 4 }}>{t("settings.docTypes")}</div>
      {err ? <div role="alert" style={{ color: "var(--bad)", fontSize: 13 }}>{err}</div> : null}
      <div style={{ display: "grid", gap: 8 }}>
        {list.map((dt, i) => (
          <DocTypeRow key={rowIds[i] ?? i} dt={dt} index={i} locked={dt.id === "other"} onPatch={(p) => patch(i, p)}
            onRemove={() => { onChange(list.filter((_, n) => n !== i)); setRowIds(rowIds.filter((_, n) => n !== i)); }}
            idError={issueText(`classification.docTypes.${i}.id`)} />
        ))}
      </div>
      <div style={{ marginTop: 8 }}>
        <Button size="sm" variant="secondary" onClick={() => { onChange([...list, { id: "", label: "", keywords: [], requiredFields: [] }]); setRowIds([...rowIds, nextId.current++]); }}>{t("settings.addDocType")}</Button>
      </div>
    </div>
  );
}

function DocTypeRow({ dt, index, locked, onPatch, onRemove, idError }: {
  dt: BulkScanSettings["classification"]["docTypes"][number]; index: number; locked: boolean;
  onPatch: (p: Partial<BulkScanSettings["classification"]["docTypes"][number]>) => void; onRemove: () => void; idError: string | undefined;
}) {
  const t = useTranslations("bulkScan");
  const [kw, setKw] = useState(dt.keywords.join(", "));
  return (
    <div className="card" style={{ padding: 10, display: "grid", gap: 8 }}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <Field label={t("settings.docTypeId")} {...(idError ? { error: idError } : {})}>
          <Input value={dt.id} onChange={(e) => onPatch({ id: e.target.value })} maxLength={40} />
        </Field>
        <Field label={t("settings.docTypeLabel")}>
          <Input value={dt.label} onChange={(e) => onPatch({ label: e.target.value })} maxLength={80} />
        </Field>
      </div>
      <Field label={t("settings.docTypeKeywords")}>
        <Input value={kw} onChange={(e) => { setKw(e.target.value); onPatch({ keywords: e.target.value.split(",").map((x) => x.trim()).filter(Boolean) }); }} />
      </Field>
      <div role="group" aria-label={t("settings.docTypeRequired", { n: index + 1 })}>
        <div style={{ fontSize: 13, fontWeight: 600 }}>{t("settings.docTypeRequired", { n: index + 1 })}</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
          {FIELD_KINDS.map((k) => (
            <label key={k} style={{ display: "inline-flex", gap: 4, alignItems: "center", fontSize: 13 }}>
              <input type="checkbox" checked={dt.requiredFields.includes(k)} onChange={(e) => onPatch({ requiredFields: e.target.checked ? [...dt.requiredFields, k] : dt.requiredFields.filter((x) => x !== k) })} />
              {t(`field.${k}`)}
            </label>
          ))}
        </div>
      </div>
      <div><Button size="sm" variant="ghost" disabled={locked} onClick={onRemove} aria-label={t("settings.removeDocType", { n: index + 1 })}>{locked ? t("settings.docTypeFixed") : t("action.remove")}</Button></div>
    </div>
  );
}
