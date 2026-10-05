"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, ConfirmDialog, Field, Input, Modal } from "@/app/_components/ds";
import { bsRequest, isStale, QUEUED_RELOAD_DELAY_MS, type FailedResult } from "@/lib/bulkScan/api";
import { errorText, useBulkScanError, type BsError } from "@/lib/bulkScan/useBulkScanError";
import { useShortcutsPref } from "@/lib/bulkScan/useShortcutsPref";
import { mapReviewDetail } from "@/lib/bulkScan/mappers";
import {
  buildEditPayload, documentAmountMinor, draftFromDetail, isDirty, parseTags, queueNeighbour, resolveShortcut, reviewPath, SHORTCUT_HELP,
  type ReviewDraft, type ShortcutAction,
} from "@/lib/bulkScan/review";
import { describeReviewReason } from "@/lib/bulkScan/status";
import { LINK_TARGETS, type LinkRow, type ReviewDetail, type ReviewQueueItem } from "@/lib/bulkScan/types";
import { INITIAL_VIEW, rotateBy, zoomAt, ZOOM_STEP, type ViewState } from "@/lib/bulkScan/viewer";
import { amountDetailLine } from "@/lib/bulkScan/linkReason";
import { Chip, ConfidenceBadge, FileStateChip } from "./Chips";
import { BulkScanShell, InlineError } from "./BulkScanShell";
import { LinkPanel, type ChosenLink } from "./LinkPanel";
import { PageViewer } from "./PageViewer";
import { ClassificationPanel, DegradedBanner, FieldsPanel, MakerCheckerBanner, PiiPanel, TextEditor, WordsPanel } from "./ReviewPanels";

interface Props {
  detail: ReviewDetail;
  queue: ReviewQueueItem[];
  awaitingLink: LinkRow | null;
  currentUserId: string | null;
  allowedLinkTargets?: string[];
  reviewThreshold?: number;
  /** The queue / awaiting-approval links failed to load (shown as an error, never as "no next file" or "nothing awaiting"). */
  queueFailed?: boolean;
  awaitingFailed?: boolean;
}

interface ReviewError extends BsError { retryable: boolean }

type Dialog = null | "approve" | "reject" | "help";

