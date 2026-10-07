"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useToast } from "@/app/_components/ds/Toast";
import { useFormError } from "@/lib/useFormError";

type FieldType = "text" | "textarea" | "number" | "select" | "boolean";
type Field = { key: string; label: string; type: FieldType; required?: boolean; options?: string[] };
type Priority = "Low" | "Medium" | "High" | "Critical";

export function RaiseRequestForm({
  offeringId,
  schema,
  defaultPriority,
}: {
  offeringId: string;
  schema: Field[];
  defaultPriority: string;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [values, setValues] = useState<Record<string, string | boolean>>({});
  const [priority, setPriority] = useState<Priority>((["Low", "Medium", "High", "Critical"].includes(defaultPriority) ? defaultPriority : "Medium") as Priority);
  // GAP-HELPDESK-CATALOGUE-DETAIL-02: require a justification when the requester
  // escalates to Critical (safest default — the field drives SLA clocks).
  const [criticalReason, setCriticalReason] = useState("");
  const [status, setStatus] = useState<"idle" | "submitting" | "error">("idle");
  const [message, setMessage] = useState("");
  const formError = useFormError("service request");

  function setField(key: string, v: string | boolean) {
    setValues((prev) => ({ ...prev, [key]: v }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    for (const f of schema) {
      if (f.required && (values[f.key] === undefined || values[f.key] === "")) {
        setStatus("error");
        setMessage(`${f.label} is required.`);
        return;
      }
    }
    if (priority === "Critical" && !criticalReason.trim()) {
      setStatus("error");
      setMessage("Please explain why this request is critical.");
      return;
    }
    setStatus("submitting");
    setMessage("");

    const formData: Record<string, unknown> = {};
    for (const f of schema) {
      const v = values[f.key];
      if (v === undefined || v === "") continue;
      formData[f.key] = f.type === "number" ? Number(v) : v;
    }
    if (priority === "Critical" && criticalReason.trim()) {
      formData.criticalReason = criticalReason.trim();
    }

    try {
      const res = await fetch(`/api/proxy/v1/helpdesk/catalogue/offerings/${offeringId}/requests`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ formData, priority }),
      });
      if (!res.ok) {
        setStatus("error");
        setMessage((await formError.fromResponse(res, "save")).message);
        return;
      }
      // GAP-HELPDESK-CATALOGUE-DETAIL-03: confirm the submission with a toast,
      // including a short reference when the response carries one.
      const payload = (await res.json().catch(() => null)) as { data?: { id?: unknown } } | null;
      const newId = payload && payload.data && typeof payload.data.id === "string" ? payload.data.id : null;
      toast.success(
        newId
          ? `Request submitted (ref ${newId.slice(0, 8).toUpperCase()}). Track it under My Requests.`
          : "Request submitted. Track it under My Requests.",
      );
      router.push("/helpdesk/catalogue/my-requests");
      router.refresh();
    } catch (caught) {
      setStatus("error");
      setMessage(formError.fromException("save", caught).message);
    }
  }

  const isSubmitting = status === "submitting";

  return (
    <form onSubmit={(e) => void handleSubmit(e)} noValidate aria-busy={isSubmitting}>
      <div className="fields">
        {schema.map((f) => (
          <div className="field" key={f.key} style={{ gridColumn: "1 / -1", padding: "10px 12px" }}>
            <label className="label" htmlFor={`f-${f.key}`}>
              {f.label} {f.required ? <span aria-hidden="true">*</span> : null}
            </label>
            {f.type === "textarea" ? (
              <textarea id={`f-${f.key}`} className="inp" rows={3} disabled={isSubmitting}
                value={String(values[f.key] ?? "")} onChange={(e) => setField(f.key, e.target.value)} />
            ) : f.type === "select" ? (
              <select id={`f-${f.key}`} className="inp" disabled={isSubmitting}
                value={String(values[f.key] ?? "")} onChange={(e) => setField(f.key, e.target.value)}>
                <option value="">Select…</option>
                {(f.options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            ) : f.type === "boolean" ? (
              <input id={`f-${f.key}`} type="checkbox" disabled={isSubmitting}
                checked={values[f.key] === true} onChange={(e) => setField(f.key, e.target.checked)} />
            ) : (
              <input id={`f-${f.key}`} type={f.type === "number" ? "number" : "text"} className="inp" disabled={isSubmitting}
                value={String(values[f.key] ?? "")} onChange={(e) => setField(f.key, e.target.value)} />
            )}
          </div>
        ))}

        <div className="field" style={{ padding: "10px 12px" }}>
          <label className="label" htmlFor="req-priority">Priority</label>
          <select id="req-priority" className="inp" value={priority} disabled={isSubmitting}
            aria-describedby="req-priority-help"
            onChange={(e) => setPriority(e.target.value as Priority)}>
            <option value="Low">Low</option>
            <option value="Medium">Medium</option>
            <option value="High">High</option>
            <option value="Critical">Critical</option>
          </select>
          {/* GAP-HELPDESK-CATALOGUE-DETAIL-02: explain the choice */}
          <p id="req-priority-help" className="hint" style={{ fontSize: "0.8125rem", color: "var(--mut)", marginTop: 4 }}>
            Priority affects how quickly your request is handled. Choose Critical only for an outage or urgent deadline.
          </p>
        </div>

        {priority === "Critical" ? (
          <div className="field" style={{ gridColumn: "1 / -1", padding: "10px 12px" }}>
            <label className="label" htmlFor="req-critical-reason">
              Why is this critical? <span aria-hidden="true">*</span>
            </label>
            <textarea id="req-critical-reason" className="inp" rows={2} disabled={isSubmitting}
              value={criticalReason} onChange={(e) => setCriticalReason(e.target.value)} />
          </div>
        ) : null}
      </div>

      <div role="status" aria-live="polite">
        {message ? (
          <p role={status === "error" ? "alert" : undefined}
            className={status === "error" ? "msg err" : "msg ok"}
            style={{ marginTop: 12, color: status === "error" ? "var(--bad)" : "var(--good)", fontSize: "0.875rem" }}>
            {message}
          </p>
        ) : null}
      </div>

      <div style={{ marginTop: 16 }}>
        <button type="submit" className="btn primary" style={{ minHeight: 44 }} disabled={isSubmitting} aria-busy={isSubmitting}>
          {isSubmitting ? "Submitting…" : "Submit request"}
        </button>
      </div>
    </form>
  );
}
