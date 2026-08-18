"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";

interface ProposalData {
  id: string;
  status: string;
  description: string;
  estimatedCostMinor: string | number | bigint;
  district?: string | null;
  taluka?: string | null;
  village?: string | null;
  remarks?: string | null;
}

interface ProposalEditToggleProps {
  proposal: ProposalData;
  roles: string[];
}

const WRITE_ROLES = [
  "works_admin", "works_operator", "super_admin", "dao", "do", "sdo", "section_officer",
];

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

export function ProposalEditToggle({ proposal, roles }: ProposalEditToggleProps) {
  const [open, setOpen] = useState(false);
  const canEdit =
    roles.some((r) => WRITE_ROLES.includes(r)) && proposal.status === "draft";

  if (!canEdit) return null;

  return (
    <>
      <button
        type="button"
        className="btn"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls="proposal-edit-form"
        style={{ minHeight: 44 }}
      >
        ✏️ Edit
      </button>
      {open && (
        <div id="proposal-edit-form" style={{ marginTop: 16 }}>
          <ProposalEditForm proposal={proposal} onClose={() => setOpen(false)} />
        </div>
      )}
    </>
  );
}

function ProposalEditForm({
  proposal,
  onClose,
}: {
  proposal: ProposalData;
  onClose: () => void;
}) {
  const formId = useId();
  const router = useRouter();

  const rupeesStr = String(Math.round(Number(proposal.estimatedCostMinor) / 100));

  const [description, setDescription] = useState(proposal.description);
  const [costRupees, setCostRupees] = useState(rupeesStr);
  const [district, setDistrict] = useState(proposal.district ?? "");
  const [taluka, setTaluka] = useState(proposal.taluka ?? "");
  const [village, setVillage] = useState(proposal.village ?? "");
  const [remarks, setRemarks] = useState(proposal.remarks ?? "");

  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);

    const patch: Record<string, unknown> = {};
    if (description !== proposal.description) patch.description = description;

    const costMinor = Math.round(parseFloat(costRupees) * 100);
    if (!isNaN(costMinor) && String(costMinor) !== String(proposal.estimatedCostMinor))
      patch.estimatedCostMinor = costMinor;

    if (district !== (proposal.district ?? "")) patch.district = district || null;
    if (taluka !== (proposal.taluka ?? "")) patch.taluka = taluka || null;
    if (village !== (proposal.village ?? "")) patch.village = village || null;
    if (remarks !== (proposal.remarks ?? "")) patch.remarks = remarks || null;

    if (Object.keys(patch).length === 0) {
      setMsg({ text: "No changes detected.", ok: false });
      return;
    }

    setBusy(true);
    try {
      const res = await fetch(`/api/proxy/v1/works/proposals/${proposal.id}`, {
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
      setMsg({ text: "Proposal updated.", ok: true });
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
        <h3 id={`${formId}-title`}>Edit Proposal</h3>
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

        <div style={fieldWrap}>
          <label htmlFor={`${formId}-desc`} style={labelStyle}>
            Description <span style={{ color: "#b42318" }}>*</span>
          </label>
          <textarea
            id={`${formId}-desc`}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            maxLength={2048}
            required
            style={{ ...inputStyle, minHeight: 88, resize: "vertical" }}
          />
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
            gap: 14,
          }}
        >
          <div style={fieldWrap}>
            <label htmlFor={`${formId}-cost`} style={labelStyle}>
              Estimated Cost (₹)
            </label>
            <input
              id={`${formId}-cost`}
              type="number"
              min={0}
              step={1}
              value={costRupees}
              onChange={(e) => setCostRupees(e.target.value)}
              style={inputStyle}
            />
          </div>
          <div style={fieldWrap}>
            <label htmlFor={`${formId}-district`} style={labelStyle}>
              District
            </label>
            <input
              id={`${formId}-district`}
              type="text"
              maxLength={128}
              value={district}
              onChange={(e) => setDistrict(e.target.value)}
              style={inputStyle}
            />
          </div>
          <div style={fieldWrap}>
            <label htmlFor={`${formId}-taluka`} style={labelStyle}>
              Taluka
            </label>
            <input
              id={`${formId}-taluka`}
              type="text"
              maxLength={128}
              value={taluka}
              onChange={(e) => setTaluka(e.target.value)}
              style={inputStyle}
            />
          </div>
          <div style={fieldWrap}>
            <label htmlFor={`${formId}-village`} style={labelStyle}>
              Village
            </label>
            <input
              id={`${formId}-village`}
              type="text"
              maxLength={128}
              value={village}
              onChange={(e) => setVillage(e.target.value)}
              style={inputStyle}
            />
          </div>
        </div>

        <div style={fieldWrap}>
          <label htmlFor={`${formId}-remarks`} style={labelStyle}>
            Remarks
          </label>
          <textarea
            id={`${formId}-remarks`}
            value={remarks}
            onChange={(e) => setRemarks(e.target.value)}
            rows={2}
            maxLength={2048}
            style={{ ...inputStyle, minHeight: 66, resize: "vertical" }}
          />
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
