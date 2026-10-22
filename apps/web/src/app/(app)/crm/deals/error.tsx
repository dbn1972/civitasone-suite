"use client";

import { useTranslations } from "next-intl";
import { RouteError } from "@/app/_components/RouteError";

export default function ErrorBoundary({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  // GAP-CRM-DEALS-07: one canonical noun ("engagement") on every deals screen,
  // and no hard-coded English on the list route's error boundary.
  const t = useTranslations("crmDealError");
  return (
    <RouteError
      error={error}
      reset={reset}
      backHref="/crm"
      backLabel={t("listBackLabel")}
      area={t("listArea")}
    />
  );
}
