"use client";

import { UserFacingError } from "@/lib/userFacingError";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, DataTable, StatusPill, ActionButton, ErrorState } from "../../../_components/ds";
import { useFormError } from "@/lib/useFormError";
import { toHumanError } from "@/lib/messages";
import { formatMoney } from "@/lib/formatters";
import { nonNegativeRupeesToMinorString } from "@/lib/money";
import { labelForSourceType, validateBands, parseRoleTokens, type BandInput } from "./bands";

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
  /** Local-only marker for an optimistic "pending" row (GAP-ESTAB-APPROVAL-MATRIX-06). */
  pending?: boolean;
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

const EMPTY_FORM = {
  sourceType: "finance_sanction",
  label: "",
  minRupees: "0",
  maxRupees: "",
  workflowDefinitionCode: "",
  rolesCsv: "",
  priority: "100",
};

const MAX_POLLS = 5;
const POLL_INTERVAL_MS = 1000;

export function ApprovalMatrixPanel() {
  const [rules, setRules] = useState<Rule[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [bandWarning, setBandWarning] = useState("");
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [saving, setSaving] = useState(false);
  const { fromResponse, fromException, clear } = useFormError("approval rule");
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  // GAP-ESTAB-APPROVAL-MATRIX-06: clear any pending reload timers on unmount.
  useEffect(() => () => { timers.current.forEach(clearTimeout); timers.current = []; }, []);

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    try {
      const res = await fetch("/api/proxy/v1/estab/approval-rules", { signal });
      if (!res.ok) {
        // GAP-ESTAB-APPROVAL-MATRIX-01: a failed load must not look like an
        // empty matrix. Flag it, drop any stale rows, and let the render show
        // a retryable ErrorState with the Add form disabled.
        setLoadFailed(true);
        setRules([]);
        setError((await fromResponse(res, "load")).message);
        return;
      }
      const body = (await res.json()) as { data?: Rule[] };
      setRules(body.data ?? []);
      setLoadFailed(false);
      setError("");
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return;
      setLoadFailed(true);
      setRules([]);
      setError(fromException("load", err).message);
    } finally {
      setLoading(false);
    }
  }, [fromResponse, fromException]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const grouped = useMemo(() => {
    const map = new Map<string, Rule[]>();
    for (const r of rules) {
      const list = map.get(r.sourceType) ?? [];
      list.push(r);
      map.set(r.sourceType, list);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [rules]);

  /**
   * GAP-ESTAB-APPROVAL-MATRIX-06: after an async ("queued") write, poll the
   * list a bounded number of times until `done(rules)` is satisfied, instead
   * of a single fixed 800ms reload that frequently misses the new state.
   */
  const pollUntil = useCallback(
    (done: (rules: Rule[]) => boolean, attempt = 1) => {
      const t = setTimeout(() => {
        void (async () => {
          await load();
          setRules((current) => {
            if (done(current)) {
              setMessage("");
            } else if (attempt < MAX_POLLS) {
              pollUntil(done, attempt + 1);
            } else {
              setMessage("Still processing — refresh in a moment to see the change.");
            }
            return current;
          });
        })();
      }, POLL_INTERVAL_MS);
      timers.current.push(t);
    },
    [load],
  );

  const submit = useCallback(async () => {
    setSaving(true);
    setMessage("");
    setError("");
    setBandWarning("");
    clear();
    try {
      // GAP-ESTAB-APPROVAL-MATRIX-03: roles are validated tokens, not free text.
      const tokens = parseRoleTokens(form.rolesCsv);
      if (!tokens) {
        throw new UserFacingError(
          "Enter at least one approver role as lowercase codes (letters, digits, underscore), comma-separated.",
        );
      }
      const steps: Step[] = tokens.map((role) => ({
        role,
        label: role.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
      }));

      if (!form.label.trim()) throw new UserFacingError("Enter a rule label.");

      // GAP-ESTAB-APPROVAL-MATRIX-05: string-based rupee→paise, no float math.
      const minMinorStr = nonNegativeRupeesToMinorString(form.minRupees || "0");
      if (minMinorStr === null) throw new UserFacingError("Minimum amount must be a number with at most two decimals.");
      let maxMinorNum: number | null = null;
      if (form.maxRupees.trim() !== "") {
        const maxMinorStr = nonNegativeRupeesToMinorString(form.maxRupees);
        if (maxMinorStr === null) throw new UserFacingError("Maximum amount must be a number with at most two decimals.");
        maxMinorNum = Number(maxMinorStr);
      }
      const minMinorNum = Number(minMinorStr);
      if (maxMinorNum !== null && maxMinorNum <= minMinorNum) {
        throw new UserFacingError("Maximum amount must be greater than the minimum amount.");
      }

      // GAP-ESTAB-APPROVAL-MATRIX-03: overlap is a hard error; gap is a warning.
      const existing: BandInput[] = rules
        .filter((r) => r.active && r.sourceType === form.sourceType && !r.pending)
        .map((r) => ({ minAmountMinor: r.minAmountMinor, maxAmountMinor: r.maxAmountMinor }));
      const issues = validateBands(existing, { minAmountMinor: minMinorNum, maxAmountMinor: maxMinorNum });
      const overlap = issues.find((i) => i.kind === "overlap");
      if (overlap) throw new UserFacingError(overlap.message);
      const gap = issues.find((i) => i.kind === "gap");
      if (gap) setBandWarning(gap.message);

      const payload = {
        module: MODULE_OF[form.sourceType] ?? "finance",
        sourceType: form.sourceType,
        label: form.label.trim(),
        minAmountMinor: minMinorNum,
        maxAmountMinor: maxMinorNum,
        workflowDefinitionCode: form.workflowDefinitionCode,
        steps,
        priority: Number(form.priority || "100"),
      };
      const res = await fetch("/api/proxy/v1/estab/approval-rules", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        setError((await fromResponse(res, "save")).message);
        return;
      }

      // GAP-ESTAB-APPROVAL-MATRIX-06: show an optimistic Pending row, then poll
      // until the real rule (same label + sourceType, not pending) appears.
      const pendingId = `pending-${Date.now()}`;
      const optimistic: Rule = {
        id: pendingId, module: payload.module, sourceType: payload.sourceType, label: payload.label,
        minAmountMinor: minMinorNum, maxAmountMinor: maxMinorNum, workflowDefinitionCode: payload.workflowDefinitionCode,
        startNodeKey: "", steps, priority: payload.priority, active: true, updatedAt: new Date().toISOString(), pending: true,
      };
      const submittedLabel = payload.label;
      const submittedSource = payload.sourceType;
      setRules((cur) => [...cur, optimistic]);
      setMessage(`Rule "${submittedLabel}" queued.`);
      setForm({ ...EMPTY_FORM });
      pollUntil((latest) => latest.some((r) => !r.pending && r.sourceType === submittedSource && r.label === submittedLabel));
    } catch (err) {
      setError(fromException("save", err).message);
    } finally {
      setSaving(false);
    }
  }, [form, rules, fromResponse, fromException, clear, pollUntil]);

  const toggleActive = useCallback(
    async (rule: Rule) => {
      const res = await fetch(`/api/proxy/v1/estab/approval-rules/${rule.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ active: !rule.active }),
      });
      if (!res.ok) {
        throw UserFacingError.from(await fromResponse(res, "save"));
      }
      const target = !rule.active;
      setMessage(`Rule "${rule.label}" ${rule.active ? "deactivated" : "activated"}.`);
      pollUntil((latest) => latest.some((r) => r.id === rule.id && r.active === target));
    },
    [fromResponse, pollUntil],
  );

  return (
    <div style={{ display: "grid", gap: 18, marginTop: 18 }}>
      <div role="status" aria-live="polite">
        {message ? <p style={{ color: "var(--good)", fontSize: "0.875rem" }}>{message}</p> : null}
        {bandWarning ? <p style={{ color: "var(--warn)", fontSize: "0.875rem" }}>{bandWarning}</p> : null}
        {error ? <p style={{ color: "var(--bad)", fontSize: "0.875rem" }}>{error}</p> : null}
      </div>

      {/* New rule form */}
      <div className="card">
        <div className="card-h"><h3>Add approval rule</h3></div>
        <div className="pad" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
          <label style={{ display: "grid", gap: 4, fontSize: "0.8125rem" }}>
            <span>Module action</span>
            <select value={form.sourceType} onChange={(e) => setForm((f) => ({ ...f, sourceType: e.target.value }))}>
              {SOURCE_TYPES.map((s) => <option key={s} value={s}>{labelForSourceType(s)}</option>)}
            </select>
          </label>
          <label style={{ display: "grid", gap: 4, fontSize: "0.8125rem" }}>
            <span>Rule label</span>
            <input value={form.label} placeholder="e.g. PO sanction ₹5L–₹50L" onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))} />
          </label>
          <label style={{ display: "grid", gap: 4, fontSize: "0.8125rem" }}>
            <span>Min amount (₹)</span>
            <input type="number" min={0} step="0.01" value={form.minRupees} onChange={(e) => setForm((f) => ({ ...f, minRupees: e.target.value }))} />
          </label>
          <label style={{ display: "grid", gap: 4, fontSize: "0.8125rem" }}>
            <span>Max amount (₹, blank = unbounded)</span>
            <input type="number" min={0} step="0.01" value={form.maxRupees} onChange={(e) => setForm((f) => ({ ...f, maxRupees: e.target.value }))} />
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
          {/* GAP-ESTAB-APPROVAL-MATRIX-01: do not let an admin add a rule on top
              of a matrix that failed to load — the Add control is disabled until
              the current rules are known. */}
          <Button disabled={saving || loadFailed || !form.label || !form.workflowDefinitionCode} onClick={() => void submit()}>
            {saving ? "Saving…" : "Add rule"}
          </Button>
        </div>
      </div>

      {/* Existing rules grouped by source type */}
      {loading ? (
        <p className="pad" style={{ textAlign: "center", color: "var(--mut)" }}>Loading…</p>
      ) : loadFailed ? (
        <ErrorState error={toHumanError("load", { area: "approval rules" })} onRetry={() => void load()} />
      ) : grouped.length === 0 ? (
        <div className="card"><p className="pad" style={{ color: "var(--mut)" }}>No approval rules yet. Add one above — until then, modules use their explicitly supplied approval chain.</p></div>
      ) : (
        grouped.map(([sourceType, list]) => (
          <div className="card" key={sourceType}>
            <div className="card-h">
              <h3>{labelForSourceType(sourceType)}</h3>
              <span className="mono mut" style={{ fontSize: "0.75rem" }}>{sourceType}</span>
            </div>
            <DataTable<Rule>
              columns={[
                { key: "label", label: "Rule", render: (r) => <>{r.label}{r.pending ? " " : ""}{r.pending ? <StatusPill status="pending" /> : null}</> },
                { key: "minAmountMinor", label: "From", render: (r) => <span className="mono">{formatMoney(r.minAmountMinor)}</span> },
                { key: "maxAmountMinor", label: "To", render: (r) => <span className="mono">{r.maxAmountMinor === null ? "∞" : formatMoney(r.maxAmountMinor)}</span> },
                { key: "steps", label: "Approvers", render: (r) => <>{r.steps.map((s) => s.label).join(" → ")}</> },
                { key: "workflowDefinitionCode", label: "Workflow", render: (r) => <span className="mono">{r.workflowDefinitionCode}</span> },
                { key: "active", label: "Status", render: (r) => <StatusPill status={r.pending ? "pending" : r.active ? "active" : "inactive"} /> },
                {
                  key: "id",
                  label: "Actions",
                  sortable: false,
                  render: (r) => (
                    r.pending ? <span className="mut">—</span> : (
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
                    )
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
