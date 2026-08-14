"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { ConfirmDialog } from "../../../_components/ds";
import { useToast } from "@/app/_components/ds/Toast";
import { trackActivation } from "@/lib/activation";

type Structure = { id: string; name: string };

type Props = {
  structures: Structure[];
  /** Pay periods that already have a run, used to guard against duplicates. */
  existingPeriods?: string[];
};

const MONTHS = [
  "January","February","March","April","May","June",
  "July","August","September","October","November","December",
];

export function CreatePayrollRunForm({ structures, existingPeriods = [] }: Props) {
  const router = useRouter();
  const { toast } = useToast();
  const now = new Date();
  const defaultYear = now.getFullYear();
  const defaultMonthIdx = now.getMonth() + 1; // 1-based
  const defaultMonth = `${defaultYear}-${String(defaultMonthIdx).padStart(2, "0")}`;

  const [selectedYear, setSelectedYear] = useState(defaultYear);
  const [selectedMonthIdx, setSelectedMonthIdx] = useState(defaultMonthIdx);
  const [structureId, setStructureId] = useState(structures[0]?.id ?? "");
  const [runNo, setRunNo] = useState(`RUN/${defaultMonth.replace("-", "/")}`);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [tone, setTone] = useState<"good" | "bad">("good");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<{runNo?: string; structureId?: string; month?: string}>({});
  const [dialogError, setDialogError] = useState<string | undefined>();

  const runNoId = useId();
  const structId = useId();
  const monthSelId = useId();
  const yearSelId = useId();
  const errId = useId();

  // Derive the YYYY-MM value from separate selects
  const month = `${selectedYear}-${String(selectedMonthIdx).padStart(2, "0")}`;

  function handleMonthYearChange(newYear: number, newMonthIdx: number) {
    const newMonth = `${newYear}-${String(newMonthIdx).padStart(2, "0")}`;
    setSelectedYear(newYear);
    setSelectedMonthIdx(newMonthIdx);
    setRunNo(`RUN/${newMonth.replace("-", "/")}`);
  }

  // A month like "2026-06" duplicates an existing period such as "Jun 2026" /
  // "2026-06" — compare on the year+month tokens to be format-agnostic.
  const periodDuplicate = existingPeriods.some((p) => {
    const norm = p.toLowerCase().replace(/\s+/g, "");
    return norm.includes(month) || norm.includes(month.replace("-", "/"));
  });

  const selectedStructure = structures.find((s) => s.id === structureId);

  // Years: current year ±3
  const years = Array.from({ length: 7 }, (_, i) => defaultYear - 3 + i);

  async function createRun() {
    setBusy(true);
    setDialogError(undefined);
    try {
      const res = await fetch("/api/proxy/v1/payroll/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ runNo, month, structureId }),
      });
      const text = await res.text();
      if (!res.ok) {
        let errMsg: string;
        try { const pErr = JSON.parse(text); errMsg = pErr.message || pErr.error || text; }
        catch { errMsg = text; }
        setDialogError(errMsg || `Create failed (${res.status})`);
        return;
      }
      const body = text ? (JSON.parse(text) as { id?: string }) : {};
      setConfirmOpen(false);
      trackActivation("first_transaction");
      toast.success(`Payroll run for ${MONTHS[selectedMonthIdx - 1]} ${selectedYear} created successfully.`);
      if (body.id) {
        router.push(`/hr/payroll/${body.id}`);
      } else {
        setTone("good");
        setMessage("Payroll run created.");
        router.refresh();
      }
    } catch (err) {
      setDialogError(err instanceof Error ? err.message : "Network error. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    const errors: {runNo?: string; structureId?: string; month?: string} = {};
    if (!runNo.trim()) errors.runNo = "Run number is required.";
    if (!structureId) errors.structureId = "Pay structure is required.";
    if (!month) errors.month = "Month is required.";
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) {
      setTone("bad");
      setMessage("Please complete all fields before creating a run.");
      return;
    }
    setFieldErrors({});
    setDialogError(undefined);
    setConfirmOpen(true);
  }

  if (structures.length === 0) return null;

  const selStyle: React.CSSProperties = {
    padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)",
    minHeight: 44, background: "var(--panel)", color: "var(--ink)", fontSize: 13.5, width: "100%",
  };
  const labelStyle: React.CSSProperties = { fontSize: 13, fontWeight: 600, color: "var(--ink2)" };

  return (
    <form onSubmit={handleSubmit} className="card" style={{ marginBottom: 16 }}>
      <div className="card-h">
        <h3>Create Payroll Run</h3>
      </div>
      <div className="pad" style={{ display: "grid", gap: 14 }}>
        <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))" }}>
          {/* Month select */}
          <div style={{ display: "grid", gap: 6 }}>
            <label htmlFor={monthSelId} style={labelStyle}>Month</label>
            <select
              id={monthSelId}
              value={selectedMonthIdx}
              onChange={(e) => handleMonthYearChange(selectedYear, Number(e.target.value))}
              aria-describedby={periodDuplicate ? errId : undefined}
              aria-invalid={periodDuplicate}
              style={selStyle}
            >
              {MONTHS.map((name, i) => (
                <option key={i + 1} value={i + 1}>{name}</option>
              ))}
            </select>
          </div>
          {/* Year select */}
          <div style={{ display: "grid", gap: 6 }}>
            <label htmlFor={yearSelId} style={labelStyle}>Year</label>
            <select
              id={yearSelId}
              value={selectedYear}
              onChange={(e) => handleMonthYearChange(Number(e.target.value), selectedMonthIdx)}
              style={selStyle}
            >
              {years.map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          </div>
          {/* Run No */}
          <div style={{ display: "grid", gap: 6 }}>
            <label htmlFor={runNoId} style={labelStyle}>Run No.</label>
            <input
              id={runNoId}
              value={runNo}
              onChange={(e) => setRunNo(e.target.value)}
              style={{ ...selStyle }}
            />
            {fieldErrors.runNo && <span style={{ fontSize: 12, color: "var(--bad)" }}>{fieldErrors.runNo}</span>}
          </div>
          {/* Pay structure */}
          <div style={{ display: "grid", gap: 6 }}>
            <label htmlFor={structId} style={labelStyle}>Pay Structure</label>
            <select
              id={structId}
              value={structureId}
              onChange={(e) => setStructureId(e.target.value)}
              style={selStyle}
            >
              {structures.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
            {fieldErrors.structureId && <span style={{ fontSize: 12, color: "var(--bad)" }}>{fieldErrors.structureId}</span>}
          </div>
        </div>

        {periodDuplicate && (
          <p id={errId} role="alert" className="pill warn" style={{ width: "fit-content" }}>
            A run already exists for {MONTHS[selectedMonthIdx - 1]} {selectedYear}. Creating another may double-pay employees.
          </p>
        )}

        <div>
          <button type="submit" className="btn primary" style={{ minHeight: 44 }} disabled={busy || periodDuplicate}>
            Create Run
          </button>
        </div>

        {message && (
          <p role="status" aria-live="polite" className={`pill ${tone}`} style={{ width: "fit-content" }}>
            {message}
          </p>
        )}

        <p style={{ fontSize: 12, color: "var(--ink2)" }}>
          After creation, open the run to approve and disburse.{" "}
          <Link href="/hr/leave/approvals" style={{ color: "var(--primary-d)", textDecoration: "underline" }}>
            Leave approvals
          </Link>
        </p>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        title="Create this payroll run?"
        danger={periodDuplicate}
        confirmLabel="Create run"
        busy={busy}
        errorMessage={dialogError}
        description={
          <>
            Create run <strong>{runNo}</strong> for{" "}
            <strong>{MONTHS[selectedMonthIdx - 1]} {selectedYear}</strong> using the{" "}
            <strong>{selectedStructure?.name ?? "selected"}</strong> pay structure.
            {periodDuplicate && (
              <>
                {" "}
                <strong>Warning:</strong> a run already exists for this period — proceeding may
                double-pay employees.
              </>
            )}
          </>
        }
        onConfirm={() => void createRun()}
        onCancel={() => !busy && setConfirmOpen(false)}
      />
    </form>
  );
}
