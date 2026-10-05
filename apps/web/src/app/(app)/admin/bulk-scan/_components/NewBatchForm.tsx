"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Button, EmptyState, Field, Input, LoadErrorState, Select } from "@/app/_components/ds";
import type { LoaderResult } from "@/app/_data/apiClient";
import { errorText, useBulkScanError } from "@/lib/bulkScan/useBulkScanError";
import { formatReference } from "@/lib/errorCatalogue";
import { bsRequest, } from "@/lib/bulkScan/api";
import { buildCreateBatchBody, EMPTY_BATCH_FORM, validateBatchForm, waitForBatchDelays, type BatchFormErrors, type BatchFormValues } from "@/lib/bulkScan/batchForm";
import { collectFromDataTransfer, collectFromFileList, type DroppedFile } from "@/lib/bulkScan/folderDrop";
import { mapBatch } from "@/lib/bulkScan/mappers";
import { allowedTargetsFromSettings, docTypesFromSettings, limitsFromSettings } from "@/lib/bulkScan/settingsView";
import type { BatchFileView, BatchView, Paged, ProfileRow, SettingsPayload } from "@/lib/bulkScan/types";
import { formatBytes } from "@/lib/bulkScan/status";
import { applyBatchLimits, validateFile, type Candidate, attachHashes } from "@/lib/bulkScan/uploadValidation";
import { initialUploadState, matchServerFiles, toManifest, unfinishedFromManifest, uploadedKeysFromManifest, uploadReducer, type ManifestEntry, type UploadItem } from "@/lib/bulkScan/uploadQueue";
import type { PutFn } from "@/lib/bulkScan/xhrPut";
import { Chip, Meter } from "./Chips";
import { BulkScanShell, InlineError } from "./BulkScanShell";
import { useUploadEngine } from "./useUploadEngine";

export interface FolderOption { id: string; name: string; path: string }

const MANIFEST_KEY = (batchId: string): string => `bulkScan.upload.${batchId}`;

function readManifest(batchId: string): ManifestEntry[] {
  try {
    const raw = window.localStorage.getItem(MANIFEST_KEY(batchId));
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as ManifestEntry[]).filter((m) => typeof m?.name === "string" && typeof m?.size === "number") : [];
  } catch {
    return [];
  }
}
function writeManifest(batchId: string, m: ManifestEntry[]): void {
  try { window.localStorage.setItem(MANIFEST_KEY(batchId), JSON.stringify(m)); } catch { /* storage unavailable: resume then relies on the server file list only */ }
}

interface Props {
  settings: LoaderResult<SettingsPayload | null>;
  profiles: LoaderResult<ProfileRow[]>;
  folders: LoaderResult<FolderOption[]>;
  /** resume mode: an existing batch (?batch=<id>) */
  resume?: { batch: LoaderResult<BatchView | null>; files: LoaderResult<Paged<BatchFileView>> } | null;
  /** test seam: replaces the XHR PUT */
  put?: PutFn;
}

