/**
 * Client-safe BPMN designer types. No server-only imports.
 * Used by the React Flow canvas and supporting components.
 */

/** BPMN element types supported by the palette */
export type BpmnElementType =
  | "startEvent"
  | "endEvent"
  | "task"
  | "exclusiveGateway"
  | "parallelGateway"
  | "subProcess";

export interface PaletteItem {
  type: BpmnElementType;
  label: string;
  icon: string;
  description: string;
}

/** All available palette items for drag-and-drop */
export const PALETTE_ITEMS: PaletteItem[] = [
  { type: "startEvent", label: "Start Event", icon: "▶", description: "Process entry point" },
  { type: "endEvent", label: "End Event", icon: "■", description: "Process termination" },
  { type: "task", label: "Task", icon: "◻", description: "User or service task" },
  { type: "exclusiveGateway", label: "Exclusive Gateway", icon: "◇", description: "XOR decision branch" },
  { type: "parallelGateway", label: "Parallel Gateway", icon: "⊞", description: "AND fork/join" },
  { type: "subProcess", label: "Sub-Process", icon: "▣", description: "Nested process container" },
];

/** Properties editable in the property panel per element type */
export interface ElementProperties {
  id: string;
  type: BpmnElementType;
  label: string;
  description?: string;
  assignee?: string;
  dueDate?: string;
  condition?: string;
}

/** Validation violation from backend */
export interface DesignerViolation {
  elementId: string;
  type: string;
  message: string;
}
