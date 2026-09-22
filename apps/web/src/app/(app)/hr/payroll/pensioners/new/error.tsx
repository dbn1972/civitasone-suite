"use client";

import { useTranslations } from "next-intl";
import { RouteError } from "@/app/_components/RouteError";

export default function ErrorBoundary({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const t = useTranslations("pensionersNew");
  return (
    <RouteError
      error={error}
      reset={reset}
      backHref="/hr/payroll/pensioners"
      backLabel={t("errorBackLabel")}
      area={t("errorArea")}
    />
  );
}
