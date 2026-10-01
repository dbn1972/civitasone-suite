"use client";

import { useTranslations } from "next-intl";
import { RouteError } from "@/app/_components/RouteError";

// GAP-PAYROLL-BONUS-05: labels from the message files, like arrears/error.tsx.
export default function ErrorBoundary({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const t = useTranslations("payrollBonus");
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
