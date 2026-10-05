"use client";

import { useTranslations } from "next-intl";
import { ScannedDownloadAlert } from "@/app/_components/ScannedDownloadAlert";
import { Button, DataTable } from "@/app/_components/ds";
import { formatIndianDateTime, formatMoney } from "@/lib/formatters";
import { useScannedDownload } from "@/lib/bulkScan/useScannedDownload";
import { formatConfidencePct } from "@/lib/scannedDocuments";
import { useScannedDocumentLabels } from "@/lib/useScannedDocumentLabels";
import type { ScannedDocument } from "@/lib/finance/scannedDocuments";

type Row = ScannedDocument & Record<string, unknown>;

/** Attachments linked from Admin > Bulk scan. Download goes through document-service (presigned, audited) via the BFF. */
export function ScannedDocumentsTable({ rows }: { rows: ScannedDocument[] }) {
  const t = useTranslations("financeScannedDocuments");
  const { busyId, failure, download, retry } = useScannedDownload();
  const labels = useScannedDocumentLabels();

  return (
    <div>
      <DataTable<Row>
        rowKey={(r) => r.id}
        columns={[
          {
            key: "fileName", label: t("colFile"),
            render: (r) => (
              <span>
                {r.fileName}
                {r.textPreviewMasked ? <span style={{ display: "block", fontSize: 12, color: "var(--ink2)" }}>{r.textPreviewMasked}</span> : null}
              </span>
            ),
          },
          { key: "docType", label: t("colType"), render: (r) => labels.docType(r.docType) },
          { key: "pageCount", label: t("colPages"), align: "right" },
          { key: "ocrConfidence", label: t("colConfidence"), align: "right", render: (r) => formatConfidencePct(r.ocrConfidence) },
          { key: "matchedReference", label: t("colReference"), render: (r) => r.matchedReference ?? "—" },
          {
            key: "matchedAmountMinor", label: t("colAmount"), align: "right",
            render: (r) => (r.matchedAmountMinor === null ? "—" : formatMoney(r.matchedAmountMinor)),
          },
          { key: "piiFlags", label: t("colPii"), render: (r) => (r.piiFlags.length === 0 ? t("piiNone") : t("piiMasked", { types: labels.piiTypes(r.piiFlags) })) },
          { key: "linkedAt", label: t("colLinked"), render: (r) => (r.linkedAt ? formatIndianDateTime(r.linkedAt) : "—") },
          {
            key: "documentId", label: t("colActions"), csvExclude: true,
            render: (r) => (
              <Button
                type="button" size="sm" variant="ghost"
                disabled={busyId === r.documentId}
                aria-label={t("downloadAria", { name: r.fileName })}
                onClick={() => void download(r.documentId, r.fileName)}
              >
                {busyId === r.documentId ? t("downloading") : t("download")}
              </Button>
            ),
          },
        ]}
        rows={rows as Row[]}
      />
      {failure ? <ScannedDownloadAlert failure={failure.failure} onRetry={retry} /> : null}
    </div>
  );
}
