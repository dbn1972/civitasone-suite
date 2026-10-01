"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Field, type EntityOption } from "../../../../_components/ds";
import { EmployeePicker } from "../../../../_components/EmployeePicker";

/**
 * GAP-PAYROLL-LOANS-01: search by employee name / code via EmployeePicker
 * instead of a pasted "Employee ID (UUID)". Choosing an employee navigates
 * straight to ?empId=<id>, so the id lives only in the URL.
 */
export function LoanSearchForm({
  initialEmpId,
  initialEmployee,
}: {
  initialEmpId: string;
  /** Server-resolved label for initialEmpId (avoids a client resolve round-trip). */
  initialEmployee?: EntityOption;
}) {
  const t = useTranslations("loanSearchForm");
  const router = useRouter();
  const [empId, setEmpId] = useState<string | null>(initialEmpId || null);
  const fieldId = useId();

  return (
    <div style={{ display: "grid", gap: 6, maxWidth: 520 }}>
      <Field id={fieldId} label={t("fieldLabel")}>
        <EmployeePicker
          value={empId}
          initialOption={initialEmployee}
          onChange={(id) => {
            setEmpId(id);
            if (id) router.push(`/hr/payroll/loans?empId=${encodeURIComponent(id)}`);
          }}
        />
      </Field>
    </div>
  );
}
