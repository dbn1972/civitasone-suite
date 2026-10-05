import Link from "next/link";
import { useTranslations } from "next-intl";
import { Card, EmptyState, LoadErrorState } from "@/app/_components/ds";
import { scannedDocumentsView, type HrScannedDocument } from "@/lib/hr/scannedDocuments";
import type { LoaderResult } from "@/app/_data/apiClient";
import { ScannedDocumentsTable } from "./ScannedDocumentsTable";

/**
 * "Scanned documents" card for the HR employee profile (GAP-ADMIN-BULK-SCAN-02). Three distinct non-loading
 * states: a failed load (403 -> permission denied, else retryable) is NEVER shown as "no scanned documents".
 * The page-level loading.tsx covers the loading state; the Download button has its own busy state.
 *
 * Unlink is initiated from the bulk-scan review UI (document-service owns the maker/approver flow), so this card
 * only links there -- there is no unlink button here by design.
 */
export function ScannedDocumentsSection({ result, backHref }: { result: LoaderResult<HrScannedDocument[]>; backHref: string }) {
  const t = useTranslations("hrScannedDocuments");
  const view = scannedDocumentsView(result);
  return (
    <Card title={t("cardTitle")}>
      {view === "error" ? (
        <LoadErrorState result={result} area={t("area")} backHref={backHref} />
      ) : view === "empty" ? (
        <EmptyState icon="📎" title={t("emptyTitle")} message={t("emptyMessage")} />
      ) : (
        <ScannedDocumentsTable rows={result.data} />
      )}
      <p style={{ fontSize: 13, margin: "12px 0 0" }}>
        <Link href="/admin/bulk-scan">{t("reviewLink")}</Link>
      </p>
    </Card>
  );
}
