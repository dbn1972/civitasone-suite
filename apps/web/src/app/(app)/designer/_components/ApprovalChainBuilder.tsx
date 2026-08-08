"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Card } from "@/app/_components/ds";
import {
  narrateWorkflow,
  type WorkflowDesignState,
  type WorkflowLane,
} from "../_data/workflowConstants";
import { fetchTenantPositions, persistWorkflowDesign } from "../_data/workflowBuilderApi";

const DesignerCanvas = dynamic(
  () => import("@/app/(app)/workflow/designer/_components/DesignerCanvas").then((m) => m.DesignerCanvas),
  { ssr: false, loading: () => <p style={{ color: "var(--mut)" }}>Loading visual editor…</p> },
);

interface Props {
  serviceName: string;
  initial: WorkflowDesignState;
  onSaveState?: (state: "saving" | "saved" | "offline") => void;
  onDesignPersisted?: (design: WorkflowDesignState) => void | Promise<void>;
}

export function ApprovalChainBuilder({
  serviceName,
  initial,
  onSaveState,
  onDesignPersisted,
}: Props) {
  const [design, setDesign] = useState(initial);
  const [advanced, setAdvanced] = useState(initial.mode === "custom");
  const [positions, setPositions] = useState<{ id: string; label: string }[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef(design);
  latest.current = design;

  useEffect(() => {
    fetchTenantPositions().then(setPositions).catch(() => setPositions([]));
  }, []);

  const narration = useMemo(() => narrateWorkflow(design.lanes), [design.lanes]);

  const schedulePersist = useCallback(() => {
    if (advanced) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      onSaveState?.("saving");
      try {
        const saved = await persistWorkflowDesign(latest.current);
        setDesign(saved);
        onDesignPersisted?.(saved);
        onSaveState?.("saved");
      } catch {
        onSaveState?.("offline");
      }
    }, 2000);
  }, [advanced, onDesignPersisted, onSaveState]);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  useEffect(() => { schedulePersist(); }, [design, schedulePersist]);

  const updateLane = (laneId: string, patch: Partial<WorkflowLane>) => {
    setDesign((d) => ({
      ...d,
      lanes: d.lanes.map((l) => (l.id === laneId ? { ...l, ...patch } : l)),
    }));
  };

  const toggleOptionalLane = (laneId: string) => {
    setDesign((d) => ({
      ...d,
      lanes: d.lanes.map((l) => (l.id === laneId ? { ...l, enabled: !l.enabled } : l)),
    }));
  };

  const openAdvanced = () => {
    setAdvanced(true);
    setDesign((d) => ({ ...d, mode: "custom" }));
  };

  const revertToTemplate = () => {
    if (!window.confirm("Revert to the guided approval chain? Custom canvas changes will be replaced on next save.")) return;
    setAdvanced(false);
    setDesign((d) => ({ ...d, mode: "template" }));
  };

  if (advanced) {
    return (
      <div style={{ display: "grid", gap: 12 }}>
        <div
          role="status"
          style={{
            padding: "10px 14px",
            borderRadius: "var(--r-sm)",
            background: "var(--warn-bg)",
            border: "1px solid var(--warn-border)",
            color: "var(--warn-fg)",
            fontSize: 13,
          }}
        >
          Advanced editor — changes here switch this service to custom-workflow mode.
        </div>
        <DesignerCanvas definitions={[]} />
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button type="button" className="btn ghost" onClick={revertToTemplate}>Revert to template</button>
          <button type="button" className="btn ghost" onClick={() => setAdvanced(false)}>Back to guided chain</button>
        </div>
      </div>
    );
  }

  const actionLanes = design.lanes.filter((l) => l.key !== "submitted" && l.key !== "issued");

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <Card>
        <div className="pad">
          <h3 style={{ margin: "0 0 8px", fontSize: 16 }}>Approval chain</h3>
          <p style={{ margin: "0 0 16px", fontSize: 13, color: "var(--mut)" }}>
            Configure who acts at each step and how long they have. Optional steps can be turned off for simpler services.
          </p>
          <div
            style={{
              display: "flex",
              gap: 12,
              overflowX: "auto",
              paddingBottom: 8,
            }}
            aria-label="Approval chain steps"
          >
            <LaneCard lane={design.lanes.find((l) => l.key === "submitted")!} positions={positions} onChange={updateLane} locked />
            {actionLanes.map((lane) => (
              <LaneCard
                key={lane.id}
                lane={lane}
                positions={positions}
                onChange={updateLane}
                onToggleOptional={lane.optional ? () => toggleOptionalLane(lane.id) : undefined}
              />
            ))}
            <LaneCard lane={design.lanes.find((l) => l.key === "issued")!} positions={positions} onChange={updateLane} locked />
          </div>
          <p style={{ margin: "16px 0 0", fontSize: 13, color: "var(--ink2)", fontStyle: "italic" }}>{narration}</p>
        </div>
      </Card>

      <div>
        <button type="button" className="btn ghost" onClick={openAdvanced}>Open visual editor (Advanced)</button>
      </div>
    </div>
  );
}

