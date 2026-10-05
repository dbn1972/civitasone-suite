"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Button, ConfirmDialog, EmptyState, Field, LoadErrorState, Select } from "@/app/_components/ds";
import type { LoaderResult } from "@/app/_data/apiClient";
import { errorText, useBulkScanError } from "@/lib/bulkScan/useBulkScanError";
import { bsRequest, qs, QUEUED_RELOAD_DELAY_MS } from "@/lib/bulkScan/api";
import { mapBatch, mapBatchFiles } from "@/lib/bulkScan/mappers";
import { clientListView } from "@/lib/bulkScan/listView";
import type { BatchFileView, BatchView, Paged } from "@/lib/bulkScan/types";
import { COUNT_GROUPS, fileIssueKey, formatBytes, hasActiveWork, isRetryable, isSkippable } from "@/lib/bulkScan/status";
import { reviewPath } from "@/lib/bulkScan/review";
import { usePolling } from "@/lib/bulkScan/usePolling";
import { formatIndianDateTime } from "@/lib/formatters";
import { formatConfidencePct } from "@/lib/scannedDocuments";
import { BatchStatusChip, Chip, FileStateChip, LinkReasonLine, LinkStateChip } from "./Chips";
import { BulkScanShell, InlineError } from "./BulkScanShell";
import { BatchProgress } from "./BatchesList";

type Pending = { kind: "retry" | "skip" | "cancel"; file?: BatchFileView };

/** Files shown for a state-group filter ("" = all). */
export function filterFilesByGroup(files: readonly BatchFileView[], group: string): BatchFileView[] {
  if (!group) return [...files];
  const g = COUNT_GROUPS.find((x) => x.id === group);
  return g ? files.filter((f) => g.states.includes(f.state)) : [...files];
}

