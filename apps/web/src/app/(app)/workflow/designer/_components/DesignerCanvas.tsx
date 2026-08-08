"use client";

import {
  useCallback,
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

export function DesignerCanvas({ definitions: _definitions, seedGraph, embedded = false }: Props) {
  const reactFlowWrapper = useRef<HTMLDivElement>(null);
  const [reactFlowInstance, setReactFlowInstance] = useState<ReactFlowInstance | null>(null);
  const seeded = useMemo(() => seedToFlow(seedGraph), [seedGraph]);
  const [nodes, setNodes, onNodesChange] = useNodesState(seeded.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(seeded.edges);
  const [selectedNode, setSelectedNode] = useState<Node | null>(null);
  const [violations, setViolations] = useState<DesignerViolation[]>([]);
  const [definitionId, setDefinitionId] = useState<string | null>(null);
  const [definitionName, setDefinitionName] = useState(seedGraph?.name ?? "Untitled Process");

  const onConnect = useCallback(
    (connection: Connection) => {
      setEdges((eds) => addEdge({ ...connection, animated: true }, eds));
    },
    [setEdges],
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

      setNodes((nds) => [...nds, newNode]);
    },
    [reactFlowInstance, setNodes],
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
  }, [nodes, edges]);

  const totalElements = nodes.length + edges.length;

  const canvasHeight = embedded ? 420 : "calc(100vh - 180px)";
  const canvasMinHeight = embedded ? 360 : 500;

  return (
    <div className="flex gap-3" style={{ height: canvasHeight, minHeight: canvasMinHeight }}>
      {/* Left: Palette */}
      <BpmnPalette />

      {/* Center: React Flow Canvas */}
      <div className="flex-1 rounded-xl border border-slate-200 overflow-hidden" ref={reactFlowWrapper}>
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
          <Panel position="top-right" className="flex gap-2">
            <button
              type="button"
              className="rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
              onClick={onValidate}
              aria-label="Validate workflow graph"
            >
              ✓ Validate
            </button>
            <span className="rounded-lg bg-slate-100 px-3 py-1.5 text-xs text-slate-500" aria-live="polite">
              {totalElements} / 500 elements
            </span>
          </Panel>
        </ReactFlow>
      </div>

      {/* Right: Property Panel + Validation */}
      <div className="w-72 shrink-0 flex flex-col gap-3">
        <PropertyPanel
          selectedNode={selectedNode}
          onLabelChange={onNodeLabelChange}
          onPropertyChange={onNodePropertyChange}
        />
        <ValidationIndicators violations={violations} nodes={nodes} />
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
