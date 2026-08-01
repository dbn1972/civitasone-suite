"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, ConfirmDialog } from "../../../../_components/ds";
import { browserJson } from "@/lib/api/browserClient";

type RuleResponse = { data: { id: string; employeeGroup: string; costCenterId: string; splitPct: number } };

export function CreateCostingRuleForm() {
  const router = useRouter();
  const [employeeGroup, setEmployeeGroup] = useState("");
  const [costCenterId, setCostCenterId] = useState("");
  const [splitPct, setSplitPct] = useState("100");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [message, setMessage] = useState<string | null>(null);

  const groupField = useId();
  const centerField = useId();
  const splitField = useId();

  function openConfirm(e: React.FormEvent) {
    e.preventDefault();
    setError(undefined);
    setMessage(null);
    if (!employeeGroup.trim() || !costCenterId.trim()) {
      setError("Employee group and cost center are required.");
      return;
    }
    setConfirmOpen(true);
  }

  async function save() {
    setBusy(true);
    setError(undefined);
    try {
      const res = await browserJson<RuleResponse>("v1/payroll/costing/rules", {
        method: "POST",
        body: JSON.stringify({
          employeeGroup: employeeGroup.trim(),
          costCenterId: costCenterId.trim(),
          splitPct: Number(splitPct),
        }),
      });
      setConfirmOpen(false);
      setMessage(`Costing rule saved for ${res.data.employeeGroup} (${res.data.splitPct}%).`);
      setEmployeeGroup("");
      setCostCenterId("");
      setSplitPct("100");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={openConfirm} style={{ marginBottom: 16 }}>
      <Card title="Create Costing Rule" padding>
        <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))" }}>
          <div style={{ display: "grid", gap: 6 }}>
            <label htmlFor={groupField} style={{ fontSize: 13, fontWeight: 600 }}>
              Employee Group <span aria-hidden="true" style={{ color: "var(--bad, #c0392b)" }}>*</span>
            </label>
            <input id={groupField} value={employeeGroup} onChange={(e) => setEmployeeGroup(e.target.value)} maxLength={64} aria-required="true" style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }} />
          </div>
          <div style={{ display: "grid", gap: 6 }}>
            <label htmlFor={centerField} style={{ fontSize: 13, fontWeight: 600 }}>
              Cost Center ID (UUID) <span aria-hidden="true" style={{ color: "var(--bad, #c0392b)" }}>*</span>
            </label>
            <input id={centerField} value={costCenterId} onChange={(e) => setCostCenterId(e.target.value)} aria-required="true" style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }} />
          </div>
          <div style={{ display: "grid", gap: 6 }}>
            <label htmlFor={splitField} style={{ fontSize: 13, fontWeight: 600 }}>Split %</label>
            <input id={splitField} type="number" min={0} max={100} value={splitPct} onChange={(e) => setSplitPct(e.target.value)} style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }} />
          </div>
        </div>
        <div style={{ marginTop: 14 }}>
          <button type="submit" className="btn primary" style={{ minHeight: 44 }} disabled={busy}>
            Save Rule
          </button>
        </div>
        {error && !confirmOpen && (
          <p role="alert" className="pill bad" style={{ marginTop: 10, width: "fit-content" }}>{error}</p>
        )}
        {message && (
          <p role="status" aria-live="polite" className="pill good" style={{ marginTop: 10, width: "fit-content" }}>{message}</p>
        )}
      </Card>

      <ConfirmDialog
        open={confirmOpen}
        title="Save this costing rule?"
        confirmLabel="Save rule"
        busy={busy}
        errorMessage={error}
        description={
          <>
            Allocate <strong>{splitPct}%</strong> of payroll cost for employee group{" "}
            <strong>{employeeGroup}</strong> to cost center <strong>{costCenterId}</strong>.
          </>
        }
        onConfirm={() => void save()}
        onCancel={() => !busy && setConfirmOpen(false)}
      />
    </form>
  );
}
