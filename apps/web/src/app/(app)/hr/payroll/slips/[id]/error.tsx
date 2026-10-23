"use client";

import { useTranslations } from "next-intl";
import { RouteError } from "@/app/_components/RouteError";
import { useSessionIdentity } from "@/lib/auth/useSessionIdentity";
import { slipBackTarget } from "./_backTarget";

// GAP-PAYROLL-SLIPS-DETAIL-06: this used to send every role to /hr/payroll
// (the Payroll back label) -- a page an employee cannot open and that differs from the
// header back link an admin sees. The target now comes from the same
// slipBackTarget() the page uses, with the viewer's roles from the session
// (display only: the services re-check every role). Until the session answers,
// roles are empty -> "My payslips", which every role that can reach a slip may open.
export default function ErrorBoundary({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const t = useTranslations("payrollRouteError");
  const { roles } = useSessionIdentity();
  const back = slipBackTarget(roles);
  return (
    <RouteError
      error={error}
      reset={reset}
      backHref={back.href}
      backLabel={t(back.labelKey)}
      area={t("areaSalarySlip")}
    />
  );
}
