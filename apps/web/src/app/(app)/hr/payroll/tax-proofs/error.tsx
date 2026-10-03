"use client";

import { useTranslations } from "next-intl";
import { RouteError } from "@/app/_components/RouteError";

export default function ErrorBoundary({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const t = useTranslations("taxProofs");
  return (
    <RouteError
      error={error}
      reset={reset}
      backHref="/hr/payroll"
      backLabel={t("backLabel")}
      area={t("errorArea")}
    />
  );
}
