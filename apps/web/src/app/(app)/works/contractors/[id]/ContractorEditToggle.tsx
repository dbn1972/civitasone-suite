"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";

interface ContractorData {
  id: string;
  name: string;
  registrationNo?: string | null;
  pan?: string | null;
  gst?: string | null;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
}

interface ContractorEditToggleProps {
  contractor: ContractorData;
  roles: string[];
}

const WRITE_ROLES = ["works_admin", "works_operator", "super_admin", "dao", "do"];

const inputStyle: React.CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  padding: "10px 12px",
  fontSize: 14,
  border: "1px solid var(--line)",
  borderRadius: 10,
  background: "var(--surface, #fff)",
  color: "var(--ink)",
  minHeight: 44,
};
const labelStyle: React.CSSProperties = { fontSize: 13, fontWeight: 600, color: "var(--ink)" };
const fieldWrap: React.CSSProperties = { display: "grid", gap: 6 };

export function ContractorEditToggle({ contractor, roles }: ContractorEditToggleProps) {
  const [open, setOpen] = useState(false);
  const canEdit = roles.some((r) => WRITE_ROLES.includes(r));

  if (!canEdit) return null;

  return (
    <>
      <button
        type="button"
        className="btn"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls="contractor-edit-form"
        style={{ minHeight: 44 }}
      >
        ✏️ Edit
      </button>
      {open && (
        <div id="contractor-edit-form" style={{ marginTop: 16 }}>
          <ContractorEditForm contractor={contractor} onClose={() => setOpen(false)} />
        </div>
      )}
    </>
  );
}

