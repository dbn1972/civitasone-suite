"use client";

import { useTranslations } from "next-intl";
import { RouteError } from "@/app/_components/RouteError";

export default function ErrorBoundary({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const t = useTranslations("npsStatements");
  return (
    <RouteError
      error={error}
      reset={reset}
      backHref="/hr"
      backLabel={t("errorBackLabel")}
      area={t("errorArea")}
    />
  );
}
