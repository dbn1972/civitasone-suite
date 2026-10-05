"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Button, ConfirmDialog, EmptyState, Field, LoadErrorState, Select } from "@/app/_components/ds";
import type { LoaderResult } from "@/app/_data/apiClient";
import { errorText, useBulkScanError } from "@/lib/bulkScan/useBulkScanError";
import { bsRequest, qs, QUEUED_RELOAD_DELAY_MS } from "@/lib/bulkScan/api";
import { listView } from "@/lib/bulkScan/listView";
import { mapLinks } from "@/lib/bulkScan/mappers";
import { LINK_STATES, type LinkRow, type Paged } from "@/lib/bulkScan/types";
import { formatIndianDateTime } from "@/lib/formatters";
import { LinkReasonLine, LinkStateChip } from "./Chips";
import { BulkScanShell, InlineError } from "./BulkScanShell";

type Action = "approve" | "reject" | "unlink-request";

/** What a viewer may do with a link: maker-checker means the requester can never approve their own link. */
export function linkActions(link: Pick<LinkRow, "state" | "requestedBy">, currentUserId: string | null): { approve: boolean; approveBlockedBySelf: boolean; reject: boolean; unlink: boolean } {
  const pendingDecision = link.state === "awaiting_approval" || link.state === "flagged_mismatch";
  const self = currentUserId !== null && link.requestedBy === currentUserId;
  return { approve: pendingDecision && !self, approveBlockedBySelf: pendingDecision && self, reject: pendingDecision, unlink: link.state === "linked" };
}

const shortId = (id: string | null): string => (id ? id.slice(0, 8) : "—");

