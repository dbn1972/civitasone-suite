"use client";

import { useTranslations } from "next-intl";
import { RouteError } from "@/app/_components/RouteError";

// GAP-PAYROLL-NPS-07: back link now matches the page header (/hr/payroll), not /hr.
export default function ErrorBoundary({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const t = useTranslations("npsStatements");
  return (
    <RouteError
      error={error}
      reset={reset}
      backHref="/hr/payroll"
      backLabel={t("errorBackLabel")}
      area={t("errorArea")}
    />
  );
}
