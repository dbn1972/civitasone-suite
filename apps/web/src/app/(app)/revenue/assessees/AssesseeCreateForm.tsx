"use client";

/** Create a new assessee (property/water-connection/trade holder). Fields match
 * the `assessee.assessees` schema (assesseeType/identifierNo/ownerName/address
 * are NOT NULL columns) via the schema-aligned `createAssesseeBody` validator. */
import { useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, ConfirmDialog } from "@/app/_components/ds";
import { browserJson } from "@/lib/api/browserClient";

const ASSESSEE_TYPES = [
  { value: "property", label: "Property" },
  { value: "water_connection", label: "Water Connection" },
  { value: "trade", label: "Trade" },
  { value: "other", label: "Other" },
] as const;

type FieldErrors = {
  assesseeType?: string;
  identifierNo?: string;
  ownerName?: string;
  address?: string;
  contactEmail?: string;
};

export function AssesseeCreateForm() {
  const router = useRouter();

  const [assesseeType, setAssesseeType] = useState<string>("");
  const [identifierNo, setIdentifierNo] = useState("");
  const [ownerName, setOwnerName] = useState("");
  const [address, setAddress] = useState("");
  const [wardNo, setWardNo] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [contactEmail, setContactEmail] = useState("");

  const [errors, setErrors] = useState<FieldErrors>({});
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [dialogError, setDialogError] = useState<string | undefined>();
  const [message, setMessage] = useState<string | null>(null);

  const typeId = useId();
  const identifierId = useId();
  const ownerId = useId();
  const addressId = useId();
  const emailId = useId();
  const typeErrId = useId();
  const identifierErrId = useId();
  const ownerErrId = useId();
  const addressErrId = useId();
  const emailErrId = useId();

  const typeRef = useRef<HTMLSelectElement>(null);
  const identifierRef = useRef<HTMLInputElement>(null);
  const ownerRef = useRef<HTMLInputElement>(null);
  const addressRef = useRef<HTMLInputElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);

  function validate(): boolean {
    const next: FieldErrors = {};
    if (!assesseeType) next.assesseeType = "Select an assessee type.";
    if (!identifierNo.trim()) next.identifierNo = "Identifier No. (property ID / connection no.) is required.";
    if (!ownerName.trim()) next.ownerName = "Owner / holder name is required.";
    if (!address.trim()) next.address = "Address is required.";
    if (contactEmail.trim() && !/^\S+@\S+\.\S+$/.test(contactEmail.trim())) {
      next.contactEmail = "Enter a valid email address.";
    }
    setErrors(next);
    if (next.assesseeType) { typeRef.current?.focus(); return false; }
    if (next.identifierNo) { identifierRef.current?.focus(); return false; }
    if (next.ownerName) { ownerRef.current?.focus(); return false; }
    if (next.address) { addressRef.current?.focus(); return false; }
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
          assesseeType,
          identifierNo: identifierNo.trim(),
          ownerName: ownerName.trim(),
          address: address.trim(),
          wardNo: wardNo.trim() || undefined,
          contactPhone: contactPhone.trim() || undefined,
          contactEmail: contactEmail.trim() || undefined,
        }),
      });
      setConfirmOpen(false);
      setMessage(`Assessee "${ownerName.trim()}" submitted for registration.`);
      setAssesseeType("");
      setIdentifierNo("");
      setOwnerName("");
      setAddress("");
      setWardNo("");
      setContactPhone("");
      setContactEmail("");
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
              <label htmlFor={typeId} style={{ fontSize: 13, fontWeight: 600 }}>
                Assessee Type <span aria-hidden="true" style={{ color: "var(--bad, #c0392b)" }}>*</span>
              </label>
              <select
                id={typeId}
                ref={typeRef}
                value={assesseeType}
                onChange={(e) => setAssesseeType(e.target.value)}
                aria-required="true"
                aria-invalid={!!errors.assesseeType || undefined}
                aria-describedby={errors.assesseeType ? typeErrId : undefined}
                style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
              >
                <option value="" disabled>Select a type…</option>
                {ASSESSEE_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
              {errors.assesseeType && <p id={typeErrId} role="alert" style={{ color: "var(--bad, #c0392b)", fontSize: 12, margin: 0 }}>{errors.assesseeType}</p>}
            </div>

            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor={identifierId} style={{ fontSize: 13, fontWeight: 600 }}>
                Identifier No. (Property ID / Connection No.) <span aria-hidden="true" style={{ color: "var(--bad, #c0392b)" }}>*</span>
              </label>
              <input
                id={identifierId}
                ref={identifierRef}
                value={identifierNo}
                onChange={(e) => setIdentifierNo(e.target.value)}
                maxLength={64}
                aria-required="true"
                aria-invalid={!!errors.identifierNo || undefined}
                aria-describedby={errors.identifierNo ? identifierErrId : undefined}
                style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
              />
              {errors.identifierNo && <p id={identifierErrId} role="alert" style={{ color: "var(--bad, #c0392b)", fontSize: 12, margin: 0 }}>{errors.identifierNo}</p>}
            </div>

            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor={ownerId} style={{ fontSize: 13, fontWeight: 600 }}>
                Owner / Holder Name <span aria-hidden="true" style={{ color: "var(--bad, #c0392b)" }}>*</span>
              </label>
              <input
                id={ownerId}
                ref={ownerRef}
                value={ownerName}
                onChange={(e) => setOwnerName(e.target.value)}
                maxLength={200}
                aria-required="true"
                aria-invalid={!!errors.ownerName || undefined}
                aria-describedby={errors.ownerName ? ownerErrId : undefined}
                style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
              />
              {errors.ownerName && <p id={ownerErrId} role="alert" style={{ color: "var(--bad, #c0392b)", fontSize: 12, margin: 0 }}>{errors.ownerName}</p>}
            </div>

            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor={addressId} style={{ fontSize: 13, fontWeight: 600 }}>
                Address <span aria-hidden="true" style={{ color: "var(--bad, #c0392b)" }}>*</span>
              </label>
              <input
                id={addressId}
                ref={addressRef}
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                maxLength={500}
                aria-required="true"
                aria-invalid={!!errors.address || undefined}
                aria-describedby={errors.address ? addressErrId : undefined}
                style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
              />
              {errors.address && <p id={addressErrId} role="alert" style={{ color: "var(--bad, #c0392b)", fontSize: 12, margin: 0 }}>{errors.address}</p>}
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
            Register <strong>{ownerName}</strong> ({identifierNo}) as a new assessee in the revenue register.
            Correct the ward and identifier now — misregistered assessees affect downstream assessments and
            demands.
          </>
        }
        onConfirm={() => void createAssessee()}
        onCancel={() => !busy && setConfirmOpen(false)}
      />
    </form>
  );
}
