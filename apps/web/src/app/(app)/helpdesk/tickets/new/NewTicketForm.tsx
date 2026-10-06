"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { useToast } from "@/app/_components/ds/Toast";
import { useFormError } from "@/lib/useFormError";

type Priority = "Low" | "Medium" | "High" | "Critical";
type Channel = "web" | "email" | "phone" | "walk_in";

/**
 * Citizen-facing ticket intake — posts to citizen-service (POST
 * /v1/citizen/tickets), which is what /helpdesk/tickets (the list this form
 * links back to) also reads from. citizen-service's priority enum is
 * lowercase ("low"|"medium"|"high"|"critical"), unlike the Capitalized
 * helpdesk-service enum, so the value is lowercased before sending. Staff
 * ticket intake for the internal ops queue lives at helpdesk/internal/new
 * (NewInternalTicketForm.tsx), which correctly targets helpdesk-service.
 *
 * GAP-HELPDESK-TICKETS-NEW-01: an agent logging a phone / walk-in complaint
 * on a citizen's behalf must be able to record the CHANNEL (which the ticket
 * list/detail then display, TicketDetail.channel) and the citizen's name.
 * citizen-service's createTicketBody (verified in
 * services/citizen-service/src/modules/helpdesk/validators.ts) already
 * accepts `channel` ("web"|"email"|"phone"|"walk_in"); it does NOT accept a
 * free-text requester name field, so the requester name is recorded in the
 * description preamble rather than invented as a body field the API rejects.
 * DECISION recorded in the batch report.
 */
function toApiPriority(p: Priority): string {
  return p.toLowerCase();
}

const CHANNEL_OPTIONS: Array<{ value: Channel; label: string }> = [
  { value: "web", label: "Web / self-service" },
  { value: "email", label: "Email" },
  { value: "phone", label: "Phone" },
  { value: "walk_in", label: "Walk-in" },
];

// GAP-HELPDESK-TICKETS-NEW-05: SLA target per priority, shown as helper copy so
// a filer understands the consequence of choosing Critical. These targets
// mirror citizen-service's getSlaRules() ("Critical/High" 4–8h, "General" 24h).
const PRIORITY_SLA_NOTE: Record<Priority, string> = {
  Low: "SLA target: within 24 hours.",
  Medium: "SLA target: within 24 hours.",
  High: "SLA target: within 4–8 hours.",
  Critical: "SLA target: within 4–8 hours — use only for urgent, high-impact issues.",
};

