"use client";

/**
 * Create a new assessee (property/water-connection holder).
 *
 * NOTE (see PR "## BACKEND FOLLOW-UPS"): this form submits exactly the fields
 * accepted by revenue-service's `createAssesseeBody` zod validator
 * (name/contactPhone/contactEmail/propertyNo/wardNo/address). The assessee
 * consumer that actually persists the row expects a different, non-overlapping
 * shape (assesseeType/identifierNo/ownerName/address/wardNo/zoneNo/...), so a
 * 202 today does not guarantee the assessee row lands — flagged for backend.
 */
import { useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, ConfirmDialog } from "@/app/_components/ds";
import { browserJson } from "@/lib/api/browserClient";

type FieldErrors = { name?: string; contactEmail?: string };

export function AssesseeCreateForm() {
  const router = useRouter();

  const [name, setName] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [propertyNo, setPropertyNo] = useState("");
  const [wardNo, setWardNo] = useState("");
  const [address, setAddress] = useState("");

  const [errors, setErrors] = useState<FieldErrors>({});
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [dialogError, setDialogError] = useState<string | undefined>();
  const [message, setMessage] = useState<string | null>(null);

  const nameId = useId();
  const emailId = useId();
  const nameErrId = useId();
  const emailErrId = useId();
  const nameRef = useRef<HTMLInputElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);

  function validate(): boolean {
    const next: FieldErrors = {};
    if (!name.trim()) next.name = "Owner / holder name is required.";
    if (contactEmail.trim() && !/^\S+@\S+\.\S+$/.test(contactEmail.trim())) {
      next.contactEmail = "Enter a valid email address.";
    }
    setErrors(next);
    if (next.name) { nameRef.current?.focus(); return false; }
    if (next.contactEmail) { emailRef.current?.focus(); return false; }
    return Object.keys(next).length === 0;
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    if (!validate()) return;
    setDialogError(undefined);
    setConfirmOpen(true);
  }

  async function createAssessee() {
    setBusy(true);
    setDialogError(undefined);
    try {
      await browserJson<{ status: string }>("v1/revenue/assessees", {
        method: "POST",
        body: JSON.stringify({
          name: name.trim(),
          contactPhone: contactPhone.trim() || undefined,
          contactEmail: contactEmail.trim() || undefined,
          propertyNo: propertyNo.trim() || undefined,
          wardNo: wardNo.trim() || undefined,
          address: address.trim() || undefined,
        }),
      });
      setConfirmOpen(false);
      setMessage(`Assessee "${name.trim()}" submitted for registration.`);
      setName("");
      setContactPhone("");
      setContactEmail("");
      setPropertyNo("");
      setWardNo("");
      setAddress("");
      setErrors({});
      router.refresh();
    } catch (err) {
      setDialogError(err instanceof Error ? err.message : "Network error. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} style={{ marginBottom: 16 }}>
      <Card title="Register New Assessee" padding>
        <div style={{ display: "grid", gap: 14 }}>
          <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))" }}>
            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor={nameId} style={{ fontSize: 13, fontWeight: 600 }}>
                Owner / Holder Name <span aria-hidden="true" style={{ color: "var(--bad, #c0392b)" }}>*</span>
              </label>
              <input
                id={nameId}
                ref={nameRef}
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={200}
                aria-required="true"
                aria-invalid={!!errors.name || undefined}
                aria-describedby={errors.name ? nameErrId : undefined}
                style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
              />
              {errors.name && <p id={nameErrId} role="alert" style={{ color: "var(--bad, #c0392b)", fontSize: 12, margin: 0 }}>{errors.name}</p>}
            </div>

            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor={emailId} style={{ fontSize: 13, fontWeight: 600 }}>Contact Email</label>
              <input
                id={emailId}
                ref={emailRef}
                type="email"
                value={contactEmail}
                onChange={(e) => setContactEmail(e.target.value)}
                aria-invalid={!!errors.contactEmail || undefined}
                aria-describedby={errors.contactEmail ? emailErrId : undefined}
                style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
              />
              {errors.contactEmail && <p id={emailErrId} role="alert" style={{ color: "var(--bad, #c0392b)", fontSize: 12, margin: 0 }}>{errors.contactEmail}</p>}
            </div>

            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor="assessee-phone" style={{ fontSize: 13, fontWeight: 600 }}>Contact Phone</label>
              <input
                id="assessee-phone"
                value={contactPhone}
                onChange={(e) => setContactPhone(e.target.value)}
                maxLength={20}
                style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
              />
            </div>

            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor="assessee-property-no" style={{ fontSize: 13, fontWeight: 600 }}>Property / Connection No.</label>
              <input
                id="assessee-property-no"
                value={propertyNo}
                onChange={(e) => setPropertyNo(e.target.value)}
                maxLength={64}
                style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
              />
            </div>

            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor="assessee-ward" style={{ fontSize: 13, fontWeight: 600 }}>Ward No.</label>
              <input
                id="assessee-ward"
                value={wardNo}
                onChange={(e) => setWardNo(e.target.value)}
                maxLength={16}
                style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
              />
            </div>

            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor="assessee-address" style={{ fontSize: 13, fontWeight: 600 }}>Address</label>
              <input
                id="assessee-address"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                maxLength={500}
                style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
              />
            </div>
          </div>

          <div>
            <button type="submit" className="btn primary" style={{ minHeight: 44 }} disabled={busy}>
              Register Assessee
            </button>
          </div>

          {message && (
            <p role="status" className="pill good" style={{ width: "fit-content" }}>
              {message}
            </p>
          )}
        </div>
      </Card>

      <ConfirmDialog
        open={confirmOpen}
        title="Register this assessee?"
        confirmLabel="Register assessee"
        busy={busy}
        errorMessage={dialogError}
        description={
          <>
            Register <strong>{name}</strong> as a new assessee in the revenue register. Correct the ward and
            property/connection number now — misregistered assessees affect downstream assessments and demands.
          </>
        }
        onConfirm={() => void createAssessee()}
        onCancel={() => !busy && setConfirmOpen(false)}
      />
    </form>
  );
}
