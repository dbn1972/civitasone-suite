"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

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
  const [values, setValues] = useState<Record<string, string | boolean>>({});
  const [priority, setPriority] = useState<Priority>((["Low", "Medium", "High", "Critical"].includes(defaultPriority) ? defaultPriority : "Medium") as Priority);
  const [status, setStatus] = useState<"idle" | "submitting" | "error">("idle");
  const [message, setMessage] = useState("");

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
    setStatus("submitting");
    setMessage("");

    const formData: Record<string, unknown> = {};
    for (const f of schema) {
      const v = values[f.key];
      if (v === undefined || v === "") continue;
      formData[f.key] = f.type === "number" ? Number(v) : v;
    }

    try {
      const res = await fetch(`/api/proxy/v1/helpdesk/catalogue/offerings/${offeringId}/requests`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ formData, priority }),
      });
      const text = await res.text();
      if (!res.ok) {
        setStatus("error");
        setMessage(text || `Request failed (${res.status})`);
        return;
      }
      router.push("/helpdesk/catalogue/my-requests");
      router.refresh();
    } catch (err) {
      setStatus("error");
      setMessage(err instanceof Error ? err.message : "Network error");
    }
  }

  const isSubmitting = status === "submitting";

  return (
    <form onSubmit={(e) => void handleSubmit(e)} noValidate aria-busy={isSubmitting}>
      <div className="fields">
        {schema.map((f) => (
          <div className="field" key={f.key} style={{ gridColumn: "1 / -1", background: "#fff", padding: "10px 12px" }}>
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

        <div className="field" style={{ background: "#fff", padding: "10px 12px" }}>
          <label className="label" htmlFor="req-priority">Priority</label>
          <select id="req-priority" className="inp" value={priority} disabled={isSubmitting}
            onChange={(e) => setPriority(e.target.value as Priority)}>
            <option value="Low">Low</option>
            <option value="Medium">Medium</option>
            <option value="High">High</option>
            <option value="Critical">Critical</option>
          </select>
        </div>
      </div>

      <div role="status" aria-live="polite">
        {message ? (
          <p role={status === "error" ? "alert" : undefined}
            style={{ marginTop: 12, color: status === "error" ? "#b91c1c" : "#047857", fontSize: "0.875rem" }}>
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
