"use client";

import { useState } from "react";
import type { EmployeeDetail } from "@civitasone/types";
import { EditEmployeeForm } from "./EditEmployeeForm";

interface EditEmployeeToggleProps {
  employee: EmployeeDetail;
}

export function EditEmployeeToggle({ employee }: EditEmployeeToggleProps) {
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button
        type="button"
        className="btn"
        onClick={() => setOpen(true)}
        aria-expanded={false}
        aria-controls="edit-employee-form"
        style={{ minHeight: 44 }}
      >
        ✏️ Edit
      </button>
    );
  }

  return (
    <>
      <button
        type="button"
        className="btn"
        onClick={() => setOpen(false)}
        aria-expanded={true}
        aria-controls="edit-employee-form"
        style={{ minHeight: 44 }}
      >
        ✏️ Edit
      </button>
      <div id="edit-employee-form">
        <EditEmployeeForm employee={employee} onCancel={() => setOpen(false)} />
      </div>
    </>
  );
}
