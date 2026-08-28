"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useToast } from "@/app/_components/ds/Toast";

type Priority = "Low" | "Medium" | "High" | "Critical";

/**
 * Citizen-facing ticket intake — posts to citizen-service (POST
 * /v1/citizen/tickets), which is what /helpdesk/tickets (the list this form
 * links back to) also reads from. citizen-service's priority enum is
 * lowercase ("low"|"medium"|"high"|"critical"), unlike the Capitalized
 * helpdesk-service enum, so the value is lowercased before sending. Staff
 * ticket intake for the internal ops queue lives at helpdesk/internal/new
 * (NewInternalTicketForm.tsx), which correctly targets helpdesk-service.
 */
function toApiPriority(p: Priority): string {
  return p.toLowerCase();
}

export function NewTicketForm() {
  const router = useRouter();
  const { toast } = useToast();
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<Priority>("Medium");
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
      priority: toApiPriority(priority),
    };

    try {
      const res = await fetch("/api/proxy/v1/citizen/tickets", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const text = await res.text();
        let human = text || `Request failed (${res.status})`;
        try {
          const parsed = JSON.parse(text) as { message?: string };
          if (parsed.message) human = parsed.message;
        } catch {
          /* not JSON — fall back to the raw text above */
        }
        setStatus("error");
        setMessage(human);
        return;
      }
      toast.success("Ticket submitted successfully.");
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
            maxLength={200}
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
            maxLength={5000}
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
            onChange={(e) => setPriority(e.target.value as Priority)}
            style={{ minHeight: 44 }}
            disabled={isSubmitting}
          >
            <option value="Low">Low</option>
            <option value="Medium">Medium</option>
            <option value="High">High</option>
            <option value="Critical">Critical</option>
          </select>
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
