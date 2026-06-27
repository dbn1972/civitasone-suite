"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function NewJobOpeningForm() {
  const router = useRouter();

  const [refNo, setRefNo] = useState("");
  const [title, setTitle] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const [vacancies, setVacancies] = useState(1);
  const [description, setDescription] = useState("");
  const [closesAt, setClosesAt] = useState("");
  const [status, setStatus] = useState<"idle" | "submitting" | "success" | "error">("idle");
  const [message, setMessage] = useState("");
  const [invalidField, setInvalidField] = useState<string | null>(null);

  const refNoId = useId();
  const titleId = useId();
  const deptId = useId();
  const vacanciesId = useId();
  const descId = useId();
  const closesAtId = useId();
  const statusMsgId = useId();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!refNo.trim()) {
      setStatus("error");
      setInvalidField("refNo");
      setMessage("Reference No is required.");
      return;
    }
    if (refNo.trim().length > 64) {
      setStatus("error");
      setInvalidField("refNo");
      setMessage("Reference No must be 64 characters or fewer.");
      return;
    }
    if (!title.trim()) {
      setStatus("error");
      setInvalidField("title");
      setMessage("Title is required.");
      return;
    }
    if (!UUID_RE.test(departmentId.trim())) {
      setStatus("error");
      setInvalidField("departmentId");
      setMessage("Department ID must be a valid UUID.");
      return;
    }
    if (vacancies < 1) {
      setStatus("error");
      setInvalidField("vacancies");
      setMessage("Vacancies must be at least 1.");
      return;
    }

    setStatus("submitting");
    setInvalidField(null);
    setMessage("");

    try {
      const res = await fetch("/api/proxy/v1/hrms/job-openings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          refNo: refNo.trim(),
          title: title.trim(),
          departmentId: departmentId.trim(),
          vacancies,
          description: description.trim() || undefined,
          closesAt: closesAt || undefined,
        }),
      });

      const text = await res.text();
      if (!res.ok) {
        setStatus("error");
        setMessage(text || `Request failed (${res.status})`);
        return;
      }

      setStatus("success");
      setMessage("Job opening created successfully.");
      router.push("/hr/recruitment");
    } catch (err) {
      setStatus("error");
      setMessage(err instanceof Error ? err.message : "Network error");
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="space-y-4 rounded-xl border border-slate-200 bg-white p-6 shadow-sm max-w-2xl"
      aria-describedby={message ? statusMsgId : undefined}
      noValidate
    >
      <div>
        <label htmlFor={refNoId} className="block text-sm font-medium text-slate-700 mb-1">
          Reference No <span aria-hidden="true">*</span>
        </label>
        <input
          id={refNoId}
          type="text"
          value={refNo}
          onChange={(e) => setRefNo(e.target.value)}
          placeholder="e.g. JOB-2024-0042"
          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          required
          aria-required="true"
          aria-invalid={invalidField === "refNo"}
          maxLength={64}
        />
      </div>

      <div>
        <label htmlFor={titleId} className="block text-sm font-medium text-slate-700 mb-1">
          Title <span aria-hidden="true">*</span>
        </label>
        <input
          id={titleId}
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. Senior Software Engineer"
          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          required
          aria-required="true"
          aria-invalid={invalidField === "title"}
        />
      </div>

      <div>
        <label htmlFor={deptId} className="block text-sm font-medium text-slate-700 mb-1">
          Department ID (UUID) <span aria-hidden="true">*</span>
        </label>
        <input
          id={deptId}
          type="text"
          value={departmentId}
          onChange={(e) => setDepartmentId(e.target.value)}
          placeholder="e.g. 3f2504e0-4f89-41d3-9a0c-0305e82c3301"
          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          required
          aria-required="true"
          aria-invalid={invalidField === "departmentId"}
        />
      </div>

      <div>
        <label htmlFor={vacanciesId} className="block text-sm font-medium text-slate-700 mb-1">
          Vacancies
        </label>
        <input
          id={vacanciesId}
          type="number"
          min={1}
          value={vacancies}
          onChange={(e) => setVacancies(Number(e.target.value))}
          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          required
          aria-invalid={invalidField === "vacancies"}
        />
      </div>

      <div>
        <label htmlFor={descId} className="block text-sm font-medium text-slate-700 mb-1">
          Description
        </label>
        <textarea
          id={descId}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={4}
          placeholder="Job responsibilities, requirements, and qualifications"
          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
        />
      </div>

      <div>
        <label htmlFor={closesAtId} className="block text-sm font-medium text-slate-700 mb-1">
          Closing Date
        </label>
        <input
          id={closesAtId}
          type="date"
          value={closesAt}
          onChange={(e) => setClosesAt(e.target.value)}
          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
      </div>

      <button
        type="submit"
        disabled={status === "submitting"}
        className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-60"
      >
        {status === "submitting" ? "Creating…" : "Create Job Opening"}
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
