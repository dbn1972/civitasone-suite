"use client";

import { RouteError } from "@/app/_components/RouteError";
import { useTranslations } from "next-intl";

export default function ErrorBoundary({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const t = useTranslations("crm.dealsNew");
  return (
    <RouteError
      error={error}
      reset={reset}
      backHref="/crm/deals"
      backLabel={t("errorBack")}
      area={t("title")}
    />
  );
}
