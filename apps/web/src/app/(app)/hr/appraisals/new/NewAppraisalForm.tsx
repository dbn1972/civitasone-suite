"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import type { EmployeeSummary } from "@civitasone/types";
import { useFormError } from "@/lib/useFormError";

type Props = {
  employees: EmployeeSummary[];
};

export function NewAppraisalForm({ employees }: Props) {
  const router = useRouter();

  const [employeeId, setEmployeeId] = useState("");
  const [appraisalPeriod, setAppraisalPeriod] = useState("");
  const [reviewerId, setReviewerId] = useState("");
  const [status, setStatus] = useState<"idle" | "submitting" | "success" | "error">("idle");
  const [message, setMessage] = useState("");
  const formError = useFormError("appraisal");

  const employeeFieldId = useId();
  const periodFieldId = useId();
  const reviewerFieldId = useId();
  const statusMsgId = useId();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!employeeId || !appraisalPeriod.trim()) {
      setStatus("error");
      setMessage("Employee and appraisal period are required.");
      return;
    }

    setStatus("submitting");
    setMessage("");
    formError.clear();

    try {
      const res = await fetch("/api/proxy/v1/hrms/appraisals", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          employeeId,
          appraisalPeriod: appraisalPeriod.trim(),
          reviewerId: reviewerId || undefined,
        }),
      });

      if (!res.ok) {
        const resolved = await formError.fromResponse(res, "save");
        setStatus("error");
        setMessage(resolved.message);
        return;
      }

      setStatus("success");
      setMessage("Appraisal created successfully.");
      router.push("/hr/appraisals");
    } catch {
      setStatus("error");
      setMessage(formError.fromException("save").message);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="space-y-4 rounded-xl border border-slate-200 bg-white p-6 shadow-sm max-w-2xl"
    >
      <div>
        <label htmlFor={employeeFieldId} className="block text-sm font-medium text-slate-700 mb-1">
          Employee <span aria-hidden="true" className="text-red-500">*</span>
        </label>
        <select
          id={employeeFieldId}
          value={employeeId}
          onChange={(e) => setEmployeeId(e.target.value)}
          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
          required
          aria-required="true"
        >
          {employees.length === 0 ? (
            <option value="">No employees loaded</option>
          ) : (
            <>
            <option value="" disabled>Select an employee...</option>
            {employees.map((emp) => (
              <option key={emp.id} value={emp.id}>
                {emp.name} ({emp.department})
              </option>
            ))}
            </>
          )}
        </select>
      </div>

      <div>
        <label htmlFor={periodFieldId} className="block text-sm font-medium text-slate-700 mb-1">
          Appraisal Period <span aria-hidden="true" className="text-red-500">*</span>
        </label>
        <input
          id={periodFieldId}
          type="text"
          value={appraisalPeriod}
          onChange={(e) => setAppraisalPeriod(e.target.value)}
          placeholder="e.g. 2025-26"
          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          required
          aria-required="true"
          aria-describedby={formError.fieldError("appraisalPeriod") ? "appraisal-period-error" : undefined}
        />
        {formError.fieldError("appraisalPeriod") && (
          <p id="appraisal-period-error" role="alert" className="mt-1 text-xs text-red-600">{formError.fieldError("appraisalPeriod")}</p>
        )}
      </div>

      <div>
        <label htmlFor={reviewerFieldId} className="block text-sm font-medium text-slate-700 mb-1">
          Reviewer (optional)
        </label>
        <select
          id={reviewerFieldId}
          value={reviewerId}
          onChange={(e) => setReviewerId(e.target.value)}
          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
        >
          <option value="">— None —</option>
          {employees.map((emp) => (
            <option key={emp.id} value={emp.id}>
              {emp.name} ({emp.department})
            </option>
          ))}
        </select>
      </div>

      <button
        type="submit"
        disabled={status === "submitting" || employees.length === 0}
        className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-60"
      >
        {status === "submitting" ? "Creating…" : "Create Appraisal"}
      </button>

      {message && (
        <p
          id={statusMsgId}
          role={status === "error" ? "alert" : "status"}
          aria-live={status === "error" ? "assertive" : "polite"}
          className={`text-sm ${status === "error" ? "text-red-600" : "text-emerald-700"}`}
        >
          <span className="font-semibold">{status === "error" ? "Error: " : "Success: "}</span>
          {message}
        </p>
      )}
    </form>
  );
}