export function NewTicketForm() {
  const router = useRouter();
  const { toast } = useToast();
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<Priority>("Medium");
  const [channel, setChannel] = useState<Channel>("web");
  const [requesterName, setRequesterName] = useState("");
  const [status, setStatus] = useState<"idle" | "submitting" | "error">("idle");
  const [message, setMessage] = useState("");
  // GAP-HELPDESK-TICKETS-NEW-04: per-field validation errors for aria-invalid /
  // aria-describedby, not just a single summary line.
  const [fieldErrors, setFieldErrors] = useState<{ subject?: string; description?: string }>({});
  const formError = useFormError("ticket");
  const subjectRef = useRef<HTMLInputElement>(null);
  const descriptionRef = useRef<HTMLTextAreaElement>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const nextErrors: { subject?: string; description?: string } = {};
    if (!subject.trim()) nextErrors.subject = "Subject is required.";
    if (!description.trim()) nextErrors.description = "Description is required.";
    if (nextErrors.subject || nextErrors.description) {
      setFieldErrors(nextErrors);
      setStatus("error");
      setMessage(nextErrors.subject ?? nextErrors.description ?? "");
      // Move focus to the first invalid field.
      if (nextErrors.subject) subjectRef.current?.focus();
      else descriptionRef.current?.focus();
      return;
    }
    setFieldErrors({});
    setStatus("submitting");
    setMessage("");

    // Record the requester name in the description preamble when supplied —
    // citizen-service accepts no dedicated requester field (NEW-01 decision).
    const trimmedRequester = requesterName.trim();
    const finalDescription = trimmedRequester
      ? `Reported by: ${trimmedRequester}\n\n${description.trim()}`
      : description.trim();

    const body: Record<string, string> = {
      subject: subject.trim(),
      description: finalDescription,
      priority: toApiPriority(priority),
      channel,
    };

    try {
      const res = await fetch("/api/proxy/v1/citizen/tickets", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        setStatus("error");
        setMessage((await formError.fromResponse(res, "save")).message);
        return;
      }
      // GAP-HELPDESK-TICKETS-NEW-02: surface the created ticket number so the
      // filer has something to quote back to the citizen, and deep-link to the
      // new ticket when the API returns its id. Falls back to the list when the
      // response body carries no id (e.g. a bare 202 with no payload).
      const created = (await res.json().catch(() => null)) as
        | { id?: string; ticketNo?: string; data?: { id?: string; ticketNo?: string } }
        | null;
      const payload = created?.data ?? created ?? null;
      const ticketNo = payload?.ticketNo;
      const id = payload?.id;
      toast.success(ticketNo ? `Ticket ${ticketNo} submitted.` : "Ticket submitted successfully.");
      // Deep-link to the new ticket only when the backend returned a real
      // ticket number (a fully-created ticket); a bare id with no ticketNo
      // (e.g. a 202 Accepted with the command id only) falls back to the list.
      router.push(id && ticketNo ? `/helpdesk/tickets/${id}` : "/helpdesk/tickets");
      router.refresh();
    } catch (caught) {
      setStatus("error");
      setMessage(formError.fromException("save", caught).message);
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
        <div className="field" style={{ gridColumn: "1 / -1", padding: "13px 16px" }}>
          <label className="label" htmlFor="subject">
            Subject <span aria-hidden="true">*</span>
          </label>
          <input
            id="subject"
            ref={subjectRef}
            className="inp"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            required
            maxLength={200}
            style={{ minHeight: 44 }}
            placeholder="Brief summary of the issue"
            disabled={isSubmitting}
            aria-invalid={!!fieldErrors.subject || undefined}
            aria-describedby={fieldErrors.subject ? "subject-error" : undefined}
          />
          {fieldErrors.subject && (
            <p id="subject-error" role="alert" style={{ marginTop: 4, fontSize: "0.8rem", color: "var(--bad)" }}>
              {fieldErrors.subject}
            </p>
          )}
        </div>

        <div className="field" style={{ gridColumn: "1 / -1", padding: "13px 16px" }}>
          <label className="label" htmlFor="description">
            Description <span aria-hidden="true">*</span>
          </label>
          <textarea
            id="description"
            ref={descriptionRef}
            className="inp"
            rows={5}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            required
            maxLength={5000}
            placeholder="Describe the issue in detail…"
            disabled={isSubmitting}
            aria-invalid={!!fieldErrors.description || undefined}
            aria-describedby={[fieldErrors.description ? "description-error" : null, "description-hint"].filter(Boolean).join(" ")}
          />
          {fieldErrors.description && (
            <p id="description-error" role="alert" style={{ marginTop: 4, fontSize: "0.8rem", color: "var(--bad)" }}>
              {fieldErrors.description}
            </p>
          )}
          <p id="description-hint" style={{ marginTop: 4, fontSize: "0.75rem", color: "var(--mut)" }}>
            Do not enter Aadhaar, PAN, passwords or bank details.
          </p>
        </div>

        <div className="field" style={{ padding: "13px 16px" }}>
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
            aria-describedby="priority-sla-note"
          >
            <option value="Low">Low</option>
            <option value="Medium">Medium</option>
            <option value="High">High</option>
            <option value="Critical">Critical</option>
          </select>
          <p id="priority-sla-note" style={{ marginTop: 4, fontSize: "0.8rem", color: "var(--mut)" }}>
            {PRIORITY_SLA_NOTE[priority]}
          </p>
        </div>

        {/* GAP-HELPDESK-TICKETS-NEW-01: Channel + Requester name fields */}
        <div className="field" style={{ padding: "13px 16px" }}>
          <label className="label" htmlFor="channel">
            Channel
          </label>
          <select
            id="channel"
            className="inp"
            value={channel}
            onChange={(e) => setChannel(e.target.value as Channel)}
            style={{ minHeight: 44 }}
            disabled={isSubmitting}
          >
            {CHANNEL_OPTIONS.map((ch) => (
              <option key={ch.value} value={ch.value}>{ch.label}</option>
            ))}
          </select>
        </div>

        <div className="field" style={{ gridColumn: "1 / -1", padding: "13px 16px" }}>
          <label className="label" htmlFor="requesterName">
            Citizen name <span style={{ fontWeight: 400, color: "var(--mut)" }}>(optional, for phone/walk-in)</span>
          </label>
          <input
            id="requesterName"
            className="inp"
            value={requesterName}
            onChange={(e) => setRequesterName(e.target.value)}
            maxLength={120}
            style={{ minHeight: 44 }}
            placeholder="Name of the citizen reporting this issue"
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
              color: status === "error" ? "var(--bad)" : "var(--good)",
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
