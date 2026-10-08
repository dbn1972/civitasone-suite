"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useRef,
  type DragEvent,
} from "react";
import ReactFlow, {
  addEdge,
  useNodesState,
  useEdgesState,
  Controls,
  Background,
  MiniMap,
  Panel,
  type Connection,
  type Node,
  type Edge,
  type NodeTypes,
  type ReactFlowInstance,
} from "reactflow";
import "reactflow/dist/style.css";

import type { DesignerDefinitionSummary } from "../_data/designerData";
import type { BpmnElementType, DesignerViolation } from "../_data/designerTypes";
import { BpmnPalette } from "./BpmnPalette";
import { PropertyPanel } from "./PropertyPanel";
import { ValidationIndicators } from "./ValidationIndicators";
import { StartEventNode } from "./nodes/StartEventNode";
import { EndEventNode } from "./nodes/EndEventNode";
import { TaskNode } from "./nodes/TaskNode";
import { GatewayNode } from "./nodes/GatewayNode";
import { SubProcessNode } from "./nodes/SubProcessNode";

const nodeTypes: NodeTypes = {
  startEvent: StartEventNode,
  endEvent: EndEventNode,
  task: TaskNode,
  exclusiveGateway: GatewayNode,
  parallelGateway: GatewayNode,
  subProcess: SubProcessNode,
};

let idCounter = 0;
function nextId(): string {
  idCounter += 1;
  return `node_${Date.now()}_${idCounter}`;
}

/** GAP-WORKFLOW-DESIGNER-05 — hard cap enforced in add/drop/connect. */
const MAX_ELEMENTS = 500;

/**
 * GAP-WORKFLOW-DESIGNER-06 — lightweight condition validity check: an operand,
 * a comparison operator and a value (e.g. `amount > 100000`, `status == 'open'`).
 * Deliberately conservative — flags obviously malformed expressions like
 * `amount >` without trying to be a full expression engine.
 */
function isValidCondition(expr: string): boolean {
  return /^\s*[A-Za-z_][\w.]*\s*(==|!=|>=|<=|>|<)\s*('[^']*'|"[^"]*"|-?\d+(\.\d+)?|true|false|[A-Za-z_][\w.]*)\s*$/.test(expr);
}

/** Optional seed graph from Universal Designer B4 template → BPMN round-trip. */
export interface DesignerCanvasSeedGraph {
  name?: string;
  elements: Array<{
    id: string;
    type: string;
    label: string;
    position: { x: number; y: number };
    properties?: Record<string, unknown>;
  }>;
  edges: Array<{ id: string; source: string; target: string }>;
}

interface Props {
  definitions: DesignerDefinitionSummary[];
  /** When set (e.g. from guided approval lanes), canvas opens pre-populated. */
  seedGraph?: DesignerCanvasSeedGraph;
  /** Compact height for embedding inside the service designer wizard. */
  embedded?: boolean;
  /** GAP-WORKFLOW-DESIGNER-01 / DETAIL-01 — deep-link a draft to open on mount. */
  initialDefinitionId?: string;
  /**
   * GAP2-DESIGNER-HOME-01 — whether the caller may author (save drafts). When
   * false the Save control is hidden (the canvas stays usable as a read-only
   * viewer: open a draft, validate). workflow-service's designer routes remain
   * the authority (403 on POST). Defaults true so embedded authoring surfaces
   * (the service-designer wizard) are unchanged.
   */
  canAuthor?: boolean;
}

function seedToFlow(seed?: DesignerCanvasSeedGraph): { nodes: Node[]; edges: Edge[] } {
  if (!seed) return { nodes: [], edges: [] };
  return {
    nodes: seed.elements.map((el) => ({
      id: el.id,
      type: el.type,
      position: el.position,
      data: {
        label: el.label,
        ...(el.properties ?? {}),
      },
    })),
    edges: seed.edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      animated: true,
    })),
  };
}

