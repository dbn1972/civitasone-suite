export interface WorkflowLane {
  id: string;
  key: string;
  name: string;
  optional: boolean;
  enabled: boolean;
  designationId: string;
  designationLabel: string;
  slaDays: number;
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
  }));
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
