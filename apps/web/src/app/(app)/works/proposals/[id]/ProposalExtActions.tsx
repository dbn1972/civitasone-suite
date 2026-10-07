"use client";

import { UserFacingError } from "@/lib/userFacingError";
import { useState } from "react";
import Link from "next/link";
import { useToast } from "@/app/_components/ds/Toast";
import { PROPOSAL_WRITE_ROLES } from "@/lib/auth/workRoles";
import { formatMoney } from "@/lib/formatters";
import { ConfirmDialog, useConfirmAction, Button } from "@/app/_components/ds";
import { useFormError } from "@/lib/useFormError";


interface ProposalExtActionsProps {
  workId: string;
  roles: string[];
  workNumber?: string;
  estimatedCostMinor?: string;
}

/** Canonical UUID shape, matching the works-service zod `.uuid()` guards. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const cardStyle: React.CSSProperties = {
  border: "1px solid var(--line)",
  borderRadius: 12,
  overflow: "hidden",
  marginBottom: 12,
};

const headingBtnStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  padding: "14px 16px",
  background: "transparent",
  border: "none",
  cursor: "pointer",
  fontWeight: 600,
  fontSize: 14,
  width: "100%",
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: 8,
  minHeight: 44,
  borderRadius: 8,
  border: "1px solid var(--line)",
  boxSizing: "border-box",
};

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: 12,
  color: "var(--muted)",
  marginBottom: 4,
  fontWeight: 600,
};

const formPad: React.CSSProperties = {
  padding: "16px",
  borderTop: "1px solid var(--line)",
};

const fieldGroup: React.CSSProperties = {
  marginBottom: 14,
};

const gridStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
  gap: 12,
  marginBottom: 14,
};

function SubmitBtn({ busy, label }: { busy: boolean; label: string }) {
  return (
    <Button
      type="submit"
      variant="primary"
      disabled={busy}
      style={{ padding: "10px 20px", fontSize: 13 }}
    >
      {busy ? "Submitting…" : label}
    </Button>
  );
}

// ── Split Proposal ────────────────────────────────────────────────────────────

function SplitProposalForm({
  workId,
  parentLabel,
  onClose,
}: {
  workId: string;
  parentLabel: string;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const [description, setDescription] = useState("");
  const [splitResult, setSplitResult] = useState<{
    id: string;
    workNumber?: string;
  } | null>(null);
  const formError = useFormError("proposal split");

  // Splitting is irreversible — it creates a new, permanent child work record —
  // so the POST is gated behind an accessible ConfirmDialog (maker-checker).
  const { open, busy, error, trigger, cancel, confirm } = useConfirmAction({
    onConfirm: async () => {
      formError.clear();
      const res = await fetch("/api/proxy/v1/works/proposals/split", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ parentWorkId: workId, description }),
      });
      if (!res.ok) {
        const resolved = await formError.fromResponse(res, "save");
        throw UserFacingError.from(resolved);
      }

      // Capture child work info from response envelope (best-effort)
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      const inner = (data?.data ?? data) as Record<string, unknown>;
      const childId =
        (inner?.id as string | undefined) ??
        (data?.childWorkId as string | undefined) ??
        null;
      const childNo =
        (inner?.workNumber as string | undefined) ??
        (data?.workNumber as string | undefined) ??
        undefined;

      if (childId) {
        setSplitResult({ id: childId, workNumber: childNo });
      }
      toast.success("Split initiated.");
    },
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    trigger();
  }

  // Success state — show child work link
  if (splitResult) {
    return (
      <div style={formPad}>
        <div
          style={{
            background: "#ecfdf3",
            borderRadius: 10,
            padding: "14px 16px",
            marginBottom: 12,
          }}
        >
          <p style={{ fontWeight: 600, fontSize: 14, marginBottom: 6, color: "#166534" }}>
            ✅ Split created
          </p>
          <p style={{ fontSize: 13, color: "#166534", marginBottom: 10 }}>
            Child work{splitResult.workNumber ? ` ${splitResult.workNumber}` : ""} is
            now active. The new work ID is{" "}
            <code style={{ fontSize: 12 }}>{splitResult.id.slice(0, 8)}…</code>
          </p>
          <div style={{ display: "flex", gap: 10 }}>
            <Link
              href={`/works/proposals/${splitResult.id}`}
              className="btn primary"
              style={{ fontSize: 13, padding: "6px 14px" }}
            >
              View child work →
            </Link>
            <Button
              variant="ghost"
              onClick={onClose}
              style={{ padding: "6px 14px", fontSize: 13 }}
            >
              Close
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={formPad}>
      <form onSubmit={handleSubmit}>
        <div style={fieldGroup}>
          {/* Not a <label>: read-only display text, not a form control. */}
          <p style={labelStyle}>Parent Work</p>
          <div
            style={{
              fontSize: 13,
              color: "var(--ink)",
              padding: "8px 10px",
              background: "#f5f5f5",
              borderRadius: 8,
            }}
          >
            {parentLabel}
          </div>
        </div>
        <div style={fieldGroup}>
          <label htmlFor="proposal-split-description" style={labelStyle}>
            Description <span style={{ color: "#b42318" }}>*</span>
          </label>
          <textarea
            id="proposal-split-description"
            required
            maxLength={2048}
            placeholder="Describe the sub-work scope"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={4}
            style={{ ...inputStyle, minHeight: 96, resize: "vertical" }}
          />
          {formError.fieldError("description") && (
            <span style={{ fontSize: 12, color: "var(--bad)" }}>{formError.fieldError("description")}</span>
          )}
        </div>
        <SubmitBtn busy={busy} label="Split Proposal" />
      </form>
      <ConfirmDialog
        open={open}
        title="Split this proposal?"
        description="This requests a new permanent child work record with the description you entered. No amount is apportioned here — it cannot be undone."
        confirmLabel="Confirm Split"
        danger
        busy={busy}
        errorMessage={error}
        onConfirm={() => confirm()}
        onCancel={cancel}
      />
    </div>
  );
}