export function LinksApprovals({ result, state: initialState, currentUserId }: { result: LoaderResult<Paged<LinkRow>>; state: string; currentUserId: string | null }) {
  const t = useTranslations("bulkScan");
  const describe = useBulkScanError();
  const [state, setState] = useState(initialState);
  const [items, setItems] = useState<LinkRow[]>(result.data.items);
  const [hasMore, setHasMore] = useState(result.data.page.hasMore);
  const [failed, setFailed] = useState(result.source === "error");
  const [loading, setLoading] = useState(false);
  const [pending, setPending] = useState<{ action: Action; link: LinkRow } | null>(null);
  const [busy, setBusy] = useState(false);
  const [dialogError, setDialogError] = useState<string | undefined>(undefined);
  const [notice, setNotice] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  async function load(st: string, offset: number): Promise<void> {
    setLoading(true);
    const r = await bsRequest(`/links${qs({ state: st, limit: 50, offset })}`);
    setLoading(false);
    const paged = r.ok ? mapLinks(r.json) : null;
    if (!paged) { setFailed(true); return; }
    setFailed(false);
    setItems((cur) => (offset === 0 ? paged.items : [...cur, ...paged.items]));
    setHasMore(paged.page.hasMore);
  }

  async function confirm(reason?: string): Promise<void> {
    if (!pending) return;
    setBusy(true);
    setDialogError(undefined);
    const body = pending.action === "approve" ? {} : { reason: reason ?? "" };
    const r = await bsRequest(`/links/${encodeURIComponent(pending.link.linkId)}/${pending.action}`, { method: "POST", body });
    setBusy(false);
    if (!r.ok) { setDialogError(errorText(describe(r))); return; }
    setPending(null);
    setNotice(t("links.queued"));
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { void load(state, 0).then(() => setNotice(null)); }, QUEUED_RELOAD_DELAY_MS);
  }

  const view = items.length > 0 ? "ready" : failed ? "error" : listView({ source: "api", data: items });
  const act = pending?.action;
  const title = act === "approve" ? t("links.approveTitle") : act === "reject" ? t("links.rejectTitle") : t("links.unlinkTitle");
  const mismatchApprove = act === "approve" && pending?.link.state === "flagged_mismatch";

  return (
    <BulkScanShell title={t("links.title")} subtitle={t("links.subtitle")} active="links">
      <div className="card" style={{ padding: 16, marginBottom: 16 }}>
        <form role="search" aria-label={t("links.filterLabel")} onSubmit={(e) => e.preventDefault()} style={{ display: "flex", gap: 12, alignItems: "end", flexWrap: "wrap" }}>
          <Field label={t("links.filterState")}>
            <Select value={state} onChange={(e) => { setState(e.target.value); void load(e.target.value, 0); }}>
              {LINK_STATES.map((s) => <option key={s} value={s}>{t(`linkState.${s}`)}</option>)}
            </Select>
          </Field>
          <Button variant="ghost" loading={loading} onClick={() => { void load(state, 0); }}>{t("action.refresh")}</Button>
        </form>
        <p style={{ fontSize: 13, margin: "8px 0 0" }}>{t("links.makerChecker")}</p>
      </div>
      <p role="status" aria-live="polite" style={{ minHeight: 18, margin: "0 0 8px" }}>{notice ?? ""}</p>

      {view === "error" ? (result.source === "error" && !loading
        ? <LoadErrorState result={result} area={t("links.area")} backHref="/admin/bulk-scan" />
        : <InlineError message={t("links.loadFailed")} onRetry={() => { void load(state, 0); }} retryLabel={t("action.retry")} />) : null}
      {failed && items.length > 0 ? <InlineError message={t("links.loadFailed")} onRetry={() => { void load(state, 0); }} retryLabel={t("action.retry")} /> : null}
      {view === "empty" ? <div className="card"><EmptyState icon="🔗" title={t("links.emptyTitle")} message={t("links.emptyMessage", { state: t(`linkState.${state}`) })} /></div> : null}
      {view === "ready" ? (
        <div className="card" style={{ overflowX: "auto" }}>
          <table className="tbl" style={{ width: "100%" }}>
            <caption className="sr-only">{t("links.tableCaption")}</caption>
            <thead><tr>
              <th scope="col">{t("links.colTarget")}</th><th scope="col">{t("links.colState")}</th><th scope="col">{t("links.colRequestedBy")}</th>
              <th scope="col">{t("links.colReason")}</th><th scope="col">{t("links.colCreated")}</th><th scope="col">{t("links.colActions")}</th>
            </tr></thead>
            <tbody>
              {items.map((l) => {
                const a = linkActions(l, currentUserId);
                return (
                  <tr key={l.linkId}>
                    <th scope="row" style={{ textAlign: "start" }}>{t(`target.${l.target}`)}<span style={{ display: "block", fontSize: 12, fontWeight: 400 }}>{l.targetId}</span></th>
                    <td><LinkStateChip state={l.state} /></td>
                    <td>{shortId(l.requestedBy)}{currentUserId !== null && l.requestedBy === currentUserId ? ` (${t("links.you")})` : ""}</td>
                    <td><LinkReasonLine reason={l.resultReason ?? l.reason} detail={l.detail} /></td>
                    <td>{formatIndianDateTime(l.createdAt)}</td>
                    <td>
                      <span style={{ display: "inline-flex", gap: 4, flexWrap: "wrap" }}>
                        {a.approve ? <Button size="sm" onClick={() => setPending({ action: "approve", link: l })} aria-label={t("links.approveAria", { target: l.targetId })}>{t("action.approve")}</Button> : null}
                        {a.approveBlockedBySelf ? <span style={{ fontSize: 12 }}>{t("links.selfBlocked")}</span> : null}
                        {a.reject ? <Button size="sm" variant="danger" onClick={() => setPending({ action: "reject", link: l })} aria-label={t("links.rejectAria", { target: l.targetId })}>{t("action.reject")}</Button> : null}
                        {a.unlink ? <Button size="sm" variant="ghost" onClick={() => setPending({ action: "unlink-request", link: l })} aria-label={t("links.unlinkAria", { target: l.targetId })}>{t("links.unlink")}</Button> : null}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {hasMore ? <div style={{ padding: 12, textAlign: "center" }}><Button variant="ghost" loading={loading} onClick={() => { void load(state, items.length); }}>{t("action.loadMore")}</Button></div> : null}
        </div>
      ) : null}

      <ConfirmDialog
        open={pending !== null} title={title} danger={act !== "approve" || mismatchApprove}
        description={mismatchApprove ? t("links.approveMismatchDesc") : act === "approve" ? t("links.approveDesc") : act === "reject" ? t("links.rejectDesc") : t("links.unlinkDesc")}
        requireReason={act !== "approve"} minReasonLength={act === "unlink-request" ? 5 : 3} maxReasonLength={500} reasonLabel={t("links.reason")}
        confirmLabel={act === "approve" ? t("action.approve") : act === "reject" ? t("action.reject") : t("links.unlink")} cancelLabel={t("action.cancel")} busy={busy}
        {...(dialogError ? { errorMessage: dialogError } : {})}
        onConfirm={(r) => { void confirm(r); }} onCancel={() => { if (!busy) { setPending(null); setDialogError(undefined); } }}
      />
    </BulkScanShell>
  );
}
