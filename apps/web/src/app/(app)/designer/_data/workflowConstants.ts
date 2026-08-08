export interface WorkflowLane {
  id: string;
  key: string;
  name: string;
  optional: boolean;
  enabled: boolean;
  designationId: string;
  designationLabel: string;
  slaDays: number;
  /** FN-25 — superior designation notified on SLA breach. */
  escalationDesignationId: string;
  escalationDesignationLabel: string;
}

/** Pack-level lane binding persisted on the catalogue (FN-25). */
export interface LaneBindingDto {
  key: string;
  name: string;
  optional?: boolean;
  enabled?: boolean;
  designationId?: string;
  designationLabel?: string;
  slaDays: number;
  escalationDesignationId?: string;
  escalationDesignationLabel?: string;
}

export interface WorkflowDesignState {
  definitionId?: string;
  version: number;
  name: string;
  mode: "template" | "custom";
  lanes: WorkflowLane[];
}

export interface TenantPosition {
  id: string;
  label: string;
}

export const DEFAULT_LANE_TEMPLATE: Omit<WorkflowLane, "id" | "designationId" | "designationLabel">[] = [
  { key: "submitted", name: "Submitted", optional: false, enabled: true, slaDays: 1 },
  { key: "inspection", name: "Inspection", optional: true, enabled: true, slaDays: 7 },
  { key: "decision", name: "Decision", optional: false, enabled: true, slaDays: 5 },
  { key: "payment", name: "Payment", optional: true, enabled: true, slaDays: 3 },
  { key: "issued", name: "Issued", optional: false, enabled: true, slaDays: 1 },
];

export function defaultLanes(): WorkflowLane[] {
  return DEFAULT_LANE_TEMPLATE.map((lane) => ({
    ...lane,
    id: crypto.randomUUID(),
    designationId: "",
    designationLabel: "",
    escalationDesignationId: "",
    escalationDesignationLabel: "",
  }));
}

/** Convert guided lanes into catalogue laneBindings for runtime/sandbox. */
export function lanesToBindings(lanes: WorkflowLane[]): LaneBindingDto[] {
  return lanes.map((l) => ({
    key: l.key,
    name: l.name,
    optional: l.optional,
    enabled: l.enabled,
    designationId: l.designationId || undefined,
    designationLabel: l.designationLabel || undefined,
    slaDays: l.slaDays,
    escalationDesignationId: l.escalationDesignationId || undefined,
    escalationDesignationLabel: l.escalationDesignationLabel || undefined,
  }));
}

/** Designer SLA days → workflow engine minutes (24h calendar days). */
export function slaDaysToMinutes(slaDays: number): number | null {
  if (!Number.isFinite(slaDays) || slaDays <= 0) return null;
  return Math.round(slaDays * 24 * 60);
}

export function emptyWorkflowDesign(serviceName: string): WorkflowDesignState {
  return {
    version: 1,
    name: `${serviceName} approval chain`,
    mode: "template",
    lanes: defaultLanes(),
  };
}

export function narrateWorkflow(lanes: WorkflowLane[]): string {
  const active = lanes.filter((l) => l.enabled && l.key !== "submitted" && l.key !== "issued");
  if (active.length === 0) {
    return "An application will move from submission to issuance with no intermediate approval steps.";
  }
  const parts = active.map((lane) => {
    const who = lane.designationLabel || "the assigned officer";
    const sla = lane.slaDays > 0 ? ` within ${lane.slaDays} day${lane.slaDays === 1 ? "" : "s"}` : "";
    return `${lane.name.toLowerCase()} by ${who}${sla}`;
  });
  return `An application will be ${parts.join(", then ")}.`;
}
