"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button, EmptyState, Field, Input, Select } from "@/app/_components/ds";
import { useBulkScanError, type BsError } from "@/lib/bulkScan/useBulkScanError";
import { bsRequest, qs } from "@/lib/bulkScan/api";
import { ScannedDownloadAlert } from "@/app/_components/ScannedDownloadAlert";
import type { DownloadVariant } from "@/lib/bulkScan/download";
import { useScannedDownload } from "@/lib/bulkScan/useScannedDownload";
import { mapSearch } from "@/lib/bulkScan/mappers";
import { safeMaskedPreview } from "@/lib/bulkScan/review";
import type { SearchHit } from "@/lib/bulkScan/types";
import { formatIndianDateTime } from "@/lib/formatters";
import { Chip, ConfidenceBadge } from "./Chips";
import { BulkScanShell, InlineError } from "./BulkScanShell";

export const MIN_QUERY_LENGTH = 2;

type Phase = { kind: "idle" } | { kind: "loading" } | { kind: "error"; error: BsError } | { kind: "done"; hits: SearchHit[]; hasMore: boolean; q: string };

export function SearchView({ docTypes }: { docTypes: Array<{ id: string; label: string }> }) {
  const t = useTranslations("bulkScan");
  const describe = useBulkScanError();
  const [q, setQ] = useState("");
  const [docType, setDocType] = useState("");
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [tooShort, setTooShort] = useState(false);
  const { busyId: busyDoc, failure: downloadFailure, download: runDownload, retry: retryDownload } = useScannedDownload();

  async function run(offset = 0, append: SearchHit[] = []): Promise<void> {
    const query = q.trim();
    if (query.length < MIN_QUERY_LENGTH) { setTooShort(true); return; }
    setTooShort(false);
    setPhase({ kind: "loading" });
    const r = await bsRequest(`/search${qs({ q: query, docType, limit: 20, offset })}`);
    if (!r.ok) { setPhase({ kind: "error", error: describe(r, "load") }); return; }
    const paged = mapSearch(r.json);
    if (!paged) { setPhase({ kind: "error", error: { message: t("apiError.generic"), reference: null } }); return; }
    setPhase({ kind: "done", hits: [...append, ...paged.items], hasMore: paged.page.hasMore, q: query });
  }

  const download = (documentId: string, fileName: string, variant: DownloadVariant): Promise<void> => runDownload(documentId, fileName, variant);

  return (
    <BulkScanShell title={t("search.title")} subtitle={t("search.subtitle")} active="search">
      <div className="card" style={{ padding: 16, marginBottom: 16 }}>
        <form role="search" aria-label={t("search.formLabel")} onSubmit={(e) => { e.preventDefault(); void run(); }} style={{ display: "flex", gap: 12, alignItems: "end", flexWrap: "wrap" }}>
          <Field label={t("search.query")} {...(tooShort ? { error: t("search.tooShort", { min: MIN_QUERY_LENGTH }) } : {})} style={{ minWidth: 260, flex: 1 }}>
            <Input type="search" value={q} onChange={(e) => setQ(e.target.value)} maxLength={200} />
          </Field>
          <Field label={t("search.docType")}>
            <Select value={docType} onChange={(e) => setDocType(e.target.value)}>
              <option value="">{t("search.anyType")}</option>
              {docTypes.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
            </Select>
          </Field>
          <Button type="submit" loading={phase.kind === "loading"}>{t("search.run")}</Button>
        </form>
        <p style={{ fontSize: 12, margin: "8px 0 0" }}>{t("search.maskedNote")}</p>
      </div>

      <div aria-live="polite">
        {phase.kind === "idle" ? <div className="card"><EmptyState icon="🔍" title={t("search.idleTitle")} message={t("search.idleMessage")} /></div> : null}
        {phase.kind === "loading" ? <p>{t("search.loading")}</p> : null}
        {phase.kind === "error" ? <InlineError message={phase.error.message} reference={phase.error.reference} onRetry={() => { void run(); }} retryLabel={t("action.retry")} /> : null}
        {phase.kind === "done" && phase.hits.length < 1 ? <div className="card"><EmptyState icon="📭" title={t("search.noResultsTitle")} message={t("search.noResultsMessage", { q: phase.q })} /></div> : null}
      </div>
      {phase.kind === "done" && phase.hits.length > 0 ? (
        <div className="card" style={{ overflowX: "auto" }}>
          <p role="status" style={{ margin: 12 }}>{t("search.resultCount", { count: phase.hits.length })}</p>
          <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {phase.hits.map((h) => (
              <li key={h.documentId} style={{ padding: 12, borderTop: "1px solid var(--line)", display: "grid", gap: 4 }}>
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  <strong>{h.fileName}</strong>
                  {h.docType ? <span style={{ fontSize: 12 }}>{docTypes.find((d) => d.id === h.docType)?.label ?? h.docType}</span> : null}
                  <ConfidenceBadge value={h.confidence} />
                  {h.filedAt ? <span style={{ fontSize: 12 }}>{t("search.filed", { at: formatIndianDateTime(h.filedAt) })}</span> : null}
                </div>
                {h.snippetMasked ? <p style={{ margin: 0, fontSize: 13 }}>{safeMaskedPreview(h.snippetMasked)}</p> : null}
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                  {h.links.map((l) => <Chip key={`${l.target}:${l.targetId}`} tone="info" icon="🔗">{t(`target.${l.target}`)} · {l.targetId}</Chip>)}
                  <Button size="sm" variant="ghost" disabled={busyDoc === h.documentId} aria-label={t("search.downloadAria", { name: h.fileName })} onClick={() => { void download(h.documentId, h.fileName, "original"); }}>
                    {busyDoc === h.documentId ? t("search.downloading") : t("search.download")}
                  </Button>
                  <Button size="sm" variant="ghost" disabled={busyDoc === h.documentId} aria-label={t("search.downloadPdfAria", { name: h.fileName })} onClick={() => { void download(h.documentId, h.fileName, "searchable_pdf"); }}>{t("search.downloadPdf")}</Button>
                </div>
              </li>
            ))}
          </ul>
          {phase.hasMore ? <div style={{ padding: 12, textAlign: "center" }}><Button variant="ghost" onClick={() => { void run(phase.hits.length, phase.hits); }}>{t("action.loadMore")}</Button></div> : null}
        </div>
      ) : null}
      {downloadFailure ? <ScannedDownloadAlert failure={downloadFailure.failure} onRetry={retryDownload} /> : null}
    </BulkScanShell>
  );
}
