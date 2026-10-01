"use client";

import { useTranslations } from "next-intl";
import { RouteError } from "@/app/_components/RouteError";

export default function ErrorBoundary({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const t = useTranslations("payrollReturns");
  return (
    <RouteError
      error={error}
      reset={reset}
      backHref="/hr/payroll"
      backLabel={t("backToPayrollLabel")}
      area="TDS Returns"
    />
  );
}
