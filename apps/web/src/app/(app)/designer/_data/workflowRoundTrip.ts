/**
 * B4 workflow round-trip helpers — template ↔ BPMN graph ↔ revert diff.
 * Pure functions only (safe for unit tests / no DOM).
 */

import type { WorkflowLane } from "./workflowConstants";
import { defaultLanes } from "./workflowConstants";

export interface DesignerNode {
  id: string;
  type: string;
  label: string;
  position: { x: number; y: number };
  properties?: Record<string, unknown>;
}

export interface DesignerEdge {
  id: string;
  source: string;
  target: string;
}

export interface WorkflowDiffRow {
  label: string;
  before: string;
  after: string;
}

function laneWho(lane: WorkflowLane): string {
  return lane.designationLabel?.trim() || "Unassigned";
}

function laneSummary(lane: WorkflowLane): string {
  if (!lane.enabled) return "Off";
  const sla = lane.slaDays > 0 ? `${lane.slaDays} day${lane.slaDays === 1 ? "" : "s"}` : "No SLA";
  return `${lane.name} · ${laneWho(lane)} · ${sla}`;
}

export function lanesToBpmn(lanes: WorkflowLane[]): { elements: DesignerNode[]; edges: DesignerEdge[] } {
  const enabled = lanes.filter((l) => l.enabled);
  const elements: DesignerNode[] = [];
  const edges: DesignerEdge[] = [];
  let x = 80;

  elements.push({
    id: "start_1",
    type: "startEvent",
    label: "Start",
    position: { x, y: 120 },
  });
  x += 140;

  let prevId = "start_1";
  for (const lane of enabled) {
    const nodeId = `lane_${lane.key}`;
    elements.push({
      id: nodeId,
      type: lane.key === "issued" ? "endEvent" : "task",
      label: lane.name,
      position: { x, y: 120 },
      properties: {
        laneKey: lane.key,
        designationId: lane.designationId,
        designationLabel: lane.designationLabel,
        slaDays: lane.slaDays,
      },
    });
    edges.push({ id: `edge_${prevId}_${nodeId}`, source: prevId, target: nodeId });
    prevId = nodeId;
    x += 160;
  }

  if (enabled.every((l) => l.key !== "issued")) {
    elements.push({
      id: "end_1",
      type: "endEvent",
      label: "End",
      position: { x, y: 120 },
    });
    edges.push({ id: `edge_${prevId}_end`, source: prevId, target: "end_1" });
  }

  return { elements, edges };
}

/** Reconstruct guided lanes from a BPMN graph seeded by lanesToBpmn. Returns null if graph is not template-shaped. */
export function lanesFromBpmn(elements: DesignerNode[]): WorkflowLane[] | null {
  const laneNodes = elements.filter(
    (e) => e.type === "task" || (e.type === "endEvent" && e.id.startsWith("lane_")),
  );
  if (laneNodes.length === 0) return null;

  const hasLaneKeys = laneNodes.some((n) => typeof n.properties?.laneKey === "string");
  if (!hasLaneKeys) {
    // Free-form canvas (gateways / renamed ids) — treat as custom, not template-compatible.
    const onlyLinearTasks = elements.every(
      (e) =>
        e.type === "startEvent" ||
        e.type === "endEvent" ||
        e.type === "task",
    );
    if (!onlyLinearTasks) return null;
  }

  const base = defaultLanes();
  let matched = 0;
  const next = base.map((lane) => {
    const node =
      laneNodes.find((t) => (t.properties?.laneKey as string) === lane.key) ??
      laneNodes.find((t) => t.label.toLowerCase() === lane.name.toLowerCase());
    if (!node) {
      return { ...lane, enabled: lane.optional ? false : lane.enabled };
    }
    matched += 1;
    return {
      ...lane,
      name: node.label || lane.name,
      designationId: String(node.properties?.designationId ?? ""),
      designationLabel: String(node.properties?.designationLabel ?? ""),
      slaDays: Number(node.properties?.slaDays ?? lane.slaDays),
      enabled: true,
    };
  });

  return matched > 0 ? next : null;
}

/** Template → BPMN → template fidelity check used by round-trip tests and loaders. */
export function roundTripLanes(lanes: WorkflowLane[]): WorkflowLane[] | null {
  const { elements } = lanesToBpmn(lanes);
  return lanesFromBpmn(elements);
}

export function cloneLanes(lanes: WorkflowLane[]): WorkflowLane[] {
  return lanes.map((l) => ({ ...l }));
}

/**
 * Human-readable diff for "Revert to template" confirm.
 * `before` = custom (current), `after` = guided template that will be restored.
 */
export function describeRevertToTemplateDiff(
  customLanes: WorkflowLane[],
  templateLanes: WorkflowLane[],
): WorkflowDiffRow[] {
  const rows: WorkflowDiffRow[] = [
    {
      label: "Workflow mode",
      before: "Custom visual editor",
      after: "Guided approval chain",
    },
  ];

  const keys = new Set([
    ...customLanes.map((l) => l.key),
    ...templateLanes.map((l) => l.key),
  ]);

  for (const key of keys) {
    const custom = customLanes.find((l) => l.key === key);
    const template = templateLanes.find((l) => l.key === key);
    if (!custom && !template) continue;

    const before = custom ? laneSummary(custom) : "Not present";
    const after = template ? laneSummary(template) : "Removed";
    if (before === after) continue;

    rows.push({
      label: template?.name ?? custom?.name ?? key,
      before,
      after,
    });
  }

  if (rows.length === 1) {
    rows.push({
      label: "Steps",
      before: "Custom canvas edits (if any)",
      after: "Restored guided chain — same step settings as before Advanced",
    });
  }

  return rows;
}
