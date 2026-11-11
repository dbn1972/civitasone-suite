"use client";

import { useTranslations } from "next-intl";
import { Card, EmptyState, LoadErrorState, SkeletonRow } from "@/app/_components/ds";
import type { LoaderResult } from "@/app/_data/apiClient";
import { useDeferredResource } from "@/app/_components/deferredLoad";
import { estabScannedDocumentsPath, mapEstabScannedDocuments, scannedDocumentsView, type EstabScannedDocument } from "@/lib/estab/scannedDocuments";
import { ScannedDocumentsTable } from "./ScannedDocumentsTable";

const NO_DOCS: EstabScannedDocument[] = [];

/** The three non-loading states for a loaded result. */
export function ScannedDocumentsBody({ result, backHref }: { result: LoaderResult<EstabScannedDocument[]>; backHref: string }) {
  const t = useTranslations("estabScannedDocuments");
  const view = scannedDocumentsView(result);
  // A failed load is its own state (403 -> permission denied, else retryable) -- never "no scanned documents".
  if (view === "error") return <LoadErrorState result={result} area={t("area")} backHref={backHref} />;
  if (view === "empty") return <EmptyState icon="📎" title={t("emptyTitle")} message={t("emptyMessage")} />;
  return <ScannedDocumentsTable rows={result.data} />;
}

/**
 * "Scanned documents" card for the eOffice file detail page.
 *
 * UX-R5 perf (S-14): the read publishes a DPDP audit-on-read event and waited about 5 s for the broker on UAT,
 * which kept the whole file view loading (measured 5.2 s) even though it was already streamed. It now loads in
 * the browser after the page has loaded, so the note sheet and movement trail are usable at once; the
 * audit-on-read still happens on every view.
 */
export function ScannedDocumentsSection({ fileId, backHref }: { fileId: string; backHref: string }) {
  const t = useTranslations("estabScannedDocuments");
  const result = useDeferredResource(estabScannedDocumentsPath(fileId), NO_DOCS, mapEstabScannedDocuments);
  return (
    <Card title={t("cardTitle")}>
      {result ? (
        <ScannedDocumentsBody result={Array.isArray(result.data) ? result : { ...result, data: [] }} backHref={backHref} />
      ) : (
        <div role="status" aria-label={t("loading")}><SkeletonRow /><SkeletonRow /><SkeletonRow /></div>
      )}
    </Card>
  );
}
