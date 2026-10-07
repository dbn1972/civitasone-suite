"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { paiseToRupeeString, rupeeStringToPaise } from "@/lib/formatters";
import { PROPOSAL_WRITE_ROLES } from "@/lib/auth/workRoles";
import { useFormError } from "@/lib/useFormError";
import { Button } from "@/app/_components/ds";

interface ProposalData {
  id: string;
  status: string;
  description: string;
  estimatedCostMinor: string | number | bigint | null | undefined;
  district?: string | null;
  taluka?: string | null;
  village?: string | null;
  remarks?: string | null;
}

interface ProposalEditToggleProps {
  proposal: ProposalData;
  roles: string[];
}

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
    roles.some((r) => (PROPOSAL_WRITE_ROLES as readonly string[]).includes(r)) && proposal.status === "draft";

  if (!canEdit) return null;

  return (
    <>
      <Button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls="proposal-edit-form"
        style={{ minHeight: 44 }}
      >
        ✏️ Edit
      </Button>
      {open && (
        <div id="proposal-edit-form" style={{ marginTop: 16, flexBasis: "100%", width: "100%" }}>
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

  // GAP-WORKS-PROPOSALS-DETAIL-03: money is bigint paise. The old prefill ran
  // the stored paise through Math.round(minor/100), so opening and saving a
  // proposal costed ₹86,50,000.50 ("865000050") rewrote it to ₹86,50,001 even
  // when the clerk never touched the field. Prefill the EXACT rupee string
  // ("8650000.50") so an unedited field diffs as unchanged, and a genuine
  // missing cost (UX-006) stays blank rather than a fabricated "0".
  const rupeesStr = paiseToRupeeString(proposal.estimatedCostMinor) ?? "";

  const [description, setDescription] = useState(proposal.description);
  const [costRupees, setCostRupees] = useState(rupeesStr);
  const [district, setDistrict] = useState(proposal.district ?? "");
  const [taluka, setTaluka] = useState(proposal.taluka ?? "");
  const [village, setVillage] = useState(proposal.village ?? "");
  const [remarks, setRemarks] = useState(proposal.remarks ?? "");

  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const formError = useFormError("proposal");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    formError.clear();

    const patch: Record<string, unknown> = {};
    if (description !== proposal.description) patch.description = description;

    // Only touch estimatedCostMinor when the clerk actually changed the field
    // from its exact prefill string. rupeeStringToPaise is BigInt-exact and
    // rejects >2 decimals / junk, so a valid edit converts losslessly and an
    // invalid one is surfaced inline rather than silently mis-rounded.
    if (costRupees.trim() !== rupeesStr) {
      const costMinor = rupeeStringToPaise(costRupees);
      if (costMinor === null) {
        setMsg({ text: "Enter a valid amount in rupees (up to two decimals).", ok: false });
        return;
      }
      if (costMinor !== String(proposal.estimatedCostMinor)) {
        patch.estimatedCostMinor = costMinor;
      }
    }

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
        const resolved = await formError.fromResponse(res, "save");
        setMsg({ text: resolved.message, ok: false });
        return;
      }
      setMsg({ text: "Proposal updated.", ok: true });
      setTimeout(() => {
        router.refresh();
        onClose();
      }, 800);
    } catch (caught) {
      setMsg({
        text: formError.fromException("save", caught).message,
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
          {formError.fieldError("description") && (
            <span style={{ fontSize: 12, color: "var(--bad)" }}>{formError.fieldError("description")}</span>
          )}
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
              step={0.01}
              value={costRupees}
              onChange={(e) => setCostRupees(e.target.value)}
              style={inputStyle}
            />
            {formError.fieldError("estimatedCostMinor") && (
              <span style={{ fontSize: 12, color: "var(--bad)" }}>{formError.fieldError("estimatedCostMinor")}</span>
            )}
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
            {formError.fieldError("district") && (
              <span style={{ fontSize: 12, color: "var(--bad)" }}>{formError.fieldError("district")}</span>
            )}
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
            {formError.fieldError("taluka") && (
              <span style={{ fontSize: 12, color: "var(--bad)" }}>{formError.fieldError("taluka")}</span>
            )}
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
            {formError.fieldError("village") && (
              <span style={{ fontSize: 12, color: "var(--bad)" }}>{formError.fieldError("village")}</span>
            )}
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
          {formError.fieldError("remarks") && (
            <span style={{ fontSize: 12, color: "var(--bad)" }}>{formError.fieldError("remarks")}</span>
          )}
        </div>

        <div style={{ display: "flex", gap: 10 }}>
          <Button
            type="submit"
            variant="primary"
            disabled={busy}
            style={{ minHeight: 44 }}
          >
            {busy ? "Saving…" : "Save Changes"}
          </Button>
          <Button
            variant="ghost"
            onClick={onClose}
            disabled={busy}
            style={{ minHeight: 44 }}
          >
            Cancel
          </Button>
        </div>
      </div>
    </form>
  );
}