export function NewBatchForm({ settings, profiles, folders, resume = null, put }: Props) {
  const t = useTranslations("bulkScan");
  const describe = useBulkScanError();
  const limits = useMemo(() => limitsFromSettings(settings.data), [settings.data]);
  const docTypes = useMemo(() => docTypesFromSettings(settings.data), [settings.data]);
  const allowedTargets = useMemo(() => allowedTargetsFromSettings(settings.data), [settings.data]);

  const [values, setValues] = useState<BatchFormValues>(EMPTY_BATCH_FORM);
  const [errors, setErrors] = useState<BatchFormErrors>({});
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [batch, setBatch] = useState<BatchView | null>(resume?.batch.data ?? null);
  const [serverFiles] = useState<BatchFileView[]>(resume?.files.data.items ?? []);
  const [checking, setChecking] = useState(0);
  const [dragOver, setDragOver] = useState(false);
  const [manifest, setManifest] = useState<ManifestEntry[]>([]);
  const fileInput = useRef<HTMLInputElement>(null);
  const dirInput = useRef<HTMLInputElement>(null);

  const engine = useUploadEngine(batch?.id ?? null, put ? { put } : {});
  const { state, summary } = engine;

  useEffect(() => { if (batch) setManifest(readManifest(batch.id)); }, [batch]);
  useEffect(() => { if (batch && state.items.length > 0) writeManifest(batch.id, toManifest(state)); }, [batch, state]);

  const set = (k: keyof BatchFormValues) => (e: { target: { value: string } }): void => setValues((v) => ({ ...v, [k]: e.target.value }));

  async function createBatch(): Promise<void> {
    const errs = validateBatchForm(values, { docTypeIds: docTypes.map((d) => d.id), allowedTargets });
    setErrors(errs);
    if (Object.keys(errs).length > 0) return;
    setCreating(true);
    setCreateError(null);
    const r = await bsRequest("/batches", { method: "POST", body: buildCreateBatchBody(values) });
    if (!r.ok) { setCreating(false); setCreateError(errorText(describe(r))); return; }
    const id = r.json !== null && typeof r.json === "object" ? (r.json as Record<string, unknown>).id : null;
    if (typeof id !== "string") { setCreating(false); setCreateError(t("new.createBadResponse")); return; }
    // 202: the batch row is written by a worker. Wait (bounded) until it can be read before asking for upload URLs.
    for (const ms of waitForBatchDelays()) {
      await new Promise((res) => setTimeout(res, ms));
      const g = await bsRequest(`/batches/${encodeURIComponent(id)}`);
      const b = g.ok ? mapBatch(g.json) : null;
      if (b) { setBatch(b); setCreating(false); return; }
    }
    setCreating(false);
    setCreateError(t("new.createSlow"));
  }

  const addFiles = useCallback(async (dropped: DroppedFile[]): Promise<void> => {
    if (!batch || dropped.length === 0) return;
    setChecking((n) => n + dropped.length);
    const fileMap = new Map<string, File>();
    const cands: Candidate[] = [];
    for (let i = 0; i < dropped.length; i += 8) {
      const chunk = await Promise.all(dropped.slice(i, i + 8).map((d) => validateFile(d.file, d.relPath, limits)));
      chunk.forEach((c, n) => { cands.push(c); fileMap.set(c.key, dropped[i + n]!.file); });
    }
    // Resume: match re-selected files to the server's rows by content hash when the server has one (otherwise by name + size).
    const matchOpts = { uploadedKeys: uploadedKeysFromManifest(manifest) };
    const hashed = serverFiles.some((f) => f.sha256) ? await attachHashes(cands, fileMap) : cands;
    const queuedValid = state.items.filter((x) => x.status !== "invalid");
    const existing = {
      fileCount: batch.fileCount + queuedValid.length,
      totalBytes: batch.totalBytes + queuedValid.reduce((a, x) => a + x.size, 0),
    };
    // Files the server already holds (resume) are not new: they must not be counted against the batch limits a second time.
    const held = new Set(matchServerFiles(uploadReducer(initialUploadState, { type: "add", candidates: hashed }), serverFiles, matchOpts).map((m) => m.key));
    const limited = new Map(applyBatchLimits(hashed.filter((c) => !held.has(c.key)), existing, limits).map((c) => [c.key, c]));
    engine.addCandidates(hashed.map((c) => limited.get(c.key) ?? c), fileMap, serverFiles, matchOpts);
    setChecking((n) => Math.max(0, n - dropped.length));
  }, [batch, limits, state.items, engine, serverFiles, manifest]);

  const onDrop = (e: DragEvent<HTMLElement>): void => {
    e.preventDefault();
    setDragOver(false);
    void collectFromDataTransfer(e.dataTransfer).then(addFiles);
  };

  // ── render ──
  if (resume && !batch) {
    return (
      <BulkScanShell title={t("new.title")} back="/admin/bulk-scan">
        {resume.batch.status === 404
          ? <div className="card"><EmptyState icon="🔎" title={t("detail.notFoundTitle")} message={t("detail.notFoundMessage")} /></div>
          : <LoadErrorState result={resume.batch} area={t("detail.area")} backHref="/admin/bulk-scan" />}
      </BulkScanShell>
    );
  }

  const unfinished = unfinishedFromManifest(manifest).filter((m) => !state.items.some((i) => i.key === m.key));
  const pendingOnServer = serverFiles.filter((f) => f.state === "pending_upload").length;

  return (
    <BulkScanShell title={batch ? t("new.uploadTitle", { name: batch.name }) : t("new.title")} subtitle={t("new.subtitle")} active="batches" back="/admin/bulk-scan">
      {!batch ? (
        <form className="card" style={{ padding: 16, display: "grid", gap: 16, maxWidth: 720 }} noValidate onSubmit={(e) => { e.preventDefault(); void createBatch(); }} aria-label={t("new.formLabel")}>
          {settings.source === "error" ? <InlineError message={t("new.settingsUnavailable")} /> : null}
          <Field label={t("new.name")} required {...(errors.name ? { error: t(`new.err.${errors.name}`) } : {})}>
            <Input value={values.name} onChange={set("name")} maxLength={200} autoComplete="off" />
          </Field>
          <Field label={t("new.folder")} {...(errors.targetFolderId ? { error: t(`new.err.${errors.targetFolderId}`) } : {})}>
            <Select value={values.targetFolderId} onChange={set("targetFolderId")} disabled={folders.source === "error"}>
              <option value="">{folders.source === "error" ? t("new.folderUnavailable") : t("new.folderDefault")}</option>
              {folders.data.map((f) => <option key={f.id} value={f.id}>{f.path === "/" ? f.name : f.path}</option>)}
            </Select>
          </Field>
          <Field label={t("new.tags")} {...(errors.tags ? { error: t(`new.err.${errors.tags}`) } : {})}>
            <Input value={values.tags} onChange={set("tags")} placeholder={t("new.tagsPlaceholder")} />
          </Field>
          <Field label={t("new.docType")} {...(errors.defaultDocType ? { error: t(`new.err.${errors.defaultDocType}`) } : {})}>
            <Select value={values.defaultDocType} onChange={set("defaultDocType")}>
              <option value="">{t("new.docTypeAuto")}</option>
              {docTypes.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
            </Select>
          </Field>
          <Field label={t("new.linkTarget")} {...(errors.linkTarget ? { error: t(`new.err.${errors.linkTarget}`) } : {})}>
            <Select value={values.linkTarget} onChange={set("linkTarget")}>
              <option value="">{t("new.linkNone")}</option>
              {allowedTargets.map((x) => <option key={x} value={x}>{t(`target.${x}`)}</option>)}
            </Select>
          </Field>
          {values.linkTarget ? (
            <Field label={t("new.linkTargetId")} {...(errors.linkTargetId ? { error: t(`new.err.${errors.linkTargetId}`) } : {})}>
              <Input value={values.linkTargetId} onChange={set("linkTargetId")} maxLength={128} />
            </Field>
          ) : null}
          <Field label={t("new.profile")} {...(errors.profileId ? { error: t(`new.err.${errors.profileId}`) } : {})}>
            <Select value={values.profileId} onChange={set("profileId")} disabled={profiles.source === "error"}>
              <option value="">{profiles.source === "error" ? t("new.profileUnavailable") : t("new.profileNone")}</option>
              {profiles.data.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </Select>
          </Field>
          <p style={{ margin: 0, fontSize: 13, color: "var(--ink2)" }}>
            {t("new.limitsHint", { files: limits.maxFilesPerBatch, size: formatBytes(limits.maxFileBytes), total: formatBytes(limits.maxBatchBytes) })}
          </p>
          {createError ? <InlineError message={createError} /> : null}
          <div><Button type="submit" loading={creating}>{creating ? t("new.creating") : t("new.create")}</Button></div>
        </form>
      ) : (
        <div style={{ display: "grid", gap: 16 }}>
          {resume && (pendingOnServer > 0 || unfinished.length > 0) ? (
            <div className="card" role="note" style={{ padding: 16, borderInlineStart: "4px solid var(--warn)" }}>
              <strong><span aria-hidden="true">⚠ </span>{t("new.resumeTitle")}</strong>
              <p style={{ margin: "4px 0" }}>{t("new.resumeBody", { onServer: serverFiles.length - pendingOnServer, pending: Math.max(pendingOnServer, unfinished.length) })}</p>
              {unfinished.length > 0 ? <ul style={{ margin: 0, paddingInlineStart: 20, fontSize: 13 }}>{unfinished.slice(0, 10).map((m) => <li key={m.key}>{m.relPath} ({formatBytes(m.size)})</li>)}{unfinished.length > 10 ? <li>{t("new.resumeMore", { count: unfinished.length - 10 })}</li> : null}</ul> : null}
            </div>
          ) : null}

          <section
            aria-label={t("new.dropLabel")}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }} onDragLeave={() => setDragOver(false)} onDrop={onDrop}
            className="card" style={{ padding: 24, textAlign: "center", border: `2px dashed ${dragOver ? "var(--info)" : "var(--line)"}` }}
          >
            <p style={{ margin: "0 0 12px", fontWeight: 600 }}>{dragOver ? t("new.dropActive") : t("new.dropPrompt")}</p>
            <p style={{ margin: "0 0 12px", fontSize: 13, color: "var(--ink2)" }}>{t("new.dropFormats", { files: limits.maxFilesPerBatch, size: formatBytes(limits.maxFileBytes) })}</p>
            <div style={{ display: "inline-flex", gap: 8, flexWrap: "wrap", justifyContent: "center" }}>
              <Button onClick={() => fileInput.current?.click()}>{t("new.chooseFiles")}</Button>
              <Button variant="ghost" onClick={() => dirInput.current?.click()}>{t("new.chooseFolder")}</Button>
            </div>
            <input ref={fileInput} type="file" multiple accept=".pdf,.tif,.tiff,.jpg,.jpeg,.png,application/pdf,image/tiff,image/jpeg,image/png" hidden tabIndex={-1} aria-hidden="true" data-testid="file-input"
              onChange={(e) => { void addFiles(collectFromFileList(e.target.files)); e.target.value = ""; }} />
            <input ref={dirInput} type="file" multiple hidden tabIndex={-1} aria-hidden="true" data-testid="dir-input"
              {...({ webkitdirectory: "", directory: "" } as Record<string, string>)}
              onChange={(e) => { void addFiles(collectFromFileList(e.target.files)); e.target.value = ""; }} />
          </section>

          <p role="status" aria-live="polite" className="sr-only">{checking > 0 ? t("new.checking", { count: checking }) : ""}</p>
          {checking > 0 ? <p style={{ margin: 0 }}>{t("new.checking", { count: checking })}</p> : null}

          {state.items.length > 0 ? (
            <div className="card" style={{ padding: 16 }}>
              <Meter percent={summary.percent} label={t("new.overallLabel")} valueText={t("new.overallText", { percent: summary.percent, done: summary.completed + summary.onServer, total: summary.total - summary.invalid })} />
              <p role="status" aria-live="polite" style={{ margin: "8px 0", fontSize: 13 }}>
                {t("new.summary", { completed: summary.completed + summary.onServer, inProgress: summary.inProgress, failed: summary.failed, invalid: summary.invalid })}
              </p>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
                {summary.failed > 0 ? <Button onClick={engine.retryFailed}>{t("new.retryFailed", { count: summary.failed })}</Button> : null}
                <Button variant="ghost" onClick={() => engine.setPaused(!engine.paused)} aria-pressed={engine.paused}>{engine.paused ? t("new.resume") : t("new.pause")}</Button>
                <Link className="btn ghost" href={`/admin/bulk-scan/${encodeURIComponent(batch.id)}`}>{t("new.viewBatch")}</Link>
              </div>
              <div style={{ overflowX: "auto" }}>
                <table className="tbl" style={{ width: "100%" }}>
                  <caption className="sr-only">{t("new.tableCaption")}</caption>
                  <thead><tr><th scope="col">{t("new.colFile")}</th><th scope="col">{t("new.colSize")}</th><th scope="col">{t("new.colStatus")}</th><th scope="col" style={{ minWidth: 160 }}>{t("new.colProgress")}</th><th scope="col">{t("new.colActions")}</th></tr></thead>
                  <tbody>
                    {state.items.map((i) => <UploadRow key={i.key} item={i} onRemove={() => engine.remove(i.key)} />)}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}
        </div>
      )}
    </BulkScanShell>
  );
}

function UploadRow({ item, onRemove }: { item: UploadItem; onRemove: () => void }) {
  const t = useTranslations("bulkScan");
  const pct = item.size > 0 ? Math.floor((item.loaded / item.size) * 100) : 0;
  const tone = item.status === "failed" || item.status === "invalid" ? "bad" : item.status === "completed" || item.status === "on_server" ? "good" : item.status === "uploading" ? "info" : "mut";
  const icon = tone === "bad" ? "✕" : tone === "good" ? "✓" : tone === "info" ? "⏳" : "…";
  return (
    <tr>
      <th scope="row" style={{ textAlign: "start" }}>{item.relPath}</th>
      <td>{formatBytes(item.size)}</td>
      <td>
        <Chip tone={tone} icon={icon}>{t(`upload.status.${item.status}`)}</Chip>
        {item.rejectReason ? <span style={{ display: "block", fontSize: 12 }}>{t(`new.reject.${item.rejectReason}`)}</span> : null}
        {item.errorKey ? <span style={{ display: "block", fontSize: 12 }}>{item.errorDetail ? item.errorDetail.message : t(item.errorKey)}</span> : null}
        {item.errorDetail?.reference ? <span style={{ display: "block", fontSize: 12, color: "var(--ink2)" }}>{formatReference(item.errorDetail.reference)}</span> : null}
      </td>
      <td>
        {item.status === "uploading" || item.status === "uploaded" || item.status === "completed" ? (
          <Meter percent={item.status === "uploading" ? pct : 100} label={t("new.fileProgressLabel", { name: item.name })} valueText={`${item.status === "uploading" ? pct : 100}%`} />
        ) : "—"}
      </td>
      <td>{item.status === "invalid" || item.status === "failed" || item.status === "pending" ? <Button size="sm" variant="ghost" onClick={onRemove} aria-label={t("new.removeAria", { name: item.name })}>{t("action.remove")}</Button> : null}</td>
    </tr>
  );
}

