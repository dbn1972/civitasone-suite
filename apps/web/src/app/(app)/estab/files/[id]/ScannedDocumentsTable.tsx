"use client";

import { useTranslations } from "next-intl";
import { ScannedDownloadAlert } from "@/app/_components/ScannedDownloadAlert";
import { Button, DataTable } from "@/app/_components/ds";
import { formatIndianDateTime } from "@/lib/formatters";
import { useScannedDownload } from "@/lib/bulkScan/useScannedDownload";
import { formatConfidencePct, type EstabScannedDocument } from "@/lib/estab/scannedDocuments";
import { useScannedDocumentLabels } from "@/lib/useScannedDocumentLabels";

type Row = EstabScannedDocument & Record<string, unknown>;

/** Scans filed onto this eFile from Admin > Bulk scan. Download goes through document-service (presigned, audited) via the BFF. */
export function ScannedDocumentsTable({ rows }: { rows: EstabScannedDocument[] }) {
  const t = useTranslations("estabScannedDocuments");
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
          { key: "piiFlags", label: t("colPii"), render: (r) => (r.piiFlags.length === 0 ? t("piiNone") : t("piiMasked", { types: labels.piiTypes(r.piiFlags) })) },
          { key: "filedAt", label: t("colFiled"), render: (r) => (r.filedAt ? formatIndianDateTime(r.filedAt) : "—") },
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