// ── Map COA ───────────────────────────────────────────────────────────────────

function MapCOAForm({
  workId,
  onClose,
}: {
  workId: string;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const [majorHead, setMajorHead] = useState("");
  const [subMajorHead, setSubMajorHead] = useState("");
  const [minorHead, setMinorHead] = useState("");
  const [subHead, setSubHead] = useState("");
  const [detailHead, setDetailHead] = useState("");
  const [objectHead, setObjectHead] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  const formError = useFormError("chart-of-accounts mapping");

  // COA mapping is append-only — the API has no update/delete for it, so a
  // wrong mapping becomes permanent history. Gate it behind ConfirmDialog.
  const { open, busy, error, trigger, cancel, confirm } = useConfirmAction({
    onConfirm: async () => {
      formError.clear();
      const payload: Record<string, string> = { workId, majorHead };
      if (subMajorHead) payload.subMajorHead = subMajorHead;
      if (minorHead)    payload.minorHead    = minorHead;
      if (subHead)      payload.subHead      = subHead;
      if (detailHead)   payload.detailHead   = detailHead;
      if (objectHead)   payload.objectHead   = objectHead;

      const res = await fetch("/api/proxy/v1/works/proposals/coa", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const resolved = await formError.fromResponse(res, "save");
        throw UserFacingError.from(resolved);
      }
      toast.success("COA mapped.");
    },
    onSuccess: onClose,
  });

  // GAP-WORKS-PROPOSALS-DETAIL-04: account heads are append-only; a typo is
  // permanent. Validate the digit-only head format client-side (each head is a
  // short numeric code) before showing the permanent-record confirmation.
  const HEAD_RE = /^\d{1,16}$/;
  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLocalError(null);
    if (!HEAD_RE.test(majorHead.trim())) {
      setLocalError("Major Head must be a numeric code (digits only).");
      return;
    }
    const optional: Array<[string, string]> = [
      ["Sub-Major Head", subMajorHead],
      ["Minor Head", minorHead],
      ["Sub Head", subHead],
      ["Detail Head", detailHead],
      ["Object Head", objectHead],
    ];
    for (const [label, val] of optional) {
      if (val.trim() && !HEAD_RE.test(val.trim())) {
        setLocalError(`${label} must be a numeric code (digits only).`);
        return;
      }
    }
    trigger();
  }

  const optionalInput = (
    label: string,
    field: string,
    value: string,
    onChange: (v: string) => void,
    placeholder: string,
  ) => (
    <div>
      <label htmlFor={`coa-${field}`} style={labelStyle}>{label}</label>
      <input
        id={`coa-${field}`}
        type="text"
        maxLength={16}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{ ...inputStyle, minHeight: "auto" }}
      />
      {formError.fieldError(field) && (
        <span style={{ fontSize: 12, color: "var(--bad)" }}>{formError.fieldError(field)}</span>
      )}
    </div>
  );

  return (
    <div style={formPad}>
      <form onSubmit={handleSubmit}>
        <div style={fieldGroup}>
          <label htmlFor="coa-majorHead" style={labelStyle}>
            Major Head <span style={{ color: "#b42318" }}>*</span>
          </label>
          <input
            id="coa-majorHead"
            type="text"
            required
            maxLength={16}
            placeholder="e.g. 4059"
            value={majorHead}
            onChange={(e) => setMajorHead(e.target.value)}
            style={{ ...inputStyle, minHeight: "auto" }}
          />
          {formError.fieldError("majorHead") && (
            <span style={{ fontSize: 12, color: "var(--bad)" }}>{formError.fieldError("majorHead")}</span>
          )}
        </div>
        <div style={gridStyle}>
          {optionalInput("Sub-Major Head", "subMajorHead", subMajorHead, setSubMajorHead, "e.g. 01")}
          {optionalInput("Minor Head",     "minorHead",    minorHead,    setMinorHead,    "e.g. 800")}
          {optionalInput("Sub Head",       "subHead",      subHead,      setSubHead,      "e.g. 01")}
          {optionalInput("Detail Head",    "detailHead",   detailHead,   setDetailHead,   "e.g. 01")}
          {optionalInput("Object Head",    "objectHead",   objectHead,   setObjectHead,   "e.g. 26")}
        </div>
        <SubmitBtn busy={busy} label="Map COA" />
      </form>
      {localError ? (
        <p role="alert" style={{ fontSize: 12, color: "var(--bad, #b42318)", marginTop: 8 }}>
          {localError}
        </p>
      ) : null}
      <ConfirmDialog
        open={open}
        title="Map this chart of accounts?"
        description={
          `This records a PERMANENT chart-of-accounts mapping for this work — it cannot be edited or removed once submitted.\n\n` +
          `Major Head: ${majorHead}` +
          (subMajorHead ? `\nSub-Major Head: ${subMajorHead}` : "") +
          (minorHead ? `\nMinor Head: ${minorHead}` : "") +
          (subHead ? `\nSub Head: ${subHead}` : "") +
          (detailHead ? `\nDetail Head: ${detailHead}` : "") +
          (objectHead ? `\nObject Head: ${objectHead}` : "")
        }
        confirmLabel="Confirm COA Mapping"
        danger
        busy={busy}
        errorMessage={error}
        onConfirm={() => confirm()}
        onCancel={cancel}
      />
    </div>
  );
}

