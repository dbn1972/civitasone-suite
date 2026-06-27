"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { ConfirmDialog } from "../../../_components/ds";
import { trackActivation } from "@/lib/activation";

type Structure = { id: string; name: string };

type Props = {
  structures: Structure[];
  /** Pay periods that already have a run, used to guard against duplicates. */
  existingPeriods?: string[];
};

export function CreatePayrollRunForm({ structures, existingPeriods = [] }: Props) {
  const router = useRouter();
  const now = new Date();
  const defaultMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const [month, setMonth] = useState(defaultMonth);
  const [structureId, setStructureId] = useState(structures[0]?.id ?? "");
  const [runNo, setRunNo] = useState(`RUN/${defaultMonth.replace("-", "/")}`);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [tone, setTone] = useState<"good" | "bad">("good");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [dialogError, setDialogError] = useState<string | undefined>();

  const monthId = useId();
  const runNoId = useId();
  const structId = useId();
  const errId = useId();

  // A month like "2026-06" duplicates an existing period such as "Jun 2026" /
  // "2026-06" — compare on the year+month tokens to be format-agnostic.
  const periodDuplicate = existingPeriods.some((p) => {
    const norm = p.toLowerCase().replace(/\s+/g, "");
    return norm.includes(month) || norm.includes(month.replace("-", "/"));
  });

  const selectedStructure = structures.find((s) => s.id === structureId);

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
        setDialogError(text || `Create failed (${res.status})`);
        return;
      }
      const body = text ? (JSON.parse(text) as { id?: string }) : {};
      setConfirmOpen(false);
      trackActivation("first_transaction");
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
    if (!structureId || !runNo.trim() || !month) {
      setTone("bad");
      setMessage("Please complete all fields before creating a run.");
      return;
    }
    setDialogError(undefined);
    setConfirmOpen(true);
  }

  if (structures.length === 0) return null;

  return (
    <form onSubmit={handleSubmit} className="card" style={{ marginBottom: 16 }}>
      <div className="card-h">
        <h3>Create Payroll Run</h3>
      </div>
      <div className="pad" style={{ display: "grid", gap: 14 }}>
        <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))" }}>
          <div style={{ display: "grid", gap: 6 }}>
            <label htmlFor={monthId} style={{ fontSize: 13, fontWeight: 600 }}>Month</label>
            <input
              id={monthId}
              type="month"
              value={month}
              onChange={(e) => {
                setMonth(e.target.value);
                setRunNo(`RUN/${e.target.value.replace("-", "/")}`);
              }}
              aria-describedby={periodDuplicate ? errId : undefined}
              aria-invalid={periodDuplicate}
              style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
            />
          </div>
          <div style={{ display: "grid", gap: 6 }}>
            <label htmlFor={runNoId} style={{ fontSize: 13, fontWeight: 600 }}>Run No.</label>
            <input
              id={runNoId}
              value={runNo}
              onChange={(e) => setRunNo(e.target.value)}
              style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
            />
          </div>
          <div style={{ display: "grid", gap: 6 }}>
            <label htmlFor={structId} style={{ fontSize: 13, fontWeight: 600 }}>Pay Structure</label>
            <select
              id={structId}
              value={structureId}
              onChange={(e) => setStructureId(e.target.value)}
              style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44, background: "#fff" }}
            >
              {structures.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>
        </div>

        {periodDuplicate && (
          <p id={errId} role="alert" className="pill warn" style={{ width: "fit-content" }}>
            A run already exists for {month}. Creating another may double-pay employees.
          </p>
        )}

        <div>
          <button type="submit" className="btn primary" style={{ minHeight: 44 }} disabled={busy}>
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
          <Link href="/hr/leave/approvals" style={{ color: "var(--primary-d)" }}>
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
            Create run <strong>{runNo}</strong> for <strong>{month}</strong> using the{" "}
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
