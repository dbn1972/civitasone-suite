"use client";

import { useTranslations } from "next-intl";
import { EmptyState, LoadErrorState } from "@/app/_components/ds";
import type { LoaderResult } from "@/app/_data/apiClient";
import { BulkScanShell } from "./BulkScanShell";

/** The review file could not be loaded: a 404 is "not found" (it may have been filed), anything else is a retryable load error. */
export function ReviewUnavailable({ result }: { result: LoaderResult<unknown> }) {
  const t = useTranslations("bulkScan");
  return (
    <BulkScanShell title={t("review.title")} active="review" back="/admin/bulk-scan/review">
      {result.status === 404
        ? <div className="card"><EmptyState icon="🔎" title={t("review.notFoundTitle")} message={t("review.notFoundMessage")} /></div>
        : <LoadErrorState result={result} area={t("review.area")} backHref="/admin/bulk-scan/review" />}
    </BulkScanShell>
  );
}
