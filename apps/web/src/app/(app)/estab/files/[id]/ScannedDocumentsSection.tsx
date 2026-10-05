import { Suspense } from "react";
import { getTranslations } from "next-intl/server";
import { Card, EmptyState, LoadErrorState, SkeletonRow } from "@/app/_components/ds";
import { getEstabScannedDocuments } from "@/app/_data/loaders";
import { scannedDocumentsView } from "@/lib/estab/scannedDocuments";
import { ScannedDocumentsTable } from "./ScannedDocumentsTable";

/** Loads and renders the three non-loading states. Exported so it can be tested without React streaming. */
export async function ScannedDocumentsBody({ fileId, backHref }: { fileId: string; backHref: string }) {
  const t = await getTranslations("estabScannedDocuments");
  const result = await getEstabScannedDocuments(fileId);
  const view = scannedDocumentsView(result);

  // A failed load is its own state (403 -> permission denied, else retryable) -- never "no scanned documents".
  if (view === "error") return <LoadErrorState result={result} area={t("area")} backHref={backHref} />;
  if (view === "empty") return <EmptyState icon="📎" title={t("emptyTitle")} message={t("emptyMessage")} />;
  return <ScannedDocumentsTable rows={result.data} />;
}

/** "Scanned documents" card for the eOffice file detail page. Streams under its own Suspense. */
export async function ScannedDocumentsSection({ fileId, backHref }: { fileId: string; backHref: string }) {
  const t = await getTranslations("estabScannedDocuments");
  return (
    <Card title={t("cardTitle")}>
      <Suspense fallback={<div role="status" aria-label={t("loading")}><SkeletonRow /><SkeletonRow /><SkeletonRow /></div>}>
        <ScannedDocumentsBody fileId={fileId} backHref={backHref} />
      </Suspense>
    </Card>
  );
}