// ── Map Office ────────────────────────────────────────────────────────────────

function MapOfficeForm({
  workId,
  onClose,
}: {
  workId: string;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const [divisionId, setDivisionId]     = useState("");
  const [subDivisionId, setSubDivisionId] = useState("");
  const [sectionId, setSectionId]       = useState("");
  const [isNodal, setIsNodal]           = useState(false);
  const [localError, setLocalError]     = useState<string | null>(null);
  const formError = useFormError("office mapping");

  // Office mapping is append-only — the API has no update/delete for it, so a
  // wrong mapping becomes permanent history. Gate it behind ConfirmDialog.
  const { open, busy, error, trigger, cancel, confirm } = useConfirmAction({
    onConfirm: async () => {
      formError.clear();
      const payload: Record<string, unknown> = { workId, divisionId, isNodal };
      if (subDivisionId) payload.subDivisionId = subDivisionId;
      if (sectionId)     payload.sectionId     = sectionId;

      const res = await fetch("/api/proxy/v1/works/proposals/office-mapping", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const resolved = await formError.fromResponse(res, "save");
        throw UserFacingError.from(resolved);
      }
      toast.success("Office mapped.");
    },
    onSuccess: onClose,
  });

  // GAP-WORKS-PROPOSALS-DETAIL-04: the works-service office-mapping route
  // requires divisionId/subDivisionId/sectionId to be UUIDs (mapOfficeSchema).
  // There is no office/division NAME master in works-service to drive an
  // EntityPicker (the org structure lives outside this service), so until one
  // exists we at least block a malformed, permanent mapping client-side with a
  // precise inline error instead of letting a typo'd id reach an append-only
  // record. See the per-GAP report's HUMAN REVIEW note.
  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLocalError(null);
    if (!UUID_RE.test(divisionId.trim())) {
      setLocalError("Division ID must be a valid UUID.");
      return;
    }
    if (subDivisionId.trim() && !UUID_RE.test(subDivisionId.trim())) {
      setLocalError("Sub-Division ID must be a valid UUID.");
      return;
    }
    if (sectionId.trim() && !UUID_RE.test(sectionId.trim())) {
      setLocalError("Section ID must be a valid UUID.");
      return;
    }
    trigger();
  }

  return (
    <div style={formPad}>
      <form onSubmit={handleSubmit}>
        <div style={fieldGroup}>
          <label htmlFor="office-map-division-id" style={labelStyle}>
            Division ID <span style={{ color: "#b42318" }}>*</span>
          </label>
          <input
            id="office-map-division-id"
            type="text"
            required
            placeholder="Division UUID"
            value={divisionId}
            onChange={(e) => setDivisionId(e.target.value)}
            style={{ ...inputStyle, minHeight: "auto" }}
          />
          {formError.fieldError("divisionId") && (
            <span style={{ fontSize: 12, color: "var(--bad)" }}>{formError.fieldError("divisionId")}</span>
          )}
        </div>
        <div style={fieldGroup}>
          <label htmlFor="office-map-sub-division-id" style={labelStyle}>Sub-Division ID</label>
          <input
            id="office-map-sub-division-id"
            type="text"
            placeholder="Sub-division UUID (optional)"
            value={subDivisionId}
            onChange={(e) => setSubDivisionId(e.target.value)}
            style={{ ...inputStyle, minHeight: "auto" }}
          />
          {formError.fieldError("subDivisionId") && (
            <span style={{ fontSize: 12, color: "var(--bad)" }}>{formError.fieldError("subDivisionId")}</span>
          )}
        </div>
        <div style={fieldGroup}>
          <label htmlFor="office-map-section-id" style={labelStyle}>Section ID</label>
          <input
            id="office-map-section-id"
            type="text"
            placeholder="Section UUID (optional)"
            value={sectionId}
            onChange={(e) => setSectionId(e.target.value)}
            style={{ ...inputStyle, minHeight: "auto" }}
          />
          {formError.fieldError("sectionId") && (
            <span style={{ fontSize: 12, color: "var(--bad)" }}>{formError.fieldError("sectionId")}</span>
          )}
        </div>
        <div style={{ ...fieldGroup, display: "flex", alignItems: "center", gap: 8 }}>
          <input
            type="checkbox"
            id="isNodal"
            checked={isNodal}
            onChange={(e) => setIsNodal(e.target.checked)}
            style={{ width: 16, height: 16, cursor: "pointer" }}
          />
          <label htmlFor="isNodal" style={{ ...labelStyle, marginBottom: 0, cursor: "pointer" }}>
            Mark as nodal division
          </label>
        </div>
        <SubmitBtn busy={busy} label="Map Office" />
      </form>
      {localError ? (
        <p role="alert" style={{ fontSize: 12, color: "var(--bad, #b42318)", marginTop: 8 }}>
          {localError}
        </p>
      ) : null}
      <ConfirmDialog
        open={open}
        title="Map this office / division?"
        description={
          `This records a PERMANENT office mapping for this work — it cannot be edited or removed once submitted.\n\n` +
          `Division: ${divisionId}` +
          (subDivisionId ? `\nSub-Division: ${subDivisionId}` : "") +
          (sectionId ? `\nSection: ${sectionId}` : "") +
          `\nNodal: ${isNodal ? "Yes" : "No"}`
        }
        confirmLabel="Confirm Office Mapping"
        danger
        busy={busy}
        errorMessage={error}
        onConfirm={() => confirm()}
        onCancel={cancel}
      />
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

export function ProposalExtActions({ workId, roles, workNumber, estimatedCostMinor }: ProposalExtActionsProps) {
  const [openSection, setOpenSection] = useState<string | null>(null);

  if (!roles.some((r) => (PROPOSAL_WRITE_ROLES as readonly string[]).includes(r))) return null;

  function toggle(section: string) {
    setOpenSection((prev) => (prev === section ? null : section));
  }

  // GAP-WORKS-PROPOSALS-DETAIL-05: show the parent as its work number + cost
  // (e.g. "WO-123 · ₹5,00,000.00") rather than a truncated raw UUID.
  const costLabel = estimatedCostMinor ? formatMoney(estimatedCostMinor) : null;
  const parentLabel =
    (workNumber && workNumber.trim())
      ? `${workNumber}${costLabel && costLabel !== "—" ? ` · ${costLabel}` : ""}`
      : `${workId.slice(0, 8)}…`;

  const sections = [
    { id: "split",  label: "Split Proposal" },
    { id: "coa",    label: "Map COA" },
    { id: "office", label: "Map Office" },
  ];

  return (
    <div style={{ marginTop: 16 }}>
      {sections.map(({ id, label }) => (
        <div key={id} style={cardStyle}>
          <button
            type="button"
            onClick={() => toggle(id)}
            style={headingBtnStyle}
            aria-expanded={openSection === id}
          >
            <span>{label}</span>
            <span style={{ fontSize: 12 }}>{openSection === id ? "▾" : "▸"}</span>
          </button>

          {openSection === id && id === "split" && (
            <SplitProposalForm workId={workId} parentLabel={parentLabel} onClose={() => setOpenSection(null)} />
          )}
          {openSection === id && id === "coa" && (
            <MapCOAForm workId={workId} onClose={() => setOpenSection(null)} />
          )}
          {openSection === id && id === "office" && (
            <MapOfficeForm workId={workId} onClose={() => setOpenSection(null)} />
          )}
        </div>
      ))}
    </div>
  );
}
