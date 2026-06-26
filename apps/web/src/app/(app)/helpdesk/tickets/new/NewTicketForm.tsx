"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function NewTicketForm() {
  const router = useRouter();
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<"low" | "medium" | "high">("medium");
  const [category, setCategory] = useState("");
  const [status, setStatus] = useState<"idle" | "submitting" | "error">("idle");
  const [message, setMessage] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!subject.trim()) {
      setStatus("error");
      setMessage("Subject is required.");
      return;
    }
    if (!description.trim()) {
      setStatus("error");
      setMessage("Description is required.");
      return;
    }
    setStatus("submitting");
    setMessage("");

    const body: Record<string, string> = {
      subject: subject.trim(),
      description: description.trim(),
      priority,
    };
    if (category.trim()) {
      body.category = category.trim();
    }

    try {
      const res = await fetch("/api/proxy/v1/helpdesk/tickets", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const text = await res.text();
      if (!res.ok) {
        setStatus("error");
        setMessage(text || `Request failed (${res.status})`);
        return;
      }
      router.push("/helpdesk/tickets");
      router.refresh();
    } catch (err) {
      setStatus("error");
      setMessage(err instanceof Error ? err.message : "Network error");
    }
  }

  const isSubmitting = status === "submitting";

  return (
    <form
      onSubmit={(e) => void handleSubmit(e)}
      className="card pad"
      style={{ maxWidth: 820 }}
      noValidate
      aria-busy={isSubmitting}
    >
      <div className="fields">
        <div className="field" style={{ gridColumn: "1 / -1", background: "#fff", padding: "13px 16px" }}>
          <label className="label" htmlFor="subject">
            Subject <span aria-hidden="true">*</span>
          </label>
          <input
            id="subject"
            className="inp"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            required
            style={{ minHeight: 44 }}
            placeholder="Brief summary of the issue"
            disabled={isSubmitting}
          />
        </div>

        <div className="field" style={{ gridColumn: "1 / -1", background: "#fff", padding: "13px 16px" }}>
          <label className="label" htmlFor="description">
            Description <span aria-hidden="true">*</span>
          </label>
          <textarea
            id="description"
            className="inp"
            rows={5}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            required
            placeholder="Describe the issue in detail…"
            disabled={isSubmitting}
          />
        </div>

        <div className="field" style={{ background: "#fff", padding: "13px 16px" }}>
          <label className="label" htmlFor="priority">
            Priority
          </label>
          <select
            id="priority"
            className="inp"
            value={priority}
            onChange={(e) => setPriority(e.target.value as "low" | "medium" | "high")}
            style={{ minHeight: 44 }}
            disabled={isSubmitting}
          >
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
          </select>
        </div>

        <div className="field" style={{ background: "#fff", padding: "13px 16px" }}>
          <label className="label" htmlFor="category">
            Category
          </label>
          <input
            id="category"
            className="inp"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            style={{ minHeight: 44 }}
            placeholder="e.g. Infrastructure, IT Support"
            disabled={isSubmitting}
          />
        </div>
      </div>

      <div role="status" aria-live="polite">
        {message ? (
          <p
            role={status === "error" ? "alert" : undefined}
            style={{
              marginTop: 12,
              color: status === "error" ? "#b91c1c" : "#047857",
              fontSize: "0.875rem",
            }}
          >
            {message}
          </p>
        ) : null}
      </div>

      <div style={{ marginTop: 16, display: "flex", gap: 8 }}>
        <button
          type="submit"
          className="btn primary"
          style={{ minHeight: 44 }}
          disabled={isSubmitting}
          aria-busy={isSubmitting}
        >
          {isSubmitting ? "Submitting…" : "Submit ticket"}
        </button>
        <Link href="/helpdesk/tickets" className="btn ghost" style={{ minHeight: 44 }}>
          Cancel
        </Link>
      </div>
    </form>
  );
}