function LaneCard({
  lane,
  positions,
  onChange,
  onToggleOptional,
  locked = false,
}: {
  lane: WorkflowLane;
  positions: { id: string; label: string }[];
  onChange: (laneId: string, patch: Partial<WorkflowLane>) => void;
  onToggleOptional?: () => void;
  locked?: boolean;
}) {
  return (
    <div
      style={{
        minWidth: 200,
        flex: "0 0 auto",
        padding: 12,
        borderRadius: "var(--r-sm)",
        border: `1px solid ${lane.enabled ? "var(--line)" : "var(--line2)"}`,
        background: lane.enabled ? "var(--panel)" : "var(--bg)",
        opacity: lane.enabled ? 1 : 0.65,
      }}
    >
      {locked ? (
        <strong style={{ display: "block", marginBottom: 8 }}>{lane.name}</strong>
      ) : (
        <input
          className="input"
          value={lane.name}
          onChange={(e) => onChange(lane.id, { name: e.target.value })}
          aria-label="Step name"
          style={{ marginBottom: 8, fontWeight: 600 }}
        />
      )}
      {!locked ? (
        <>
          <label style={{ display: "grid", gap: 4, fontSize: 12, marginBottom: 8 }}>
            <span style={{ color: "var(--mut)" }}>Who acts?</span>
            <select
              className="input"
              value={lane.designationId}
              onChange={(e) => {
                const opt = positions.find((p) => p.id === e.target.value);
                onChange(lane.id, { designationId: e.target.value, designationLabel: opt?.label ?? "" });
              }}
            >
              <option value="">Select designation</option>
              {positions.map((p) => (
                <option key={p.id} value={p.id}>{p.label}</option>
              ))}
            </select>
          </label>
          <label style={{ display: "grid", gap: 4, fontSize: 12, marginBottom: 8 }}>
            <span style={{ color: "var(--mut)" }}>SLA (days)</span>
            <input
              className="input"
              type="number"
              min={0}
              max={365}
              value={lane.slaDays}
              onChange={(e) => onChange(lane.id, { slaDays: Number(e.target.value) || 0 })}
            />
          </label>
          <label style={{ display: "grid", gap: 4, fontSize: 12, marginBottom: 8 }}>
            <span style={{ color: "var(--mut)" }}>Escalate to (on breach)</span>
            <select
              className="input"
              value={lane.escalationDesignationId}
              onChange={(e) => {
                const opt = positions.find((p) => p.id === e.target.value);
                onChange(lane.id, {
                  escalationDesignationId: e.target.value,
                  escalationDesignationLabel: opt?.label ?? "",
                });
              }}
              aria-label="Escalation designation"
            >
              <option value="">Select superior designation</option>
              {positions.map((p) => (
                <option key={p.id} value={p.id}>{p.label}</option>
              ))}
            </select>
          </label>
          {onToggleOptional ? (
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
              <input
                type="checkbox"
                checked={lane.enabled}
                onChange={onToggleOptional}
              />
              Include this step
            </label>
          ) : null}
        </>
      ) : (
        <p style={{ margin: 0, fontSize: 12, color: "var(--mut)" }}>Fixed step</p>
      )}
    </div>
  );
}