export function ReviewWorkspace({ detail, queue, awaitingLink, currentUserId, allowedLinkTargets, reviewThreshold = 0.8, queueFailed = false, awaitingFailed = false }: Props) {
  const t = useTranslations("bulkScan");
  const router = useRouter();
  const describe = useBulkScanError(t("review.area"));
  const apiFail = useCallback((r: FailedResult, kind: "load" | "save" = "save"): ReviewError => ({ ...describe(r, kind), retryable: r.code === "CLEARANCE_UNAVAILABLE" }), [describe]);
  const plain = useCallback((key: string): ReviewError => ({ message: t(key), reference: null, retryable: false }), [t]);
  const [shortcutsOn, setShortcutsOn] = useShortcutsPref(currentUserId);
  const [current, setCurrent] = useState(detail);
  const [draft, setDraft] = useState<ReviewDraft>(() => draftFromDetail(detail));
  const [tagsRaw, setTagsRaw] = useState(detail.file.tags.join(", "));
  const [pageIdx, setPageIdx] = useState(0);
  const [view, setView] = useState<ViewState>(INITIAL_VIEW);
  const [fitSeq, setFitSeq] = useState(0);
  const [activeWord, setActiveWord] = useState<number | null>(null);
  const [reveal, setReveal] = useState<{ index: number; seq: number } | null>(null);
  const [chosen, setChosen] = useState<ChosenLink | null>(null);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [busy, setBusy] = useState(false);
  const [dialogError, setDialogError] = useState<string | undefined>(undefined);
  const [error, setError] = useState<ReviewError | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<number, boolean>>({});
  const docTypeSelect = useRef<HTMLSelectElement>(null);
  const seq = useRef(0);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const file = current.file;
  const page = current.pages[Math.min(pageIdx, Math.max(0, current.pages.length - 1))];
  // Prefer the page-level link (it knows who requested it); otherwise the file's own links[] still tells us filing waits for a link approval.
  const detailLink = current.links.find((l) => l.state === "awaiting_approval");
  const awaiting: LinkRow | null = awaitingLink ?? (detailLink ? { linkId: detailLink.linkId, fileId: file.id, documentId: null, target: detailLink.target, targetId: detailLink.targetId, state: detailLink.state, requestedBy: null, approvedBy: null, reason: detailLink.reason, resultReason: detailLink.resultReason, detail: null, createdAt: "" } : null);
  const readOnly = awaiting !== null;
  const dirty = isDirty(current, draft);
  const docAmount = useMemo(() => documentAmountMinor(current.fields), [current.fields]);
  const fromServer = allowedLinkTargets && allowedLinkTargets.length > 0 ? allowedLinkTargets : current.allowedLinkTargets;
  const targets = fromServer && fromServer.length > 0 ? fromServer : [...LINK_TARGETS];
  const next = queueNeighbour(queue, file.id, 1);
  const prev = queueNeighbour(queue, file.id, -1);

  const resetFrom = (d: ReviewDetail): void => {
    setCurrent(d);
    setDraft(draftFromDetail(d));
    setTagsRaw(d.file.tags.join(", "));
    setFieldErrors({});
  };

  /** After a 202 the change is applied by a worker: re-read until the version moves (bounded). */
  const reloadAfterWrite = useCallback(async (fromVersion: number): Promise<boolean> => {
    for (let i = 0; i < 4; i++) {
      await new Promise((r) => setTimeout(r, QUEUED_RELOAD_DELAY_MS));
      if (!alive.current) return false;
      const r = await bsRequest(`/batches/${encodeURIComponent(file.batchId)}/files/${encodeURIComponent(file.id)}/review`);
      const d = r.ok ? mapReviewDetail(r.json) : null;
      if (d && d.file.version > fromVersion) { resetFrom(d); return true; }
    }
    return false;
  }, [file.batchId, file.id]);

  const reload = useCallback(async (): Promise<void> => {
    setBusy(true);
    const r = await bsRequest(`/batches/${encodeURIComponent(file.batchId)}/files/${encodeURIComponent(file.id)}/review`);
    setBusy(false);
    const d = r.ok ? mapReviewDetail(r.json) : null;
    if (!d) { setError(r.ok ? plain("apiError.generic") : apiFail(r, "load")); return; }
    resetFrom(d);
    setStale(false);
    setError(null);
  }, [file.batchId, file.id, apiFail, plain]);

  /** Re-read the review only to get fresh short-lived page image URLs; the reviewer's unsaved edits are kept. */
  async function refreshImages(): Promise<void> {
    const r = await bsRequest(`/batches/${encodeURIComponent(file.batchId)}/files/${encodeURIComponent(file.id)}/review`);
    const d = r.ok ? mapReviewDetail(r.json) : null;
    if (!d) { setError(r.ok ? plain("apiError.generic") : apiFail(r, "load")); return; }
    setError(null);
    setCurrent((cur) => ({ ...cur, pages: cur.pages.map((p) => ({ ...p, imageUrl: d.pages.find((x) => x.pageNumber === p.pageNumber)?.imageUrl ?? p.imageUrl })) }));
  }

  async function save(d: ReviewDraft): Promise<void> {
    const errs: Record<number, boolean> = {};
    d.fields.forEach((f, i) => { if (!f.value.trim()) errs[i] = true; });
    setFieldErrors(errs);
    if (Object.keys(errs).length > 0) { setError(plain("review.fixFields")); return; }
    const payload = buildEditPayload(current, d);
    if (!payload) return;
    setBusy(true);
    setError(null);
    const r = await bsRequest(`/batches/${encodeURIComponent(file.batchId)}/files/${encodeURIComponent(file.id)}/review/edit`, { method: "POST", body: payload });
    setBusy(false);
    if (!r.ok) { if (isStale(r)) setStale(true); else setError(apiFail(r)); return; }
    setNotice(t("review.saved"));
    const ok = await reloadAfterWrite(file.version);
    setNotice(ok ? t("review.savedApplied") : t("review.savedPending"));
  }

  const pick = (docType: string): void => {
    const d = { ...draft, docType };
    setDraft(d);
    void save(d);
  };

  async function decide(kind: "approve" | "reject", reason?: string): Promise<void> {
    setBusy(true);
    setDialogError(undefined);
    const base = `/batches/${encodeURIComponent(file.batchId)}/files/${encodeURIComponent(file.id)}/review/${kind}`;
    const body = kind === "approve"
      ? { expectedVersion: file.version, ...(chosen ? { link: { target: chosen.target, targetId: chosen.targetId } } : {}) }
      : { expectedVersion: file.version, reason: reason ?? "" };
    const r = await bsRequest(base, { method: "POST", body });
    setBusy(false);
    if (!r.ok) {
      if (isStale(r)) { setDialog(null); setStale(true); } else setDialogError(errorText(describe(r)));
      return;
    }
    setDialog(null);
    setNotice(kind === "approve" ? (chosen ? t("review.approvedLinked") : t("review.approvedFiled")) : t("review.rejected"));
    router.push(next ? reviewPath(next.batchId, next.fileId) : "/admin/bulk-scan/review");
  }

  const run = (a: ShortcutAction): void => {
    switch (a) {
      case "zoomIn": setView((v) => zoomAt(v, ZOOM_STEP)); break;
      case "zoomOut": setView((v) => zoomAt(v, 1 / ZOOM_STEP)); break;
      case "rotate": setView((v) => ({ ...v, rotation: rotateBy(v.rotation, 1) })); break;
      case "rotateBack": setView((v) => ({ ...v, rotation: rotateBy(v.rotation, -1) })); break;
      case "fit": setFitSeq((n) => n + 1); break;
      case "prevPage": setPageIdx((i) => Math.max(0, i - 1)); setActiveWord(null); break;
      case "nextPage": setPageIdx((i) => Math.min(current.pages.length - 1, i + 1)); setActiveWord(null); break;
      case "nextFile": case "prevFile": {
        const target = a === "nextFile" ? next : prev;
        if (dirty) { setNotice(t("review.unsavedBlocksNav")); break; }
        if (target) router.push(reviewPath(target.batchId, target.fileId)); else setNotice(a === "nextFile" ? t("review.noNextFile") : t("review.noPrevFile"));
        break;
      }
      case "approve": if (!readOnly && !dirty && !stale) setDialog("approve"); else if (dirty) setNotice(t("review.saveBeforeApprove")); break;
      case "edit": docTypeSelect.current?.focus(); break;
      case "help": setDialog("help"); break;
      case "pickFirst": case "pickSecond": {
        const c = current.classification.candidates[a === "pickFirst" ? 0 : 1];
        if (c && !readOnly) pick(c.docType);
        break;
      }
    }
  };
  /**
   * Single-key shortcuts (WCAG 2.1.4) are handled on the workspace region, not the document: they only fire while keyboard focus is
   * inside it, never in a field that takes typed characters, and not at all when the reviewer has switched them off.
   */
  const onRegionKeyDown = (e: ReactKeyboardEvent<HTMLElement>): void => {
    if (!shortcutsOn || dialog !== null) return;
    const el = e.target as HTMLElement | null;
    const a = resolveShortcut({
      key: e.key, ctrlKey: e.ctrlKey, metaKey: e.metaKey, altKey: e.altKey, shiftKey: e.shiftKey,
      target: el ? { tagName: el.tagName, isContentEditable: el.isContentEditable, role: el.getAttribute("role") } : null,
    });
    if (!a) return;
    e.preventDefault();
    run(a);
  };

  const reasons = file.reviewReasons.map((code) => ({ code, ...describeReviewReason(code) }));
  const mismatchLine = amountDetailLine(file.link?.detail);
  const canApprove = !readOnly && !dirty && !stale && !busy;

  return (
    <BulkScanShell
      title={file.originalName} subtitle={t("review.subtitle")} active="review" back="/admin/bulk-scan/review"
      actions={(
        <>
          <label style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <input type="checkbox" role="switch" checked={shortcutsOn} onChange={(e) => setShortcutsOn(e.target.checked)} />
            <span>{t("review.shortcutsToggle")}: {shortcutsOn ? t("review.shortcutsOn") : t("review.shortcutsOff")}</span>
          </label>
          <Button variant="ghost" onClick={() => setDialog("help")} {...(shortcutsOn ? { "aria-keyshortcuts": "?" } : {})}>{t("review.shortcuts")}</Button>
          <Button variant="danger" disabled={readOnly || busy} onClick={() => setDialog("reject")}>{t("review.reject")}</Button>
          <Button disabled={!canApprove} onClick={() => setDialog("approve")} {...(shortcutsOn ? { "aria-keyshortcuts": "a" } : {})}>{t("review.approve")}</Button>
        </>
      )}
    >
      {/* The review workspace is one labelled, focusable region: the single-key shortcuts are scoped to focus inside it. */}
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/no-noninteractive-tabindex */}
      <div role="region" tabIndex={0} aria-label={t("review.workspaceLabel")} onKeyDown={onRegionKeyDown}>
      <div style={{ display: "grid", gap: 12, marginBottom: 12 }}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <FileStateChip state={file.state} />
          <span>{t("review.confidence")}:</span> <ConfidenceBadge value={file.confidence} threshold={reviewThreshold} />
          <span style={{ marginInlineStart: "auto", display: "inline-flex", gap: 8 }}>
            {prev ? <Link className="btn sm ghost" href={reviewPath(prev.batchId, prev.fileId)}>{t("review.prevFile")}</Link> : null}
            {next ? <Link className="btn sm ghost" href={reviewPath(next.batchId, next.fileId)}>{t("review.nextFile")}</Link> : null}
          </span>
        </div>
        {reasons.length > 0 ? (
          <div className="card" style={{ padding: 12 }}>
            <strong>{t("review.reasons")}</strong>
            <ul style={{ margin: "4px 0 0", paddingInlineStart: 20 }}>
              {reasons.map((d, i) => (
                <li key={i}>
                  {t(d.key, d.params)}
                  {d.code === "LINK_AMOUNT_MISMATCH" && mismatchLine ? <span style={{ display: "block", fontSize: 13 }}>{t("links.amountDetail", mismatchLine)}</span> : null}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {awaiting ? <MakerCheckerBanner link={awaiting} currentUserId={currentUserId} /> : null}
        <DegradedBanner pages={current.degradedPages} />
        {stale ? (
          <div role="alert" className="card" style={{ padding: 12, borderInlineStart: "4px solid var(--bad)" }}>
            <strong><span aria-hidden="true">✕ </span>{t("review.staleTitle")}</strong>
            <p style={{ margin: "4px 0" }}>{t("review.staleBody")}</p>
            <Button onClick={() => { void reload(); }} loading={busy}>{t("review.reload")}</Button>
          </div>
        ) : null}
        {queueFailed ? <InlineError message={t("review.queueLoadFailed")} onRetry={() => router.refresh()} retryLabel={t("action.retry")} /> : null}
        {awaitingFailed ? <InlineError message={t("review.awaitingLoadFailed")} onRetry={() => router.refresh()} retryLabel={t("action.retry")} /> : null}
        {error ? <InlineError message={error.message} reference={error.reference} {...(error.retryable ? { onRetry: () => { void reload(); }, retryLabel: t("action.retry") } : {})} /> : null}
        <p role="status" aria-live="polite" style={{ margin: 0, minHeight: 18 }}>{notice ?? ""}</p>
      </div>

      <div style={{ display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))", alignItems: "start" }}>
        <div>
          {page ? (
            <PageViewer
              page={page} pageCount={current.pages.length} view={view} onViewChange={setView} activeWord={activeWord} onActiveWord={setActiveWord}
              threshold={reviewThreshold} reveal={reveal} fitSeq={fitSeq} onRetryImage={() => { void refreshImages(); }}
              onPrevPage={() => run("prevPage")} onNextPage={() => run("nextPage")}
            />
          ) : <div className="card" style={{ padding: 16 }}>{t("review.noPages")}</div>}
          {page ? <div style={{ marginTop: 12 }}><WordsPanel page={page} active={activeWord} onActive={setActiveWord} onReveal={(i) => setReveal({ index: i, seq: ++seq.current })} threshold={reviewThreshold} /></div> : null}
        </div>
        <div style={{ display: "grid", gap: 12 }}>
          <ClassificationPanel
            cls={current.classification} docTypes={current.docTypes} docType={draft.docType} disabled={readOnly || busy} selectRef={docTypeSelect}
            onDocType={(id) => setDraft((d) => ({ ...d, docType: id }))} onPick={pick}
          />
          <FieldsPanel
            fields={current.fields} drafts={draft.fields} disabled={readOnly || busy} errors={fieldErrors}
            onChange={(i, v) => setDraft((d) => ({ ...d, fields: d.fields.map((f, n) => (n === i ? { ...f, value: v } : f)) }))}
          />
          <section aria-labelledby="tags-h" className="card" style={{ padding: 12 }}>
            <h3 id="tags-h" style={{ margin: "0 0 8px" }}>{t("review.tags")}</h3>
            <Field label={t("review.tagsLabel")}>
              <Input value={tagsRaw} disabled={readOnly || busy} onChange={(e) => { setTagsRaw(e.target.value); setDraft((d) => ({ ...d, tags: parseTags(e.target.value) })); }} />
            </Field>
          </section>
          <TextEditor pages={current.pages} edited={draft.text} disabled={readOnly || busy} onChange={(n, text) => setDraft((d) => ({ ...d, text: { ...d.text, [n]: text } }))} />
          <PiiPanel findings={current.piiFindings} />
          <LinkPanel suggestions={current.linkSuggestions} docAmountMinor={docAmount} allowedTargets={targets} chosen={chosen} onChoose={setChosen} disabled={readOnly || busy} />
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <Button disabled={!dirty || readOnly || busy} loading={busy} onClick={() => { void save(draft); }}>{t("review.save")}</Button>
            <Button variant="ghost" disabled={!dirty || busy} onClick={() => { setDraft(draftFromDetail(current)); setTagsRaw(current.file.tags.join(", ")); setFieldErrors({}); }}>{t("review.discard")}</Button>
            {dirty ? <Chip tone="warn" icon="●">{t("review.unsaved")}</Chip> : null}
          </div>
          {dirty ? <p style={{ fontSize: 12, margin: 0 }}>{t("review.saveBeforeApprove")}</p> : null}
        </div>
      </div>
      </div>

      <ConfirmDialog
        open={dialog === "approve"} title={t("review.approveTitle")} confirmLabel={t("review.approve")} cancelLabel={t("action.cancel")} busy={busy}
        description={chosen ? t("review.approveWithLink", { target: t(`target.${chosen.target}`), label: chosen.label }) : t("review.approveNoLink")}
        {...(dialogError ? { errorMessage: dialogError } : {})}
        onConfirm={() => { void decide("approve"); }} onCancel={() => { if (!busy) { setDialog(null); setDialogError(undefined); } }}
      />
      <ConfirmDialog
        open={dialog === "reject"} title={t("review.rejectTitle")} description={t("review.rejectDesc")} danger requireReason minReasonLength={5} maxReasonLength={500}
        reasonLabel={t("review.rejectReason")} confirmLabel={t("review.reject")} cancelLabel={t("action.cancel")} busy={busy}
        {...(dialogError ? { errorMessage: dialogError } : {})}
        onConfirm={(r) => { void decide("reject", r); }} onCancel={() => { if (!busy) { setDialog(null); setDialogError(undefined); } }}
      />
      <Modal open={dialog === "help"} onClose={() => setDialog(null)} title={t("review.shortcutsTitle")}>
        <p style={{ margin: "0 0 8px" }}>{t("review.shortcutsScopeNote")}</p>
        <table className="tbl" style={{ width: "100%" }}>
          <caption className="sr-only">{t("review.shortcutsTitle")}</caption>
          <thead><tr><th scope="col">{t("review.shortcutKey")}</th><th scope="col">{t("review.shortcutAction")}</th></tr></thead>
          <tbody>{SHORTCUT_HELP.map((s) => <tr key={s.labelKey}><td><kbd>{s.keys}</kbd></td><td>{t(`review.shortcut.${s.labelKey}`)}</td></tr>)}</tbody>
        </table>
        <div style={{ textAlign: "end", marginTop: 12 }}><Button onClick={() => setDialog(null)}>{t("action.close")}</Button></div>
      </Modal>
    </BulkScanShell>
  );
}

