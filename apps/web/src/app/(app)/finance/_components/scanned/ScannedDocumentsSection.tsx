import { Suspense } from "react";
import { getTranslations } from "next-intl/server";
import { Card, EmptyState, LoadErrorState, SkeletonRow } from "@/app/_components/ds";
import { getFinanceScannedDocuments } from "@/app/_data/loaders";
import { scannedDocumentsView } from "@/lib/scannedDocuments";
import type { ScannedDocumentsKind } from "@/lib/finance/scannedDocuments";
import { ScannedDocumentsTable } from "./ScannedDocumentsTable";

/** Loads and renders the three non-loading states. Exported so it can be tested without React streaming. */
export async function ScannedDocumentsBody({ kind, id, backHref }: { kind: ScannedDocumentsKind; id: string; backHref: string }) {
  const t = await getTranslations("financeScannedDocuments");
  const result = await getFinanceScannedDocuments(kind, id);
  const view = scannedDocumentsView(result);

  // A failed load is its own state (403 -> permission denied, else retryable) -- never "no attachments".
  if (view === "error") return <LoadErrorState result={result} area={t("area")} backHref={backHref} />;
  if (view === "empty") return <EmptyState icon="📎" title={t("emptyTitle")} message={t(`emptyMessage_${kind}`)} />;
  return <ScannedDocumentsTable rows={result.data} />;
}

/** "Scanned documents" card for a finance payment / bill / voucher detail page. Streams under its own Suspense. */
export async function ScannedDocumentsSection({ kind, id, backHref }: { kind: ScannedDocumentsKind; id: string; backHref: string }) {
  const t = await getTranslations("financeScannedDocuments");
  return (
    <Card title={t("cardTitle")}>
      <Suspense fallback={<div role="status" aria-label={t("loading")}><SkeletonRow /><SkeletonRow /><SkeletonRow /></div>}>
        <ScannedDocumentsBody kind={kind} id={id} backHref={backHref} />
      </Suspense>
    </Card>
  );
}
