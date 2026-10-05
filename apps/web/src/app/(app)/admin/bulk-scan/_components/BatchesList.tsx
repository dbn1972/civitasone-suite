"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Button, EmptyState, Field, Input, LoadErrorState, Select } from "@/app/_components/ds";
import type { LoaderResult } from "@/app/_data/apiClient";
import { bsRequest, qs } from "@/lib/bulkScan/api";
import { listView } from "@/lib/bulkScan/listView";
import { mapBatches } from "@/lib/bulkScan/mappers";
import { BATCH_STATUSES, type BatchView, type Paged } from "@/lib/bulkScan/types";
import { formatBytes, groupedCounts, progressFromCounts, hasActiveWork } from "@/lib/bulkScan/status";
import { usePolling } from "@/lib/bulkScan/usePolling";
import { formatIndianDateTime } from "@/lib/formatters";
import { BatchStatusChip, Chip, Meter } from "./Chips";
import { BulkScanShell, InlineError } from "./BulkScanShell";

/** Name filter applied client-side to what is loaded (case-insensitive). */
export function filterBatchesByName(items: readonly BatchView[], query: string): BatchView[] {
  const q = query.trim().toLowerCase();
  return q ? items.filter((b) => b.name.toLowerCase().includes(q)) : [...items];
}

export function BatchProgress({ batch }: { batch: Pick<BatchView, "counts" | "progress" | "name"> }) {
  const t = useTranslations("bulkScan");
  const p = batch.progress.total > 0 ? batch.progress : progressFromCounts(batch.counts);
  const groups = groupedCounts(batch.counts).filter((g) => g.count > 0);
  return (
    <div>
      <Meter percent={p.percent} label={t("list.progressLabel", { name: batch.name })} valueText={t("list.progressText", { settled: p.settled, total: p.total, percent: p.percent })} />
      <div style={{ fontSize: 12, margin: "4px 0" }}>{t("list.progressText", { settled: p.settled, total: p.total, percent: p.percent })}</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
        {groups.map((g) => (
          <Chip key={g.id} tone={g.tone} icon={g.tone === "bad" ? "✕" : g.tone === "good" ? "✓" : g.tone === "warn" ? "⚠" : g.tone === "info" ? "⏳" : "•"}>
            {t(`group.${g.id}`)}: {g.count}
          </Chip>
        ))}
      </div>
    </div>
  );
}

