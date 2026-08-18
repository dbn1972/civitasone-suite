"use client";

import { useState } from "react";
import Link from "next/link";
import { useToast } from "@/app/_components/ds/Toast";
import { ConfirmDialog } from "@/app/_components/ds";

const PROPOSAL_WRITE_ROLES = [
  "works_admin",
  "works_operator",
  "super_admin",
  "dao",
  "do",
  "sdo",
  "section_officer",
];

interface ProposalExtActionsProps {
  workId: string;
  roles: string[];
}

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

const errBanner: React.CSSProperties = {
  background: "#fef2f2",
  color: "#b42318",
  padding: 12,
  borderRadius: 12,
  marginBottom: 16,
  fontSize: 13,
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
    <button
      type="submit"
      disabled={busy}
      style={{
        padding: "10px 20px",
        borderRadius: 8,
        background: "var(--accent)",
        color: "#fff",
        border: "none",
        cursor: busy ? "not-allowed" : "pointer",
        fontWeight: 600,
        fontSize: 13,
        opacity: busy ? 0.7 : 1,
      }}
    >
      {busy ? "Submitting…" : label}
    </button>
  );
}

// ── Split Proposal ────────────────────────────────────────────────────────────

function SplitProposalForm({
  workId,
  onClose,
}: {
  workId: string;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [splitResult, setSplitResult] = useState<{
    id: string;
    workNumber?: string;
  } | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/proxy/v1/works/proposals/split", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ parentWorkId: workId, description }),
      });
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) {
        throw new Error((data?.message as string) ?? `Request failed (${res.status})`);
      }

      // Capture child work info from response envelope (best-effort)
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
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setBusy(false);
    }
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
            <button
              type="button"
              onClick={onClose}
              style={{
                padding: "6px 14px",
                borderRadius: 8,
                border: "1px solid var(--line)",
                background: "transparent",
                cursor: "pointer",
                fontSize: 13,
              }}
            >
              Close
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={formPad}>
      {error && <div style={errBanner}>{error}</div>}
      <form onSubmit={handleSubmit}>
        <div style={fieldGroup}>
          <label style={labelStyle}>Parent Work</label>
          <div
            style={{
              fontSize: 13,
              color: "var(--ink)",
              padding: "8px 10px",
              background: "#f5f5f5",
              borderRadius: 8,
            }}
          >
            {workId.slice(0, 8)}…
          </div>
        </div>
        <div style={fieldGroup}>
          <label style={labelStyle}>
            Description <span style={{ color: "#b42318" }}>*</span>
          </label>
          <textarea
            required
            maxLength={2048}
            placeholder="Describe the sub-work scope"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={4}
            style={{ ...inputStyle, minHeight: 96, resize: "vertical" }}
          />
        </div>
        <SubmitBtn busy={busy} label="Split Proposal" />
      </form>
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
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
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { message?: string }).message ?? `Request failed (${res.status})`);
      }
      toast.success("COA mapped.");
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setBusy(false);
    }
  }

  const optionalInput = (
    label: string,
    value: string,
    onChange: (v: string) => void,
    placeholder: string,
  ) => (
    <div>
      <label style={labelStyle}>{label}</label>
      <input
        type="text"
        maxLength={16}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{ ...inputStyle, minHeight: "auto" }}
      />
    </div>
  );

  return (
    <div style={formPad}>
      {error && <div style={errBanner}>{error}</div>}
      <form onSubmit={handleSubmit}>
        <div style={fieldGroup}>
          <label style={labelStyle}>
            Major Head <span style={{ color: "#b42318" }}>*</span>
          </label>
          <input
            type="text"
            required
            maxLength={16}
            placeholder="e.g. 4059"
            value={majorHead}
            onChange={(e) => setMajorHead(e.target.value)}
            style={{ ...inputStyle, minHeight: "auto" }}
          />
        </div>
        <div style={gridStyle}>
          {optionalInput("Sub-Major Head", subMajorHead, setSubMajorHead, "e.g. 01")}
          {optionalInput("Minor Head",     minorHead,    setMinorHead,    "e.g. 800")}
          {optionalInput("Sub Head",       subHead,      setSubHead,      "e.g. 01")}
          {optionalInput("Detail Head",    detailHead,   setDetailHead,   "e.g. 01")}
          {optionalInput("Object Head",    objectHead,   setObjectHead,   "e.g. 26")}
        </div>
        <SubmitBtn busy={busy} label="Map COA" />
      </form>
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
  const [busy, setBusy]                 = useState(false);
  const [error, setError]               = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const payload: Record<string, unknown> = { workId, divisionId, isNodal };
      if (subDivisionId) payload.subDivisionId = subDivisionId;
      if (sectionId)     payload.sectionId     = sectionId;

      const res = await fetch("/api/proxy/v1/works/proposals/office-mapping", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { message?: string }).message ?? `Request failed (${res.status})`);
      }
      toast.success("Office mapped.");
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={formPad}>
      {error && <div style={errBanner}>{error}</div>}
      <form onSubmit={handleSubmit}>
        <div style={fieldGroup}>
          <label style={labelStyle}>
            Division ID <span style={{ color: "#b42318" }}>*</span>
          </label>
          <input
            type="text"
            required
            placeholder="Division UUID"
            value={divisionId}
            onChange={(e) => setDivisionId(e.target.value)}
            style={{ ...inputStyle, minHeight: "auto" }}
          />
        </div>
        <div style={fieldGroup}>
          <label style={labelStyle}>Sub-Division ID</label>
          <input
            type="text"
            placeholder="Sub-division UUID (optional)"
            value={subDivisionId}
            onChange={(e) => setSubDivisionId(e.target.value)}
            style={{ ...inputStyle, minHeight: "auto" }}
          />
        </div>
        <div style={fieldGroup}>
          <label style={labelStyle}>Section ID</label>
          <input
            type="text"
            placeholder="Section UUID (optional)"
            value={sectionId}
            onChange={(e) => setSectionId(e.target.value)}
            style={{ ...inputStyle, minHeight: "auto" }}
          />
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
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

export function ProposalExtActions({ workId, roles }: ProposalExtActionsProps) {
  const [openSection, setOpenSection] = useState<string | null>(null);

  if (!roles.some((r) => PROPOSAL_WRITE_ROLES.includes(r))) return null;

  function toggle(section: string) {
    setOpenSection((prev) => (prev === section ? null : section));
  }

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
            <SplitProposalForm workId={workId} onClose={() => setOpenSection(null)} />
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
