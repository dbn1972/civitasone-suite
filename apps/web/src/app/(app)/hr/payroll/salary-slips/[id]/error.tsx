"use client";

import { useTranslations } from "next-intl";
import { RouteError } from "@/app/_components/RouteError";

export default function ErrorBoundary({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const t = useTranslations("payrollRouteError");
  return (
    <RouteError
      error={error}
      reset={reset}
      backHref="/hr/payroll/salary-slips"
      backLabel={t("backToSalarySlips")}
      area={t("areaSalarySlip")}
    />
  );
}
