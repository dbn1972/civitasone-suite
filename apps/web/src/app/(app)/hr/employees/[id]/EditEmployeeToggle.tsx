"use client";

import { useState } from "react";
import type { EmployeeDetail } from "@civitasone/types";
// HR-A deep-verify finding: this used to import the sibling ./EditEmployeeForm,
// a materially older/thinner fork of the form under ./edit/ -- it was missing
// the statutory/financial fields (bank account, IFSC, UAN, ESIC, PRAN) the
// edit/ version has, and it claimed "Employee profile updated successfully"
// immediately after a 202 (queued/async) PATCH response with no router.refresh,
// so the Personal Information card above stayed stale after a "successful"
// edit until a manual reload. The edit/ page route both forms serve was itself
// unreachable from any in-app link (confirmed via repo-wide grep), so nobody
// was actually getting the better form. Using the same component here fixes
// both problems at once and removes the duplication; see EditEmployeeForm.tsx
// (now deleted -- it had zero remaining references after this change).
import { EditEmployeeForm } from "./edit/EditEmployeeForm";
import { Button } from "@/app/_components/ds";
import { useTranslations } from "next-intl";

interface EditEmployeeToggleProps {
  employee: EmployeeDetail;
}

export function EditEmployeeToggle({ employee }: EditEmployeeToggleProps) {
  const t = useTranslations("employeeEdit");
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <Button
        onClick={() => setOpen(true)}
        aria-expanded={false}
        aria-controls="edit-employee-form"
        style={{ minHeight: 44 }}
      >
        {t("editButton")}
      </Button>
    );
  }

  return (
    <>
      <Button
        onClick={() => setOpen(false)}
        aria-expanded={true}
        aria-controls="edit-employee-form"
        style={{ minHeight: 44 }}
      >
        {t("editButton")}
      </Button>
      <div id="edit-employee-form">
        {/* edit/EditEmployeeForm.tsx manages its own cancel/redirect via
            useRouter (it does not take an onCancel prop) -- it navigates back
            to this same detail URL on cancel or on a successful save, which
            both closes this inline panel (fresh mount resets `open` to false)
            and forces the server component to re-fetch, fixing the stale-data
            bug described above. */}
        <EditEmployeeForm employee={employee} />
      </div>
    </>
  );
}
