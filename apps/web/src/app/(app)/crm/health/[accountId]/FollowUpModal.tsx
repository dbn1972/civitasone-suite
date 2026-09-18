"use client";

/**
 * FollowUpModal — Account Health detail quick action (S19.8).
 *
 * Opens a modal pre-filled with the account ID and a default service
 * request subject, then POSTs to /api/v1/crm/service-requests.
 * Redirects to the new SR on success.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useFormError } from "@/lib/useFormError";
import { Button } from "@/app/_components/ds";

const OVERLAY: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(0,0,0,0.45)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 9999,
};

const DIALOG: React.CSSProperties = {
  background: "var(--panel)",
  border: "1px solid var(--line)",
  borderRadius: "calc(var(--r) * 2)",
  padding: "28px 32px",
  width: "min(520px, 92vw)",
  maxHeight: "90vh",
  overflowY: "auto",
  boxShadow: "0 16px 48px rgba(0,0,0,0.18)",
};

const FIELD: React.CSSProperties = {
  padding: "8px 12px",
  border: "1px solid var(--line)",
  borderRadius: "var(--r)",
  background: "var(--bg)",
  color: "var(--ink)",
  fontSize: 14,
  width: "100%",
  boxSizing: "border-box",
};

const LABEL: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 4,
  fontSize: 14,
  color: "var(--ink)",
};

interface Props {
  accountId: string;
  onClose?: () => void;
}

export function FollowUpModal({ accountId, onClose }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const formError = useFormError("service request");

  function openModal() {
    formError.clear();
    setOpen(true);
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    formError.clear();

    const fd = new FormData(e.currentTarget);
    const body = {
      citizenName: fd.get("citizenName"),
      citizenPhone: (fd.get("citizenPhone") as string)?.trim() || undefined,
      serviceType: fd.get("serviceType"),
      subject: fd.get("subject"),
      description: (fd.get("description") as string)?.trim() || undefined,
      priority: fd.get("priority"),
      relatedAccountId: accountId,
    };

    try {
      const res = await fetch("/api/proxy/v1/crm/service-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        await formError.fromResponse(res, "save");
        setSaving(false);
        return;
      }
      const { data } = (await res.json()) as { data: { id: string } };
      setOpen(false);
      router.push(`/crm/service-requests/${data.id}`);
    } catch {
      formError.fromException("save");
      setSaving(false);
    }
  }

  return (
    <>
      <Button onClick={openModal}>
        Create Follow-up
      </Button>

      {open && (
        <div
          style={OVERLAY}
          role="presentation"
          onClick={(e) => { if (e.target === e.currentTarget && !saving) { setOpen(false); onClose?.(); } }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Create follow-up service request"
            style={DIALOG}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: 20,
              }}
            >
              <div>
                <h2 style={{ margin: 0, fontSize: 18, color: "var(--ink)" }}>
                  Create Follow-up
                </h2>
                <p
                  style={{
                    margin: "4px 0 0",
                    fontSize: 13,
                    color: "var(--mut)",
                  }}
                >
                  {"Account: "}
                  <code
                    style={{
                      fontSize: 12,
                      background: "var(--bg)",
                      padding: "1px 6px",
                      borderRadius: 4,
                    }}
                  >
                    {accountId}
                  </code>
                </p>
              </div>
              <button
                type="button"
                aria-label="Close dialog"
                onClick={() => setOpen(false)}
                style={{
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  fontSize: 22,
                  color: "var(--mut)",
                  lineHeight: 1,
                  padding: 4,
                }}
              >
                ✕
              </button>
            </div>

            {formError.message && (
              <div
                role="alert"
                style={{
                  marginBottom: 16,
                  padding: "10px 14px",
                  background:
                    "color-mix(in srgb, var(--bad) 10%, transparent)",
                  border: "1px solid var(--bad)",
                  borderRadius: "var(--r)",
                  color: "var(--bad)",
                  fontSize: 14,
                }}
              >
                {formError.message}
              </div>
            )}

            <form
              onSubmit={handleSubmit}
              style={{ display: "flex", flexDirection: "column", gap: 14 }}
            >
              <label style={LABEL}>
                <span>
                  Contact Name{" "}
                  <span aria-hidden="true" style={{ color: "var(--bad)" }}>
                    *
                  </span>
                </span>
                <input
                  name="citizenName"
                  required
                  maxLength={200}
                  placeholder="Citizen or account representative name"
                  style={FIELD}
                />
                {formError.fieldError("citizenName") && (
                  <span style={{ fontSize: 12, color: "var(--bad)" }}>{formError.fieldError("citizenName")}</span>
                )}
              </label>

              <label style={LABEL}>
                <span>Phone</span>
                <input
                  name="citizenPhone"
                  type="tel"
                  maxLength={32}
                  placeholder="e.g. 9876543210"
                  style={FIELD}
                />
              </label>

              <label style={LABEL}>
                <span>
                  Service Type{" "}
                  <span aria-hidden="true" style={{ color: "var(--bad)" }}>
                    *
                  </span>
                </span>
                <select name="serviceType" required style={FIELD}>
                  <option value="">Select service type...</option>
                  <option value="Account Health Follow-up">
                    Account Health Follow-up
                  </option>
                  <option value="Renewal Support">Renewal Support</option>
                  <option value="Escalation">Escalation</option>
                  <option value="New Water Connection">
                    New Water Connection
                  </option>
                  <option value="New Electricity Connection">
                    New Electricity Connection
                  </option>
                  <option value="Other">Other</option>
                </select>
                {formError.fieldError("serviceType") && (
                  <span style={{ fontSize: 12, color: "var(--bad)" }}>{formError.fieldError("serviceType")}</span>
                )}
              </label>

              <label style={LABEL}>
                <span>
                  Subject{" "}
                  <span aria-hidden="true" style={{ color: "var(--bad)" }}>
                    *
                  </span>
                </span>
                <input
                  name="subject"
                  required
                  maxLength={500}
                  defaultValue={`Account health follow-up — ${accountId}`}
                  style={FIELD}
                />
                {formError.fieldError("subject") && (
                  <span style={{ fontSize: 12, color: "var(--bad)" }}>{formError.fieldError("subject")}</span>
                )}
              </label>

              <label style={LABEL}>
                <span>Description</span>
                <textarea
                  name="description"
                  rows={3}
                  maxLength={5000}
                  placeholder="Additional context for the follow-up..."
                  style={{ ...FIELD, resize: "vertical" }}
                />
                {formError.fieldError("description") && (
                  <span style={{ fontSize: 12, color: "var(--bad)" }}>{formError.fieldError("description")}</span>
                )}
              </label>

              <label style={LABEL}>
                <span>Priority</span>
                <select name="priority" defaultValue="normal" style={FIELD}>
                  <option value="low">Low</option>
                  <option value="normal">Normal</option>
                  <option value="high">High</option>
                  <option value="urgent">Urgent</option>
                </select>
              </label>

              <div
                style={{
                  display: "flex",
                  gap: 10,
                  justifyContent: "flex-end",
                  marginTop: 4,
                }}
              >
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setOpen(false)}
                  disabled={saving}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={saving}
                  loading={saving}
                >
                  {saving ? "Creating..." : "Create Service Request"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