export function DesignerCanvas({ definitions, seedGraph, embedded = false, initialDefinitionId, canAuthor = true }: Props) {
  const reactFlowWrapper = useRef<HTMLDivElement>(null);
  const [reactFlowInstance, setReactFlowInstance] = useState<ReactFlowInstance | null>(null);
  const seeded = useMemo(() => seedToFlow(seedGraph), [seedGraph]);
  const [nodes, setNodes, onNodesChange] = useNodesState(seeded.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(seeded.edges);
  const [selectedNode, setSelectedNode] = useState<Node | null>(null);
  const [violations, setViolations] = useState<DesignerViolation[]>([]);
  const [hasValidated, setHasValidated] = useState(false);
  const [limitMessage, setLimitMessage] = useState<string | null>(null);
  const [definitionId, setDefinitionId] = useState<string | null>(null);
  const [definitionName, setDefinitionName] = useState(seedGraph?.name ?? "Untitled Process");
  const [saveState, setSaveState] = useState<{ kind: "idle" | "saving" | "ok" | "err"; text?: string }>({ kind: "idle" });

  /**
   * GAP-WORKFLOW-DESIGNER-01 — map reactflow nodes/edges to the designer API
   * shape and Save as a NEW draft (POST; never overwrites a live definition —
   * see Risk note). The service create endpoint is ADMIN_ROLES + audited.
   */
  const onSave = useCallback(async () => {
    setSaveState({ kind: "saving" });
    const payload = {
      name: definitionName.trim() || "Untitled Process",
      elements: nodes.map((n) => ({
        id: n.id,
        type: n.type ?? "task",
        label: String((n.data as { label?: string })?.label ?? ""),
        position: { x: Math.round(n.position.x), y: Math.round(n.position.y) },
        properties: Object.fromEntries(
          Object.entries(n.data as Record<string, unknown>).filter(([k]) => k !== "label"),
        ),
      })),
      edges: edges.map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        ...(e.label ? { label: String(e.label) } : {}),
      })),
    };
    try {
      const res = await fetch(`/api/proxy/v1/workflow/designer/definitions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!(res.ok || res.status === 202)) {
        setSaveState({ kind: "err", text: "Could not save. Please try again." });
        return;
      }
      setSaveState({ kind: "ok", text: "Saved as a new draft." });
    } catch {
      setSaveState({ kind: "err", text: "Could not save. Please try again." });
    }
  }, [definitionName, nodes, edges]);

  /** GAP-WORKFLOW-DESIGNER-01 — load a draft's full graph into the canvas. */
  const onOpen = useCallback(
    async (id: string) => {
      if (!id) return;
      try {
        const res = await fetch(`/api/proxy/v1/workflow/designer/definitions/${encodeURIComponent(id)}`, { cache: "no-store" });
        if (!res.ok) {
          setSaveState({ kind: "err", text: "Could not open that workflow." });
          return;
        }
        const body = (await res.json()) as { data?: { name?: string; elements?: DesignerCanvasSeedGraph["elements"]; edges?: DesignerCanvasSeedGraph["edges"] } };
        const d = body.data;
        if (!d) return;
        const flow = seedToFlow({ name: d.name, elements: d.elements ?? [], edges: d.edges ?? [] });
        setNodes(flow.nodes);
        setEdges(flow.edges);
        setDefinitionId(id);
        setDefinitionName(d.name ?? "Untitled Process");
        setHasValidated(false);
        setSaveState({ kind: "idle" });
      } catch {
        setSaveState({ kind: "err", text: "Could not open that workflow." });
      }
    },
    [setNodes, setEdges],
  );

  const onConnect = useCallback(
    (connection: Connection) => {
      setEdges((eds) => {
        if (nodes.length + eds.length >= MAX_ELEMENTS) {
          setLimitMessage(`This workflow has reached the ${MAX_ELEMENTS}-element limit. Remove an element before adding another.`);
          return eds;
        }
        setLimitMessage(null);
        return addEdge({ ...connection, animated: true }, eds);
      });
      setHasValidated(false);
    },
    [setEdges, nodes.length],
  );

  /**
   * GAP-WORKFLOW-DESIGNER-03 — keyboard/click add. Places a node at the current
   * viewport centre (so it is visible without a drag) and selects it.
   */
  const addNodeOfType = useCallback(
    (type: BpmnElementType) => {
      if (nodes.length + edges.length >= MAX_ELEMENTS) {
        setLimitMessage(`This workflow has reached the ${MAX_ELEMENTS}-element limit. Remove an element before adding another.`);
        return;
      }
      setLimitMessage(null);
      const centre = reactFlowInstance
        ? reactFlowInstance.screenToFlowPosition({
            x: (reactFlowWrapper.current?.getBoundingClientRect().width ?? 600) / 2,
            y: (reactFlowWrapper.current?.getBoundingClientRect().height ?? 400) / 2,
          })
        : { x: 120, y: 120 };
      const newNode: Node = { id: nextId(), type, position: centre, data: { label: getDefaultLabel(type) } };
      setNodes((nds) => [...nds, newNode]);
      setSelectedNode(newNode);
      setHasValidated(false);
    },
    [nodes.length, edges.length, reactFlowInstance, setNodes],
  );

  /**
   * GAP-WORKFLOW-DESIGNER-03 — keyboard edge creation. Connects the selected
   * node to another node chosen from the property panel's "Connect to…" list.
   */
  const connectToNode = useCallback(
    (sourceId: string, targetId: string) => {
      if (!targetId || sourceId === targetId) return;
      setEdges((eds) => {
        if (nodes.length + eds.length >= MAX_ELEMENTS) {
          setLimitMessage(`This workflow has reached the ${MAX_ELEMENTS}-element limit. Remove an element before adding another.`);
          return eds;
        }
        setLimitMessage(null);
        return addEdge({ id: `edge_${sourceId}_${targetId}_${Date.now()}`, source: sourceId, target: targetId, animated: true }, eds);
      });
      setHasValidated(false);
    },
    [setEdges, nodes.length],
  );

  const onNodeClick = useCallback((_: React.MouseEvent, node: Node) => {
    setSelectedNode(node);
  }, []);

  const onPaneClick = useCallback(() => {
    setSelectedNode(null);
  }, []);

  const onDragOver = useCallback((event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  }, []);

  const onDrop = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      const type = event.dataTransfer.getData("application/bpmn-type") as BpmnElementType;
      if (!type || !reactFlowInstance || !reactFlowWrapper.current) return;

      const bounds = reactFlowWrapper.current.getBoundingClientRect();
      const position = reactFlowInstance.screenToFlowPosition({
        x: event.clientX - bounds.left,
        y: event.clientY - bounds.top,
      });

      const newNode: Node = {
        id: nextId(),
        type,
        position,
        data: { label: getDefaultLabel(type) },
      };

      if (nodes.length + edges.length >= MAX_ELEMENTS) {
        setLimitMessage(`This workflow has reached the ${MAX_ELEMENTS}-element limit. Remove an element before adding another.`);
        return;
      }
      setLimitMessage(null);
      setNodes((nds) => [...nds, newNode]);
      setHasValidated(false);
    },
    [reactFlowInstance, setNodes, nodes.length, edges.length],
  );

  const onNodeLabelChange = useCallback(
    (nodeId: string, label: string) => {
      setNodes((nds) =>
        nds.map((n) => (n.id === nodeId ? { ...n, data: { ...n.data, label } } : n)),
      );
      if (selectedNode?.id === nodeId) {
        setSelectedNode((prev) => (prev ? { ...prev, data: { ...prev.data, label } } : null));
      }
    },
    [setNodes, selectedNode],
  );

  const onNodePropertyChange = useCallback(
    (nodeId: string, key: string, value: string) => {
      setNodes((nds) =>
        nds.map((n) =>
          n.id === nodeId ? { ...n, data: { ...n.data, [key]: value } } : n,
        ),
      );
    },
    [setNodes],
  );

  const onValidate = useCallback(async () => {
    // Client-side validation check
    const newViolations: DesignerViolation[] = [];

    const startNodes = nodes.filter((n) => n.type === "startEvent");
    const endNodes = nodes.filter((n) => n.type === "endEvent");
    const gatewayNodes = nodes.filter(
      (n) => n.type === "exclusiveGateway" || n.type === "parallelGateway",
    );

    if (startNodes.length === 0) {
      newViolations.push({
        elementId: "__canvas",
        type: "MISSING_START",
        message: "Process must have at least one start event",
      });
    }

    if (endNodes.length === 0) {
      newViolations.push({
        elementId: "__canvas",
        type: "MISSING_END",
        message: "Process must have at least one end event",
      });
    }

    // Check gateways have at least one outgoing edge
    for (const gw of gatewayNodes) {
      const outgoing = edges.filter((e) => e.source === gw.id);
      if (outgoing.length === 0) {
        newViolations.push({
          elementId: gw.id,
          type: "GATEWAY_NO_OUTGOING",
          message: `Gateway "${gw.data?.label || gw.id}" has no outgoing flows`,
        });
      }
      // GAP-WORKFLOW-DESIGNER-04 — an exclusive gateway's outgoing edges each
      // need a condition expression, else routing is ambiguous.
      if (gw.type === "exclusiveGateway" && !gw.data?.condition && outgoing.length > 1) {
        newViolations.push({
          elementId: gw.id,
          type: "GATEWAY_NO_CONDITION",
          message: `Exclusive gateway "${gw.data?.label || gw.id}" has multiple branches but no condition expression`,
        });
      }
      // GAP-WORKFLOW-DESIGNER-06 — a present condition must be well-formed
      // (field op value), else it silently never matches at runtime.
      const cond = typeof gw.data?.condition === "string" ? gw.data.condition : "";
      if (cond && !isValidCondition(cond)) {
        newViolations.push({
          elementId: gw.id,
          type: "GATEWAY_BAD_CONDITION",
          message: `Gateway "${gw.data?.label || gw.id}" has an invalid condition "${cond}" (expected e.g. amount > 100000)`,
        });
      }
    }

    // GAP-WORKFLOW-DESIGNER-04 — every task must be wired in and out, and name
    // an assignee role, else it can never be routed to or completed.
    const taskNodes = nodes.filter((n) => n.type === "task");
    for (const task of taskNodes) {
      const hasIncoming = edges.some((e) => e.target === task.id);
      const hasOutgoing = edges.some((e) => e.source === task.id);
      if (!hasIncoming) {
        newViolations.push({ elementId: task.id, type: "TASK_NO_INCOMING", message: `Task "${task.data?.label || task.id}" has no incoming flow` });
      }
      if (!hasOutgoing) {
        newViolations.push({ elementId: task.id, type: "TASK_NO_OUTGOING", message: `Task "${task.data?.label || task.id}" has no outgoing flow` });
      }
      if (!task.data?.assignee) {
        newViolations.push({ elementId: task.id, type: "TASK_NO_ASSIGNEE", message: `Task "${task.data?.label || task.id}" has no assignee role` });
      }
    }

    // GAP-WORKFLOW-DESIGNER-04 — a start event must have no incoming flow.
    for (const start of startNodes) {
      if (edges.some((e) => e.target === start.id)) {
        newViolations.push({ elementId: start.id, type: "START_HAS_INCOMING", message: `Start event "${start.data?.label || start.id}" must not have an incoming flow` });
      }
    }

    // Check edges reference existing nodes
    const nodeIds = new Set(nodes.map((n) => n.id));
    for (const edge of edges) {
      if (!nodeIds.has(edge.source)) {
        newViolations.push({
          elementId: edge.id,
          type: "DANGLING_EDGE",
          message: `Edge references non-existent source node "${edge.source}"`,
        });
      }
      if (!nodeIds.has(edge.target)) {
        newViolations.push({
          elementId: edge.id,
          type: "DANGLING_EDGE",
          message: `Edge references non-existent target node "${edge.target}"`,
        });
      }
    }

    // Check end event reachability from start (simple BFS)
    if (startNodes.length > 0 && endNodes.length > 0) {
      const visited = new Set<string>();
      const queue = startNodes.map((n) => n.id);
      while (queue.length > 0) {
        const current = queue.shift()!;
        if (visited.has(current)) continue;
        visited.add(current);
        const outgoing = edges.filter((e) => e.source === current);
        for (const e of outgoing) {
          if (!visited.has(e.target)) queue.push(e.target);
        }
      }
      for (const end of endNodes) {
        if (!visited.has(end.id)) {
          newViolations.push({
            elementId: end.id,
            type: "UNREACHABLE_END",
            message: `End event "${end.data?.label || end.id}" is not reachable from start`,
          });
        }
      }
    }

    setViolations(newViolations);
    setHasValidated(true);
  }, [nodes, edges]);

  // GAP-WORKFLOW-DESIGNER-01 / DETAIL-01 — open a deep-linked draft once.
  useEffect(() => {
    if (initialDefinitionId) void onOpen(initialDefinitionId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialDefinitionId]);

  const totalElements = nodes.length + edges.length;

  const canvasHeight = embedded ? 420 : "calc(100vh - 180px)";
  const canvasMinHeight = embedded ? 360 : 500;

  return (
    <div
      className="wf-designer-layout"
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: 12,
        height: canvasHeight,
        minHeight: canvasMinHeight,
      }}
    >
      {/* Left: Palette */}
      <BpmnPalette onAdd={addNodeOfType} />

      {/* Center: React Flow Canvas */}
      <div
        className="rounded-xl overflow-hidden"
        style={{ flex: "1 1 320px", minWidth: 280, minHeight: 320, border: "1px solid var(--line)" }}
        ref={reactFlowWrapper}
      >
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onNodeClick={onNodeClick}
          onPaneClick={onPaneClick}
          onDragOver={onDragOver}
          onDrop={onDrop}
          onInit={setReactFlowInstance}
          nodeTypes={nodeTypes}
          fitView
          deleteKeyCode={["Backspace", "Delete"]}
          aria-label="BPMN workflow canvas"
        >
          <Controls aria-label="Canvas zoom controls" />
          <Background gap={16} size={1} />
          <MiniMap
            nodeStrokeWidth={3}
            zoomable
            pannable
            aria-label="Canvas minimap"
          />
          <Panel position="top-left" className="flex gap-2" style={{ alignItems: "center", flexWrap: "wrap", maxWidth: "70%" }}>
            <label className="sr-only" htmlFor="wf-def-name">Workflow name</label>
            <input
              id="wf-def-name"
              type="text"
              value={definitionName}
              onChange={(e) => { setDefinitionName(e.target.value); setSaveState({ kind: "idle" }); }}
              maxLength={200}
              className="rounded-lg px-2.5 py-1.5 text-xs"
              style={{ background: "var(--panel)", color: "var(--ink)", border: "1px solid var(--line)", minWidth: 160 }}
              placeholder="Workflow name"
            />
            {definitions.length > 0 && (
              <>
                <label className="sr-only" htmlFor="wf-def-open">Open a saved draft</label>
                <select
                  id="wf-def-open"
                  value={definitionId ?? ""}
                  onChange={(e) => void onOpen(e.target.value)}
                  className="rounded-lg px-2.5 py-1.5 text-xs"
                  style={{ background: "var(--panel)", color: "var(--ink)", border: "1px solid var(--line)" }}
                >
                  <option value="">Open draft…</option>
                  {definitions.map((d) => (
                    <option key={d.id} value={d.id}>{d.name}</option>
                  ))}
                </select>
              </>
            )}
            {canAuthor ? (
              <button
                type="button"
                className="rounded-lg px-3 py-1.5 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-blue-500"
                style={{ background: "var(--primary, #00439C)", color: "#fff", border: "1px solid var(--line)" }}
                onClick={() => void onSave()}
                disabled={saveState.kind === "saving"}
              >
                {saveState.kind === "saving" ? "Saving…" : "Save as draft"}
              </button>
            ) : null}
            {saveState.text ? (
              <span
                role={saveState.kind === "err" ? "alert" : "status"}
                aria-live="polite"
                className="text-xs"
                style={{ color: saveState.kind === "err" ? "var(--bad, #b42318)" : "var(--good, #067647)" }}
              >
                {saveState.text}
              </span>
            ) : null}
          </Panel>
          <Panel position="top-right" className="flex gap-2">
            <button
              type="button"
              className="rounded-lg px-3 py-1.5 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-blue-500"
              style={{ background: "var(--panel2, var(--panel))", color: "var(--ink)", border: "1px solid var(--line)" }}
              onClick={onValidate}
              aria-label="Validate workflow graph"
            >
              ✓ Validate
            </button>
            <span
              className="rounded-lg px-3 py-1.5 text-xs"
              style={{ background: "var(--panel2, var(--panel))", color: "var(--ink2)", border: "1px solid var(--line)" }}
              aria-live="polite"
            >
              {totalElements} / {MAX_ELEMENTS} elements
            </span>
          </Panel>
        </ReactFlow>
      </div>

      {/* Right: Property Panel + Validation */}
      <div className="flex flex-col gap-3" style={{ flex: "1 1 260px", minWidth: 240, maxWidth: 340 }}>
        {limitMessage ? (
          <p role="alert" style={{ margin: 0, fontSize: 12.5, color: "var(--bad, #b42318)" }}>{limitMessage}</p>
        ) : null}
        <PropertyPanel
          selectedNode={selectedNode}
          nodes={nodes}
          onLabelChange={onNodeLabelChange}
          onPropertyChange={onNodePropertyChange}
          onConnectTo={connectToNode}
        />
        <ValidationIndicators violations={violations} nodes={nodes} hasValidated={hasValidated} />
      </div>
    </div>
  );
}

function getDefaultLabel(type: BpmnElementType): string {
  switch (type) {
    case "startEvent":
      return "Start";
    case "endEvent":
      return "End";
    case "task":
      return "New Task";
    case "exclusiveGateway":
      return "Decision";
    case "parallelGateway":
      return "Fork/Join";
    case "subProcess":
      return "Sub-Process";
    default:
      return "Element";
  }
}
