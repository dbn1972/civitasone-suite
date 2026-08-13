"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { DataTable, StatusPill, ActionButton } from "../../../_components/ds";

type Step = { role: string; label: string };

type Rule = {
  id: string;
  module: string;
  sourceType: string;
  label: string;
  minAmountMinor: number;
  maxAmountMinor: number | null;
  workflowDefinitionCode: string;
  startNodeKey: string;
  steps: Step[];
  priority: number;
  active: boolean;
  updatedAt: string;
};

const SOURCE_TYPES = [
  "finance_sanction", "finance_payment", "finance_reappropriation",
  "procurement_award", "procurement_po",
  "hr_promotion", "hr_transfer", "hr_disciplinary", "hr_leave_special", "hr_recruitment",
  "grant_scheme", "grant_disbursement",
  "asset_disposal", "legal_opinion", "contract_award",
] as const;

const MODULE_OF: Record<string, string> = {
  finance_sanction: "finance", finance_payment: "finance", finance_reappropriation: "finance",
  procurement_award: "procurement", procurement_po: "procurement",
  hr_promotion: "hr", hr_transfer: "hr", hr_disciplinary: "hr", hr_leave_special: "hr", hr_recruitment: "hr",
  grant_scheme: "grant", grant_disbursement: "grant",
  asset_disposal: "asset", legal_opinion: "legal", contract_award: "contract",
};

function rupees(minor: number | null): string {
  if (minor === null) return "∞";
  return `₹${(minor / 100).toLocaleString("en-IN")}`;
}

const EMPTY_FORM = {
  sourceType: "finance_sanction",
  label: "",
  minRupees: "0",
  maxRupees: "",
  workflowDefinitionCode: "",
  rolesCsv: "",
  priority: "100",
};

