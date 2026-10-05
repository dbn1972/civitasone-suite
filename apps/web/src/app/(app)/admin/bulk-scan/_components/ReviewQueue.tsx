"use client";

import { useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Button, EmptyState, Field, LoadErrorState, Select } from "@/app/_components/ds";
import type { LoaderResult } from "@/app/_data/apiClient";
import { bsRequest, qs } from "@/lib/bulkScan/api";
import { listView } from "@/lib/bulkScan/listView";
import { mapReviewQueue } from "@/lib/bulkScan/mappers";
import { reviewPath } from "@/lib/bulkScan/review";
import { describeReviewReason, REVIEW_REASON_CODES } from "@/lib/bulkScan/status";
import type { Paged, ReviewQueueItem } from "@/lib/bulkScan/types";
import { formatIndianDateTime } from "@/lib/formatters";
import { Chip, ConfidenceBadge } from "./Chips";
import { BulkScanShell, InlineError } from "./BulkScanShell";

export function ReviewQueue({ result }: { result: LoaderResult<Paged<ReviewQueueItem>> }) {
  const t = useTranslations("bulkScan");
  const [items, setItems] = useState<ReviewQueueItem[]>(result.data.items);
  const [hasMore, setHasMore] = useState(result.data.page.hasMore);
  const [failed, setFailed] = useState(result.source === "error");
  const [loading, setLoading] = useState(false);
  const [reason, setReason] = useState("");

  async function load(r: string, offset: number): Promise<void> {
    setLoading(true);
    const res = await bsRequest(`/review-queue${qs({ limit: 50, offset, reason: r })}`);
    setLoading(false);
    const paged = res.ok ? mapReviewQueue(res.json) : null;
    if (!paged) { setFailed(true); return; }
    setFailed(false);
    setItems((cur) => (offset === 0 ? paged.items : [...cur, ...paged.items]));
    setHasMore(paged.page.hasMore);
  }

  const view = items.length > 0 ? "ready" : failed ? "error" : listView({ source: "api", data: items });
  const first = items[0];

  return (
    <BulkScanShell
      title={t("queue.title")} subtitle={t("queue.subtitle")} active="review"
      actions={first ? <Link href={reviewPath(first.batchId, first.fileId)} className="btn primary">{t("queue.reviewNext")}</Link> : undefined}
    >
      <div className="card" style={{ padding: 16, marginBottom: 16 }}>
        <form role="search" aria-label={t("queue.filterLabel")} onSubmit={(e) => e.preventDefault()} style={{ display: "flex", gap: 12, alignItems: "end", flexWrap: "wrap" }}>
          <Field label={t("queue.filterReason")}>
            <Select value={reason} onChange={(e) => { setReason(e.target.value); void load(e.target.value, 0); }}>
              <option value="">{t("queue.allReasons")}</option>
              {REVIEW_REASON_CODES.map((c) => <option key={c} value={c}>{t(describeReviewReason(c).key, { field: "…", detail: "…" })}</option>)}
            </Select>
          </Field>
          <Button variant="ghost" loading={loading} onClick={() => { void load(reason, 0); }}>{t("action.refresh")}</Button>
        </form>
      </div>

      {view === "error" ? (result.source === "error" && !loading
        ? <LoadErrorState result={result} area={t("queue.area")} backHref="/admin/bulk-scan" />
        : <InlineError message={t("queue.loadFailed")} onRetry={() => { void load(reason, 0); }} retryLabel={t("action.retry")} />) : null}
      {failed && items.length > 0 ? <InlineError message={t("queue.loadFailed")} onRetry={() => { void load(reason, 0); }} retryLabel={t("action.retry")} /> : null}
      {view === "empty" ? (
        <div className="card"><EmptyState icon="✅" title={reason ? t("queue.emptyFilteredTitle") : t("queue.emptyTitle")} message={reason ? t("queue.emptyFilteredMessage") : t("queue.emptyMessage")} /></div>
      ) : null}
      {view === "ready" ? (
        <div className="card" style={{ overflowX: "auto" }}>
          <table className="tbl" style={{ width: "100%" }}>
            <caption className="sr-only">{t("queue.tableCaption")}</caption>
            <thead>
              <tr><th scope="col">{t("queue.colFile")}</th><th scope="col">{t("queue.colType")}</th><th scope="col">{t("queue.colConfidence")}</th><th scope="col">{t("queue.colReasons")}</th><th scope="col">{t("queue.colFlags")}</th><th scope="col">{t("queue.colUpdated")}</th></tr>
            </thead>
            <tbody>
              {items.map((q) => (
                <tr key={q.fileId}>
                  <th scope="row" style={{ textAlign: "start" }}>
                    <Link href={reviewPath(q.batchId, q.fileId)}>{q.originalName}</Link>
                    <span style={{ display: "block", fontSize: 12, fontWeight: 400 }}>{q.batchName ? `${q.batchName} · ` : ""}{q.pageCount !== null ? t("queue.pages", { count: q.pageCount }) : ""}</span>
                  </th>
                  <td>{q.docType ?? "—"}</td>
                  <td><ConfidenceBadge value={q.confidence} /></td>
                  <td>
                    <ul style={{ margin: 0, paddingInlineStart: 16 }}>
                      {q.reasons.map((r) => { const d = describeReviewReason(r); return <li key={r}>{t(d.key, d.params)}</li>; })}
                    </ul>
                  </td>
                  <td>
                    {q.piiFlags.length > 0 ? <Chip tone="warn" icon="🛡">{t("queue.pii", { types: q.piiFlags.join(", ") })}</Chip> : null}
                    {q.degradedPages > 0 ? <Chip tone="warn" icon="⚠">{t("queue.degraded", { count: q.degradedPages })}</Chip> : null}
                  </td>
                  <td>{formatIndianDateTime(q.updatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {hasMore ? <div style={{ padding: 12, textAlign: "center" }}><Button variant="ghost" loading={loading} onClick={() => { void load(reason, items.length); }}>{t("action.loadMore")}</Button></div> : null}
        </div>
      ) : null}
    </BulkScanShell>
  );
}
