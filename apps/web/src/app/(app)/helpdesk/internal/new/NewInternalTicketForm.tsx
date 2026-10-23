"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { z } from "zod";
import { useToast } from "@/app/_components/ds/Toast";
import { useFormError } from "@/lib/useFormError";

type Priority = "Low" | "Medium" | "High" | "Critical";

// GAP-HELPDESK-INTERNAL-NEW-02: zod schema for the form — validates at the
// boundary before the fetch fires, maps errors to per-field messages so the
// user sees inline feedback and a screen reader hears the error in context.
const NewInternalTicketSchema = z.object({
  subject: z
    .string()
    .min(1, "Subject is required.")
    .max(200, "Subject must be 200 characters or fewer."),
  description: z
    .string()
    .min(1, "Description is required.")
    .max(5000, "Description must be 5,000 characters or fewer."),
  priority: z.enum(["Low", "Medium", "High", "Critical"]),
});

type FieldErrors = Partial<Record<"subject" | "description" | "priority", string>>;

/**
 * Staff-facing ticket intake for the internal ops queue — posts to
 * helpdesk-service (POST /v1/helpdesk/tickets), gated to
 * helpdesk_user/helpdesk_admin/super_admin (services/helpdesk-service
 * tickets/routes.ts HELPDESK_ROLES). Kept deliberately separate from the
 * citizen-facing NewTicketForm (helpdesk/tickets/new/NewTicketForm.tsx),
 * which posts to citizen-service instead — the two are different backends
 * with different role gates and a different priority casing contract
 * (Capitalized here vs lowercase there). A plain citizen role gets a 403
 * from this endpoint by design.
 */
export function NewInternalTicketForm() {
  const router = useRouter();
  const { toast } = useToast();
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<Priority>("Medium");
  const [status, setStatus] = useState<"idle" | "submitting" | "error">("idle");
  const [message, setMessage] = useState("");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const formError = useFormError("ticket");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFieldErrors({});
    setMessage("");

    // GAP-HELPDESK-INTERNAL-NEW-02: zod-validate before sending; surface each
    // error next to the field so the user does not have to guess which one failed.
    const parsed = NewInternalTicketSchema.safeParse({ subject, description, priority });
    if (!parsed.success) {
      const fe: FieldErrors = {};
      for (const issue of parsed.error.issues) {
        const k = issue.path[0] as keyof FieldErrors;
        if (k && !fe[k]) fe[k] = issue.message;
      }
      setFieldErrors(fe);
      setStatus("error");
      setMessage("Please correct the errors above.");
      return;
    }

    setStatus("submitting");

    const body: Record<string, string> = {
      subject: parsed.data.subject.trim(),
      description: parsed.data.description.trim(),
      priority: parsed.data.priority,
    };

    try {
      const res = await fetch("/api/proxy/v1/helpdesk/tickets", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        setStatus("error");
        setMessage((await formError.fromResponse(res, "save")).message);
        return;
      }
      // GAP-HELPDESK-INTERNAL-NEW-04: read the POST response for a ticket id/number
      // helpdesk-service answers 202 { id, status, correlationId, data: { id } }
      // (flat id, plus the nested envelope). The gapless ticketNo is allocated
      // asynchronously by the worker, so it is not in this response.
      const payload = (await res.json().catch(() => null)) as
        | { id?: unknown; data?: { id?: unknown; ticketNo?: unknown } }
        | null;
      const createdId =
        typeof payload?.data?.id === "string" ? payload.data.id : typeof payload?.id === "string" ? payload.id : null;
      const ticketRef =
        payload?.data?.ticketNo && typeof payload.data.ticketNo === "string"
          ? payload.data.ticketNo
          : createdId
            ? `INT-${createdId.slice(0, 8).toUpperCase()}`
            : null;

      toast.success(ticketRef ? `Ticket ${ticketRef} created.` : "Ticket created.");
      if (createdId) {
        router.push(`/helpdesk/internal/${encodeURIComponent(createdId)}`);
      } else {
        router.push("/helpdesk/internal");
      }
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
        {/* GAP-HELPDESK-INTERNAL-NEW-03: removed background: "var(--panel)" — let the DS
            .field class handle theming; replaced #b91c1c / #047857 message
            colours with CSS variables (var(--bad)/var(--good)). */}
        <div className="field" style={{ gridColumn: "1 / -1", padding: "13px 16px" }}>
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
            className="inp"
            rows={5}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            required
            maxLength={5000}
            placeholder="Describe the issue in detail…"
            disabled={isSubmitting}
            aria-invalid={!!fieldErrors.description || undefined}
            aria-describedby={fieldErrors.description ? "description-error" : undefined}
          />
          {fieldErrors.description && (
            <p id="description-error" role="alert" style={{ marginTop: 4, fontSize: "0.8rem", color: "var(--bad)" }}>
              {fieldErrors.description}
            </p>
          )}
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
          >
            <option value="Low">Low</option>
            <option value="Medium">Medium</option>
            <option value="High">High</option>
            <option value="Critical">Critical</option>
          </select>
          {fieldErrors.priority && (
            <p role="alert" style={{ marginTop: 4, fontSize: "0.8rem", color: "var(--bad)" }}>
              {fieldErrors.priority}
            </p>
          )}
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
          {isSubmitting ? "Submitting…" : "Create ticket"}
        </button>
        <Link href="/helpdesk/internal" className="btn ghost" style={{ minHeight: 44 }}>
          Cancel
        </Link>
      </div>
    </form>
  );
}