export function ApprovalMatrixPanel() {
  const [rules, setRules] = useState<Rule[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/proxy/v1/estab/approval-rules");
      if (!res.ok) throw new Error(await res.text());
      const body = (await res.json()) as { data?: Rule[] };
      setRules(body.data ?? []);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load rules");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const grouped = useMemo(() => {
    const map = new Map<string, Rule[]>();
    for (const r of rules) {
      const list = map.get(r.sourceType) ?? [];
      list.push(r);
      map.set(r.sourceType, list);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [rules]);

  const submit = useCallback(async () => {
    setSaving(true);
    setMessage("");
    setError("");
    try {
      const steps: Step[] = form.rolesCsv
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        .map((role) => ({ role, label: role.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()) }));
      if (steps.length === 0) throw new Error("Add at least one approver role");

      const minMinor = Math.round(Number(form.minRupees || "0") * 100);
      const maxMinor = form.maxRupees.trim() === "" ? null : Math.round(Number(form.maxRupees) * 100);

      const payload = {
        module: MODULE_OF[form.sourceType] ?? "finance",
        sourceType: form.sourceType,
        label: form.label,
        minAmountMinor: minMinor,
        maxAmountMinor: maxMinor,
        workflowDefinitionCode: form.workflowDefinitionCode,
        steps,
        priority: Number(form.priority || "100"),
      };
      const res = await fetch("/api/proxy/v1/estab/approval-rules", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error((await res.text()) || "Create failed");
      setMessage(`Rule "${form.label}" queued. It will appear once processed.`);
      setForm({ ...EMPTY_FORM });
      setTimeout(() => void load(), 800);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Create failed");
    } finally {
      setSaving(false);
    }
  }, [form, load]);

  const toggleActive = useCallback(
    async (rule: Rule) => {
      const res = await fetch(`/api/proxy/v1/estab/approval-rules/${rule.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ active: !rule.active }),
      });
      if (!res.ok) throw new Error((await res.text()) || "Update failed");
      setMessage(`Rule "${rule.label}" ${rule.active ? "deactivated" : "activated"}.`);
      setTimeout(() => void load(), 800);
    },
    [load],
  );

  return (
    <div style={{ display: "grid", gap: 18, marginTop: 18 }}>
      <div role="status" aria-live="polite">
        {message ? <p style={{ color: "var(--good)", fontSize: "0.875rem" }}>{message}</p> : null}
        {error ? <p style={{ color: "var(--bad)", fontSize: "0.875rem" }}>{error}</p> : null}
      </div>

      {/* New rule form */}
      <div className="card">
        <div className="card-h"><h3>Add approval rule</h3></div>
        <div className="pad" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
          <label style={{ display: "grid", gap: 4, fontSize: "0.8125rem" }}>
            <span>Module action</span>
            <select value={form.sourceType} onChange={(e) => setForm((f) => ({ ...f, sourceType: e.target.value }))}>
              {SOURCE_TYPES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
          <label style={{ display: "grid", gap: 4, fontSize: "0.8125rem" }}>
            <span>Rule label</span>
            <input value={form.label} placeholder="e.g. PO sanction ₹5L–₹50L" onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))} />
          </label>
          <label style={{ display: "grid", gap: 4, fontSize: "0.8125rem" }}>
            <span>Min amount (₹)</span>
            <input type="number" min={0} value={form.minRupees} onChange={(e) => setForm((f) => ({ ...f, minRupees: e.target.value }))} />
          </label>
          <label style={{ display: "grid", gap: 4, fontSize: "0.8125rem" }}>
            <span>Max amount (₹, blank = unbounded)</span>
            <input type="number" min={0} value={form.maxRupees} onChange={(e) => setForm((f) => ({ ...f, maxRupees: e.target.value }))} />
          </label>
          <label style={{ display: "grid", gap: 4, fontSize: "0.8125rem" }}>
            <span>Workflow definition code</span>
            <input value={form.workflowDefinitionCode} placeholder="finance.sanction.director_cto" onChange={(e) => setForm((f) => ({ ...f, workflowDefinitionCode: e.target.value }))} />
          </label>
          <label style={{ display: "grid", gap: 4, fontSize: "0.8125rem" }}>
            <span>Approver roles (comma-separated)</span>
            <input value={form.rolesCsv} placeholder="director, cto, ceo" onChange={(e) => setForm((f) => ({ ...f, rolesCsv: e.target.value }))} />
          </label>
          <label style={{ display: "grid", gap: 4, fontSize: "0.8125rem" }}>
            <span>Priority (lower wins on tie)</span>
            <input type="number" min={0} value={form.priority} onChange={(e) => setForm((f) => ({ ...f, priority: e.target.value }))} />
          </label>
        </div>
        <div className="pad" style={{ paddingTop: 0 }}>
          <button className="btn primary" disabled={saving || !form.label || !form.workflowDefinitionCode} onClick={() => void submit()}>
            {saving ? "Saving…" : "Add rule"}
          </button>
        </div>
      </div>

      {/* Existing rules grouped by source type */}
      {loading ? (
        <p className="pad" style={{ textAlign: "center", color: "#94a3b8" }}>Loading…</p>
      ) : grouped.length === 0 ? (
        <div className="card"><p className="pad" style={{ color: "#94a3b8" }}>No approval rules yet. Add one above — until then, modules use their explicitly supplied approval chain.</p></div>
      ) : (
        grouped.map(([sourceType, list]) => (
          <div className="card" key={sourceType}>
            <div className="card-h"><h3>{sourceType}</h3></div>
            <DataTable<Rule>
              columns={[
                { key: "label", label: "Rule" },
                { key: "minAmountMinor", label: "From", render: (r) => <span className="mono">{rupees(r.minAmountMinor)}</span> },
                { key: "maxAmountMinor", label: "To", render: (r) => <span className="mono">{rupees(r.maxAmountMinor)}</span> },
                { key: "steps", label: "Approvers", render: (r) => <>{r.steps.map((s) => s.label).join(" → ")}</> },
                { key: "workflowDefinitionCode", label: "Workflow", render: (r) => <span className="mono">{r.workflowDefinitionCode}</span> },
                { key: "active", label: "Status", render: (r) => <StatusPill status={r.active ? "active" : "inactive"} /> },
                {
                  key: "id",
                  label: "Actions",
                  sortable: false,
                  render: (r) => (
                    <ActionButton
                      label={r.active ? "Deactivate" : "Activate"}
                      className="btn ghost"
                      danger={r.active}
                      confirmTitle={`${r.active ? "Deactivate" : "Activate"} this rule?`}
                      confirmDescription={r.active
                        ? "Files in this band will no longer route through this rule. Existing files are unaffected."
                        : "Files in this band will route through this rule from now on."}
                      confirmLabel={r.active ? "Deactivate" : "Activate"}
                      onConfirm={() => toggleActive(r)}
                    />
                  ),
                },
              ]}
              rows={list}
            />
          </div>
        ))
      )}
    </div>
  );
}