export function BatchesList({ result }: { result: LoaderResult<Paged<BatchView>> }) {
  const t = useTranslations("bulkScan");
  const [items, setItems] = useState<BatchView[]>(result.data.items);
  const [hasMore, setHasMore] = useState(result.data.page.hasMore);
  const [failed, setFailed] = useState(result.source === "error");
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("");
  const [name, setName] = useState("");

  const load = useCallback(async (st: string, offset: number): Promise<boolean> => {
    setLoading(true);
    const r = await bsRequest(`/batches${qs({ status: st, limit: 50, offset })}`);
    setLoading(false);
    const paged = r.ok ? mapBatches(r.json) : null;
    if (!paged) { setFailed(true); return false; }
    setFailed(false);
    setItems((cur) => (offset === 0 ? paged.items : [...cur, ...paged.items]));
    setHasMore(paged.page.hasMore);
    return true;
  }, []);

  const active = items.some((b) => hasActiveWork(b.counts, b.status));
  usePolling(async () => {
    const before = JSON.stringify(items.map((b) => [b.id, b.counts, b.status]));
    const r = await bsRequest(`/batches${qs({ status, limit: 50 })}`);
    const paged = r.ok ? mapBatches(r.json) : null;
    if (!paged) return { keepGoing: true, changed: false, failed: true };
    setItems(paged.items);
    setHasMore(paged.page.hasMore);
    setFailed(false);
    return { keepGoing: paged.items.some((b) => hasActiveWork(b.counts, b.status)), changed: JSON.stringify(paged.items.map((b) => [b.id, b.counts, b.status])) !== before, failed: false };
  }, { enabled: active && !failed });

  const shown = filterBatchesByName(items, name);
  const view = items.length > 0 ? "ready" : failed ? "error" : listView({ source: "api", data: items });
  const nothingMatches = view === "ready" && shown.length < 1;

  return (
    <BulkScanShell
      title={t("list.title")} subtitle={t("list.subtitle")} active="batches"
      actions={<Link href="/admin/bulk-scan/new" className="btn primary">{t("list.newBatch")}</Link>}
    >
      <div className="card" style={{ padding: 16, marginBottom: 16 }}>
        <form role="search" aria-label={t("list.filterLabel")} onSubmit={(e) => e.preventDefault()} style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "end" }}>
          <Field label={t("list.filterStatus")}>
            <Select value={status} onChange={(e) => { setStatus(e.target.value); void load(e.target.value, 0); }}>
              <option value="">{t("list.allStatuses")}</option>
              {BATCH_STATUSES.map((s) => <option key={s} value={s}>{t(`batchStatus.${s}`)}</option>)}
            </Select>
          </Field>
          <Field label={t("list.filterName")}>
            <Input type="search" value={name} onChange={(e) => setName(e.target.value)} placeholder={t("list.filterNamePlaceholder")} />
          </Field>
          <Button variant="ghost" onClick={() => { void load(status, 0); }} loading={loading}>{t("action.refresh")}</Button>
        </form>
      </div>

      {view === "error" ? (
        result.source === "error" && !loading
          ? <LoadErrorState result={result} area={t("list.area")} backHref="/admin" />
          : <InlineError message={t("list.loadFailed")} onRetry={() => { void load(status, 0); }} retryLabel={t("action.retry")} />
      ) : null}
      {failed && items.length > 0 ? <InlineError message={t("list.refreshFailed")} onRetry={() => { void load(status, 0); }} retryLabel={t("action.retry")} /> : null}
      {view === "empty" ? (
        <div className="card">
          <EmptyState icon="📄" title={status ? t("list.emptyFilteredTitle") : t("list.emptyTitle")} message={status ? t("list.emptyFilteredMessage") : t("list.emptyMessage")}
            action={<Link href="/admin/bulk-scan/new" className="btn primary">{t("list.newBatch")}</Link>} />
        </div>
      ) : null}
      {nothingMatches ? <div className="card"><EmptyState icon="🔍" title={t("list.noMatchTitle")} message={t("list.noMatchMessage")} /></div> : null}
      {view === "ready" && !nothingMatches ? (
        <div className="card" style={{ overflowX: "auto" }}>
          <table className="tbl" style={{ width: "100%" }}>
            <caption className="sr-only">{t("list.tableCaption")}</caption>
            <thead>
              <tr>
                <th scope="col">{t("list.colName")}</th>
                <th scope="col">{t("list.colStatus")}</th>
                <th scope="col" style={{ minWidth: 240 }}>{t("list.colProgress")}</th>
                <th scope="col">{t("list.colFiles")}</th>
                <th scope="col">{t("list.colCreated")}</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((b) => (
                <tr key={b.id}>
                  <th scope="row" style={{ textAlign: "start" }}><Link href={`/admin/bulk-scan/${encodeURIComponent(b.id)}`}>{b.name}</Link></th>
                  <td><BatchStatusChip status={b.status} /></td>
                  <td><BatchProgress batch={b} /></td>
                  <td>{b.fileCount} · {formatBytes(b.totalBytes)}</td>
                  <td>{formatIndianDateTime(b.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {hasMore ? <div style={{ padding: 12, textAlign: "center" }}><Button variant="ghost" loading={loading} onClick={() => { void load(status, items.length); }}>{t("action.loadMore")}</Button></div> : null}
        </div>
      ) : null}
    </BulkScanShell>
  );
}
