"use client";

import { useTranslations } from "next-intl";
import { RouteError } from "@/app/_components/RouteError";

export default function ErrorBoundary({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const t = useTranslations("recruitmentDetail");
  return (
    <RouteError
      error={error}
      reset={reset}
      backHref="/hr/recruitment"
      backLabel={t("routeErrorBackLabel")}
      area={t("routeErrorArea")}
    />
  );
}
