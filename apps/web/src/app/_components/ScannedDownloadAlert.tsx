"use client";

import { useTranslations } from "next-intl";
import { Button } from "@/app/_components/ds";
import { FAILURE_KEYS, isRetryableRouteFailure, type RouteFailure } from "@/lib/bulkScan/download";

/** Failure of a scanned-document download: the distinct (en/hi) reason, plus Retry when trying again can help (clearance outage, transient failure). */
export function ScannedDownloadAlert({ failure, onRetry }: { failure: RouteFailure; onRetry: () => void }) {
  const t = useTranslations("bulkScan");
  return (
    <div role="alert" style={{ color: "var(--bad)", marginTop: 8 }}>
      <p style={{ margin: "0 0 6px", fontSize: 13 }}><span aria-hidden="true">✕ </span>{t(FAILURE_KEYS[failure])}</p>
      {isRetryableRouteFailure(failure) ? <Button size="sm" onClick={onRetry}>{t("action.retry")}</Button> : null}
    </div>
  );
}
