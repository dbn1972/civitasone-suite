"use client";

import { useTranslations } from "next-intl";
import { RouteError } from "@/app/_components/RouteError";

// GAP-PAYROLL-SALARY-SLIPS-06: hard-coded English "Back to HR"/"HR page"
// regardless of locale -- every sibling payroll page's error.tsx already
// passes its own translated errorBackLabel/errorArea (see e.g.
// salary-revisions/error.tsx); this one and runs/error.tsx were the
// stragglers still on the generic literal.
export default function ErrorBoundary({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const t = useTranslations("salarySlips");
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