function ContractorEditForm({
  contractor,
  onClose,
}: {
  contractor: ContractorData;
  onClose: () => void;
}) {
  const formId = useId();
  const router = useRouter();

  const [name, setName] = useState(contractor.name);
  const [registrationNo, setRegistrationNo] = useState(contractor.registrationNo ?? "");
  const [pan, setPan] = useState(contractor.pan ?? "");
  const [gst, setGst] = useState(contractor.gst ?? "");
  const [email, setEmail] = useState(contractor.email ?? "");
  const [phone, setPhone] = useState(contractor.phone ?? "");
  const [address, setAddress] = useState(contractor.address ?? "");

  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);

    // Bug fix (works-deep-verify, MEDIUM/L3): every optional field below used
    // to send `value || undefined` — so clearing a field to "" silently
    // became `undefined`, which JSON.stringify drops from the request body
    // entirely. The backend never saw the clear, never changed anything, yet
    // the form still showed "Contractor updated." — a false success. Send
    // the real (possibly empty) value instead and let the backend decide:
    // registrationNo/gst/phone/address (works-service contractor/validators.ts
    // updateContractorSchema, all plain z.string().max(N) with no minimum)
    // legitimately accept "" and will now actually clear; pan (.length(10))
    // and email (.email()) correctly reject "" with a real 400, which the
    // existing catch block below already surfaces honestly instead of lying
    // about success.
    const patch: Record<string, unknown> = {};
    if (name !== contractor.name) patch.name = name;
    if (registrationNo !== (contractor.registrationNo ?? "")) patch.registrationNo = registrationNo;
    if (pan !== (contractor.pan ?? "")) patch.pan = pan;
    if (gst !== (contractor.gst ?? "")) patch.gst = gst;
    if (email !== (contractor.email ?? "")) patch.email = email;
    if (phone !== (contractor.phone ?? "")) patch.phone = phone;
    if (address !== (contractor.address ?? "")) patch.address = address;

    if (Object.keys(patch).length === 0) {
      setMsg({ text: "No changes detected.", ok: false });
      return;
    }

    setBusy(true);
    try {
      const res = await fetch(`/api/proxy/v1/works/contractors/${contractor.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(
          (d as { message?: string }).message ?? `Update failed (${res.status})`,
        );
      }
      setMsg({ text: "Contractor updated.", ok: true });
      setTimeout(() => {
        router.refresh();
        onClose();
      }, 800);
    } catch (err) {
      setMsg({
        text: err instanceof Error ? err.message : "Network error.",
        ok: false,
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={(e) => {
        void handleSubmit(e);
      }}
      aria-labelledby={`${formId}-title`}
      noValidate
      className="card"
    >
      <div className="card-h">
        <h3 id={`${formId}-title`}>Edit Contractor</h3>
      </div>
      <div className="pad" style={{ display: "grid", gap: 16 }}>
        {msg && (
          <p
            role={msg.ok ? "status" : "alert"}
            style={{
              margin: 0,
              padding: "10px 14px",
              borderRadius: 8,
              fontSize: 14,
              background: msg.ok ? "#dcfce7" : "#fee2e2",
              border: `1px solid ${msg.ok ? "#86efac" : "#fca5a5"}`,
              color: msg.ok ? "#166534" : "#b91c1c",
            }}
          >
            {msg.ok ? "✅" : "⚠️"} {msg.text}
          </p>
        )}

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
            gap: 14,
          }}
        >
          <div style={{ ...fieldWrap, gridColumn: "1 / -1" }}>
            <label htmlFor={`${formId}-name`} style={labelStyle}>
              Name <span style={{ color: "#b42318" }}>*</span>
            </label>
            <input
              id={`${formId}-name`}
              type="text"
              maxLength={256}
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              style={inputStyle}
            />
          </div>

          <div style={fieldWrap}>
            <label htmlFor={`${formId}-regno`} style={labelStyle}>
              Registration No.
            </label>
            <input
              id={`${formId}-regno`}
              type="text"
              maxLength={64}
              value={registrationNo}
              onChange={(e) => setRegistrationNo(e.target.value)}
              style={inputStyle}
            />
          </div>
          <div style={fieldWrap}>
            <label htmlFor={`${formId}-pan`} style={labelStyle}>
              PAN
            </label>
            <input
              id={`${formId}-pan`}
              type="text"
              maxLength={10}
              value={pan}
              onChange={(e) => setPan(e.target.value.toUpperCase())}
              placeholder="AAAPZ1234C"
              style={inputStyle}
            />
          </div>
          <div style={fieldWrap}>
            <label htmlFor={`${formId}-gst`} style={labelStyle}>
              GST
            </label>
            <input
              id={`${formId}-gst`}
              type="text"
              maxLength={15}
              value={gst}
              onChange={(e) => setGst(e.target.value.toUpperCase())}
              style={inputStyle}
            />
          </div>
          <div style={fieldWrap}>
            <label htmlFor={`${formId}-email`} style={labelStyle}>
              Email
            </label>
            <input
              id={`${formId}-email`}
              type="email"
              maxLength={256}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              style={inputStyle}
            />
          </div>
          <div style={fieldWrap}>
            <label htmlFor={`${formId}-phone`} style={labelStyle}>
              Phone
            </label>
            <input
              id={`${formId}-phone`}
              type="tel"
              maxLength={20}
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              style={inputStyle}
            />
          </div>

          <div style={{ ...fieldWrap, gridColumn: "1 / -1" }}>
            <label htmlFor={`${formId}-address`} style={labelStyle}>
              Address
            </label>
            <textarea
              id={`${formId}-address`}
              maxLength={1024}
              rows={3}
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              style={{ ...inputStyle, minHeight: 88, resize: "vertical" }}
            />
          </div>
        </div>

        <div style={{ display: "flex", gap: 10 }}>
          <button
            type="submit"
            className="btn primary"
            disabled={busy}
            style={{ minHeight: 44 }}
          >
            {busy ? "Saving…" : "Save Changes"}
          </button>
          <button
            type="button"
            className="btn"
            onClick={onClose}
            disabled={busy}
            style={{ minHeight: 44 }}
          >
            Cancel
          </button>
        </div>
      </div>
    </form>
  );
}