export function BatchDetail({ batchResult, filesResult }: { batchResult: LoaderResult<BatchView | null>; filesResult: LoaderResult<Paged<BatchFileView>> }) {
  const t = useTranslations("bulkScan");
  const describe = useBulkScanError();
  const [batch, setBatch] = useState<BatchView | null>(batchResult.data);
  const [files, setFiles] = useState<BatchFileView[]>(filesResult.data.items);
  const [hasMore, setHasMore] = useState(filesResult.data.page.hasMore);
  const [group, setGroup] = useState("");
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);
  const [dialogError, setDialogError] = useState<string | undefined>(undefined);
  const [notice, setNotice] = useState<string | null>(null);
  const [reloadError, setReloadError] = useState(false);
  const reloadTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (reloadTimer.current) clearTimeout(reloadTimer.current); }, []);

  const reload = useCallback(async (): Promise<{ changed: boolean; ok: boolean; active: boolean }> => {
    if (!batch) return { changed: false, ok: false, active: false };
    const [b, f] = await Promise.all([
      bsRequest(`/batches/${encodeURIComponent(batch.id)}`),
      bsRequest(`/batches/${encodeURIComponent(batch.id)}/files${qs({ limit: Math.min(500, Math.max(200, files.length)) })}`),
    ]);
    const nb = b.ok ? mapBatch(b.json) : null;
    const nf = f.ok ? mapBatchFiles(f.json) : null;
    if (!nb || !nf) { setReloadError(true); return { changed: false, ok: false, active: true }; }
    setReloadError(false);
    const changed = JSON.stringify([nb.counts, nb.status, nf.items.map((x) => [x.id, x.state, x.failureReason, x.attempts, x.link?.state])]) !==
      JSON.stringify([batch.counts, batch.status, files.map((x) => [x.id, x.state, x.failureReason, x.attempts, x.link?.state])]);
    setBatch(nb);
    setFiles(nf.items);
    setHasMore(nf.page.hasMore);
    return { changed, ok: true, active: hasActiveWork(nb.counts, nb.status) };
  }, [batch, files]);

  const active = batch ? hasActiveWork(batch.counts, batch.status) : false;
  const poll = usePolling(async () => {
    const r = await reload();
    return { keepGoing: r.active || !r.ok, changed: r.changed, failed: !r.ok };
  }, { enabled: active });

  const afterAccepted = (): void => {
    setNotice(t("detail.queued"));
    if (reloadTimer.current) clearTimeout(reloadTimer.current);
    reloadTimer.current = setTimeout(() => { void poll.refreshNow().then(() => setNotice(null)); }, QUEUED_RELOAD_DELAY_MS);
  };

  async function confirm(reason?: string): Promise<void> {
    if (!pending || !batch) return;
    setBusy(true);
    setDialogError(undefined);
    const body = reason ? { reason } : {};
    const path = pending.kind === "cancel"
      ? `/batches/${encodeURIComponent(batch.id)}/cancel`
      : `/batches/${encodeURIComponent(batch.id)}/files/${encodeURIComponent(pending.file?.id ?? "")}/${pending.kind}`;
    const r = await bsRequest(path, { method: "POST", body: pending.kind === "cancel" ? {} : body });
    setBusy(false);
    if (!r.ok) { setDialogError(errorText(describe(r))); return; }
    setPending(null);
    afterAccepted();
  }

  async function loadMore(): Promise<void> {
    if (!batch) return;
    const r = await bsRequest(`/batches/${encodeURIComponent(batch.id)}/files${qs({ limit: 200, offset: files.length })}`);
    const nf = r.ok ? mapBatchFiles(r.json) : null;
    if (!nf) { setReloadError(true); return; }
    setFiles((cur) => [...cur, ...nf.items]);
    setHasMore(nf.page.hasMore);
  }

  if (!batch) {
    return (
      <BulkScanShell title={t("detail.title")} back="/admin/bulk-scan">
        {batchResult.status === 404
          ? <div className="card"><EmptyState icon="🔎" title={t("detail.notFoundTitle")} message={t("detail.notFoundMessage")} action={<Link href="/admin/bulk-scan" className="btn">{t("nav.batches")}</Link>} /></div>
          : <LoadErrorState result={batchResult} area={t("detail.area")} backHref="/admin/bulk-scan" />}
      </BulkScanShell>
    );
  }

  const shown = filterFilesByGroup(files, group);
  const filesFailedToLoad = filesResult.source === "error" && files.length < 1;
  const view = filesFailedToLoad ? "error" : clientListView({ error: false, loading: false, count: files.length });
  const canCancel = batch.status === "open" || batch.status === "processing";

  const confirmTitle = pending?.kind === "cancel" ? t("detail.cancelTitle") : pending?.kind === "skip" ? t("detail.skipTitle") : t("detail.retryTitle");
  const confirmDesc = pending?.kind === "cancel" ? t("detail.cancelDesc") : pending?.kind === "skip" ? t("detail.skipDesc", { name: pending.file?.originalName ?? "" }) : t("detail.retryDesc", { name: pending?.file?.originalName ?? "" });

  return (
    <BulkScanShell
      title={batch.name} subtitle={t("detail.subtitle", { files: batch.fileCount, size: formatBytes(batch.totalBytes) })} active="batches" back="/admin/bulk-scan"
      actions={(
        <>
          <Button variant="ghost" onClick={() => { void poll.refreshNow(); }}>{t("action.refresh")}</Button>
          <Link href={`/admin/bulk-scan/new?batch=${encodeURIComponent(batch.id)}`} className="btn">{t("detail.addFiles")}</Link>
          {canCancel ? <Button variant="danger" onClick={() => setPending({ kind: "cancel" })}>{t("detail.cancelBatch")}</Button> : null}
        </>
      )}
    >
      <div className="card" style={{ padding: 16, marginBottom: 16 }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 16, alignItems: "center", marginBottom: 8 }}>
          <BatchStatusChip status={batch.status} />
          {batch.defaultDocType ? <span>{t("detail.defaultType")}: {batch.defaultDocType}</span> : null}
          {batch.linkTarget ? <span>{t("detail.linkTarget")}: {t(`target.${batch.linkTarget.target}`)}{batch.linkTarget.targetId ? ` · ${batch.linkTarget.targetId}` : ""}</span> : null}
          {batch.defaultTags.length > 0 ? <span>{t("detail.tags")}: {batch.defaultTags.join(", ")}</span> : null}
        </div>
        <BatchProgress batch={batch} />
        <p role="status" aria-live="polite" style={{ fontSize: 12, margin: "8px 0 0", color: "var(--ink2)" }}>
          {notice ?? (active ? t("detail.autoRefresh") : t("detail.settled"))}
          {poll.failedLast || reloadError ? ` ${t("detail.refreshStale")}` : ""}
        </p>
      </div>

      {reloadError ? <InlineError message={t("detail.reloadFailed")} onRetry={() => { void poll.refreshNow(); }} retryLabel={t("action.retry")} /> : null}

      {view === "error" ? <LoadErrorState result={filesResult} area={t("detail.filesArea")} backHref="/admin/bulk-scan" /> : null}
      {view === "empty" ? (
        <div className="card"><EmptyState icon="📥" title={t("detail.emptyTitle")} message={t("detail.emptyMessage")} action={<Link href={`/admin/bulk-scan/new?batch=${encodeURIComponent(batch.id)}`} className="btn primary">{t("detail.addFiles")}</Link>} /></div>
      ) : null}
      {view === "ready" ? (
        <div className="card" style={{ overflowX: "auto" }}>
          <div style={{ padding: 12 }}>
            <Field label={t("detail.filterGroup")} style={{ maxWidth: 260 }}>
              <Select value={group} onChange={(e) => setGroup(e.target.value)}>
                <option value="">{t("detail.allFiles")}</option>
                {COUNT_GROUPS.map((g) => <option key={g.id} value={g.id}>{t(`group.${g.id}`)}</option>)}
              </Select>
            </Field>
          </div>
          {shown.length < 1 ? <EmptyState icon="🔍" title={t("detail.noMatchTitle")} message={t("detail.noMatchMessage")} /> : (
            <table className="tbl" style={{ width: "100%" }}>
              <caption className="sr-only">{t("detail.tableCaption")}</caption>
              <thead>
                <tr>
                  <th scope="col">{t("detail.colFile")}</th><th scope="col">{t("detail.colState")}</th><th scope="col">{t("detail.colIssue")}</th>
                  <th scope="col">{t("detail.colPages")}</th><th scope="col">{t("detail.colConfidence")}</th><th scope="col">{t("detail.colLink")}</th><th scope="col">{t("detail.colActions")}</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((f) => {
                  const issue = fileIssueKey(f);
                  return (
                    <tr key={f.id}>
                      <th scope="row" style={{ textAlign: "start" }}>
                        {f.originalName}
                        <span style={{ display: "block", fontSize: 12, fontWeight: 400, color: "var(--ink2)" }}>{formatBytes(f.sizeBytes)}{f.docType ? ` · ${f.docType}` : ""}</span>
                      </th>
                      <td><FileStateChip state={f.state} />{f.attempts > 1 ? <span style={{ display: "block", fontSize: 12 }}>{t("detail.attempts", { count: f.attempts })}</span> : null}</td>
                      <td>
                        {issue ? <span>{t(issue)}</span> : "—"}
                        {f.nextAttemptAt && !isRetryable(f) && (f.state === "scan_pending" || f.state === "queued") ? <span style={{ display: "block", fontSize: 12 }}>{t("detail.nextAttempt", { at: formatIndianDateTime(f.nextAttemptAt) })}</span> : null}
                        {f.piiFlags.length > 0 ? <span style={{ display: "block", fontSize: 12 }}>{t("detail.piiMasked", { types: f.piiFlags.join(", ") })}</span> : null}
                      </td>
                      <td>{f.pageCount ?? "—"}</td>
                      <td>{f.ocrMeanConfidence === null ? "—" : formatConfidencePct(f.ocrMeanConfidence)}</td>
                      <td>
                        {f.link ? (
                          <span style={{ display: "inline-flex", flexDirection: "column", gap: 2 }}>
                            <LinkStateChip state={f.link.state} />
                            <span style={{ fontSize: 12 }}>{t(`target.${f.link.target}`)} · {f.link.targetId}</span>
                            {f.link.reason || f.link.detail ? <span style={{ fontSize: 12 }}><LinkReasonLine reason={f.link.reason} detail={f.link.detail} /></span> : null}
                          </span>
                        ) : (f.filedDocumentId ? <Chip tone="good" icon="✓">{t("detail.filed")}</Chip> : "—")}
                      </td>
                      <td>
                        <span style={{ display: "inline-flex", flexWrap: "wrap", gap: 4 }}>
                          {f.state === "needs_review" || f.state === "ready_to_file" ? <Link className="btn sm" href={reviewPath(batch.id, f.id)} aria-label={t("detail.reviewAria", { name: f.originalName })}>{t("detail.review")}</Link> : null}
                          {isRetryable(f) ? <Button size="sm" onClick={() => setPending({ kind: "retry", file: f })} aria-label={t("detail.retryAria", { name: f.originalName })}>{t("action.retry")}</Button> : null}
                          {isSkippable(f) ? <Button size="sm" variant="ghost" onClick={() => setPending({ kind: "skip", file: f })} aria-label={t("detail.skipAria", { name: f.originalName })}>{t("action.skip")}</Button> : null}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          {hasMore ? <div style={{ padding: 12, textAlign: "center" }}><Button variant="ghost" onClick={() => { void loadMore(); }}>{t("action.loadMore")}</Button></div> : null}
        </div>
      ) : null}

      <ConfirmDialog
        open={pending !== null} title={confirmTitle} description={confirmDesc} danger={pending?.kind !== "retry"}
        confirmLabel={pending?.kind === "cancel" ? t("detail.cancelConfirm") : pending?.kind === "skip" ? t("action.skip") : t("action.retry")}
        cancelLabel={t("action.cancel")} optionalReason={pending?.kind !== "cancel"} reasonLabel={t("detail.reasonOptional")} maxReasonLength={500}
        busy={busy} {...(dialogError ? { errorMessage: dialogError } : {})}
        onConfirm={(r) => { void confirm(r); }} onCancel={() => { if (!busy) { setPending(null); setDialogError(undefined); } }}
      />
    </BulkScanShell>
  );
}
