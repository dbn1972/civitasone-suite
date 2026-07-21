/**
 * BPMN 2.0 Import/Export with auto-layout for the visual designer.
 *
 * - parseBpmnXml(xml): parses BPMN 2.0 XML (max 2MB), extracts process elements
 *   and DI positions. Regex-based (no XML DOM dependency).
 * - autoLayout(nodes): Dagre-style layered layout when DI data is absent.
 * - exportBpmnXml(definition): generates BPMN 2.0 XML conforming to OMG schema
 *   with DI position data for all elements.
 *
 * Requirements: 7.2, 7.3, 7.4
 */

import type { DesignerNode, DesignerEdge } from "./schema.js";

/** Maximum allowed XML size: 2 MB */
const MAX_XML_BYTES = 2 * 1024 * 1024;

/** Layout constants for Dagre-style layered layout */
const LAYER_SPACING_X = 200;
const NODE_SPACING_Y = 120;
const INITIAL_OFFSET_X = 100;
const INITIAL_OFFSET_Y = 100;
const NODE_WIDTH = 120;
const NODE_HEIGHT = 80;

// ── Types ─────────────────────────────────────────────────────────

export interface ParsedBpmnResult {
  nodes: DesignerNode[];
  edges: DesignerEdge[];
  processId: string;
  processName: string;
}

export interface BpmnExportInput {
  id: string;
  name: string;
  elements: DesignerNode[];
  edges: DesignerEdge[];
}

// ── BPMN XML Parsing ──────────────────────────────────────────────

const BPMN_NODE_TYPES: Array<{ tag: string; type: string }> = [
  { tag: "startEvent", type: "startEvent" },
  { tag: "endEvent", type: "endEvent" },
  { tag: "userTask", type: "userTask" },
  { tag: "serviceTask", type: "serviceTask" },
  { tag: "scriptTask", type: "serviceTask" },
  { tag: "sendTask", type: "serviceTask" },
  { tag: "receiveTask", type: "serviceTask" },
  { tag: "manualTask", type: "userTask" },
  { tag: "businessRuleTask", type: "serviceTask" },
  { tag: "exclusiveGateway", type: "exclusiveGateway" },
  { tag: "parallelGateway", type: "parallelGateway" },
  { tag: "inclusiveGateway", type: "exclusiveGateway" },
  { tag: "eventBasedGateway", type: "exclusiveGateway" },
  { tag: "intermediateCatchEvent", type: "intermediateEvent" },
  { tag: "intermediateThrowEvent", type: "intermediateEvent" },
  { tag: "task", type: "userTask" },
  { tag: "subProcess", type: "userTask" },
  { tag: "callActivity", type: "serviceTask" },
];

/**
 * Parse BPMN 2.0 XML, extract nodes and edges with DI positions when available.
 * Rejects malformed, oversized, or empty XML with descriptive errors.
 */
export function parseBpmnXml(xml: string): ParsedBpmnResult {
  // Validate input
  if (!xml || xml.trim().length === 0) {
    throw new BpmnParseError("EMPTY_XML", "BPMN XML content is empty");
  }

  const byteLength = Buffer.byteLength(xml, "utf8");
  if (byteLength > MAX_XML_BYTES) {
    throw new BpmnParseError(
      "XML_TOO_LARGE",
      `BPMN XML exceeds maximum size of 2 MB (received ${Math.round(byteLength / 1024)} KB)`,
    );
  }

  // Basic well-formedness check: must contain <definitions or a process element
  if (!/<definitions[\s>]/i.test(xml) && !/<process[\s>]/i.test(xml)) {
    throw new BpmnParseError(
      "MALFORMED_XML",
      "BPMN XML is malformed: missing <definitions> or <process> root element",
    );
  }

  // Extract process metadata
  const processIdMatch = xml.match(/<(?:bpmn2?:)?process[^>]*\bid="([^"]*)"/);
  const processNameMatch = xml.match(/<(?:bpmn2?:)?process[^>]*\bname="([^"]*)"/);
  const processId = processIdMatch?.[1] ?? "Process_1";
  const processName = processNameMatch?.[1] ?? processId;

  // Extract DI positions (BPMNShape elements)
  const diPositions = extractDiPositions(xml);

  // Extract nodes
  const nodes: DesignerNode[] = [];
  const seenIds = new Set<string>();

  for (const { tag, type } of BPMN_NODE_TYPES) {
    // Match elements with id attribute — handles both bpmn: and non-prefixed tags
    const re = new RegExp(
      `<(?:bpmn2?:)?${tag}\\b([^>]*)(?:\\/>|>)`,
      "g",
    );
    let m: RegExpExecArray | null;
    while ((m = re.exec(xml)) !== null) {
      const attrs = m[1]!;
      const id = extractAttr(attrs, "id");
      if (!id || seenIds.has(id)) continue;
      seenIds.add(id);

      const name = extractAttr(attrs, "name") ?? tag;
      const diPos = diPositions.get(id);

      nodes.push({
        id,
        type,
        label: name,
        position: diPos ?? { x: 0, y: 0 },
      });
    }
  }

  // Extract sequence flows (edges)
  const edges: DesignerEdge[] = [];
  const flowRe = /(<(?:bpmn2?:)?sequenceFlow\b([^>]*)(?:\/>|>))/g;
  let fm: RegExpExecArray | null;
  while ((fm = flowRe.exec(xml)) !== null) {
    const attrs = fm[2]!;
    const id = extractAttr(attrs, "id");
    const source = extractAttr(attrs, "sourceRef");
    const target = extractAttr(attrs, "targetRef");
    if (!id || !source || !target) continue;

    const label = extractAttr(attrs, "name");
    // Extract DI waypoints for this edge
    const waypoints = extractEdgeWaypoints(xml, id);

    edges.push({
      id,
      source,
      target,
      ...(label != null ? { label } : {}),
      ...(waypoints.length > 0 ? { waypoints } : {}),
    });
  }

  // Must have at least one process element
  if (nodes.length === 0) {
    throw new BpmnParseError(
      "NO_PROCESS_ELEMENTS",
      "BPMN XML contains no recognizable process elements (tasks, events, gateways)",
    );
  }

  // If no DI data was present, apply auto-layout
  const hasDiData = diPositions.size > 0;
  if (!hasDiData) {
    const layoutNodes = autoLayout(nodes, edges);
    // Update positions in-place
    for (const ln of layoutNodes) {
      const existing = nodes.find((n) => n.id === ln.id);
      if (existing) existing.position = ln.position;
    }
  }

  return { nodes, edges, processId, processName };
}

// ── DI Position Extraction ────────────────────────────────────────

function extractDiPositions(xml: string): Map<string, { x: number; y: number }> {
  const positions = new Map<string, { x: number; y: number }>();

  // Match BPMNShape elements with Bounds
  // Pattern: <bpmndi:BPMNShape bpmnElement="..." > <dc:Bounds x="..." y="..." ... /> </bpmndi:BPMNShape>
  const shapeRe = /<(?:bpmndi:)?BPMNShape\b[^>]*bpmnElement="([^"]*)"[^>]*>([\s\S]*?)<\/(?:bpmndi:)?BPMNShape>/g;
  let sm: RegExpExecArray | null;
  while ((sm = shapeRe.exec(xml)) !== null) {
    const elementId = sm[1]!;
    const shapeContent = sm[2]!;

    // Extract Bounds x, y
    const boundsMatch = shapeContent.match(/<(?:dc:)?Bounds\b[^>]*(?:x="([^"]*)"[^>]*y="([^"]*)")/);
    if (boundsMatch) {
      const x = parseFloat(boundsMatch[1]!);
      const y = parseFloat(boundsMatch[2]!);
      if (!isNaN(x) && !isNaN(y)) {
        positions.set(elementId, { x, y });
      }
    }
  }

  return positions;
}

function extractEdgeWaypoints(xml: string, edgeId: string): Array<{ x: number; y: number }> {
  const waypoints: Array<{ x: number; y: number }> = [];

  // Find BPMNEdge with matching bpmnElement
  const edgeRe = new RegExp(
    `<(?:bpmndi:)?BPMNEdge\\b[^>]*bpmnElement="${escapeRegex(edgeId)}"[^>]*>([\\s\\S]*?)<\\/(?:bpmndi:)?BPMNEdge>`,
  );
  const em = edgeRe.exec(xml);
  if (!em) return waypoints;

  const edgeContent = em[1]!;
  const wpRe = /<(?:di:)?waypoint\b[^>]*x="([^"]*)"[^>]*y="([^"]*)"/g;
  let wm: RegExpExecArray | null;
  while ((wm = wpRe.exec(edgeContent)) !== null) {
    const x = parseFloat(wm[1]!);
    const y = parseFloat(wm[2]!);
    if (!isNaN(x) && !isNaN(y)) {
      waypoints.push({ x, y });
    }
  }

  return waypoints;
}

// ── Auto-Layout (Dagre-style layered) ─────────────────────────────

/**
 * Dagre-style layered layout: assigns x/y positions to nodes in topological layers.
 * Nodes are arranged left-to-right by dependency order.
 * Returns new array of nodes with updated positions.
 */
export function autoLayout(
  nodes: DesignerNode[],
  edges?: DesignerEdge[],
): DesignerNode[] {
  if (nodes.length === 0) return [];

  const edgeList = edges ?? [];
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));

  // Build adjacency and in-degree
  const inDegree = new Map<string, number>();
  const outgoing = new Map<string, string[]>();
  for (const node of nodes) {
    inDegree.set(node.id, 0);
    outgoing.set(node.id, []);
  }
  for (const edge of edgeList) {
    if (nodeMap.has(edge.source) && nodeMap.has(edge.target)) {
      outgoing.get(edge.source)!.push(edge.target);
      inDegree.set(edge.target, (inDegree.get(edge.target) ?? 0) + 1);
    }
  }

  // Topological layering via Kahn's algorithm
  const layers: string[][] = [];
  const queue: string[] = [];

  // Start with nodes that have no incoming edges
  for (const [nodeId, deg] of inDegree) {
    if (deg === 0) queue.push(nodeId);
  }

  const assigned = new Set<string>();
  while (queue.length > 0) {
    const layer = [...queue];
    layers.push(layer);
    queue.length = 0;

    for (const nodeId of layer) {
      assigned.add(nodeId);
      for (const target of outgoing.get(nodeId) ?? []) {
        const newDeg = (inDegree.get(target) ?? 1) - 1;
        inDegree.set(target, newDeg);
        if (newDeg === 0) queue.push(target);
      }
    }
  }

  // Handle nodes in cycles or disconnected (not yet assigned)
  const remaining = nodes.filter((n) => !assigned.has(n.id));
  if (remaining.length > 0) {
    layers.push(remaining.map((n) => n.id));
  }

  // Assign positions: layers along X-axis, nodes within a layer along Y-axis
  const result: DesignerNode[] = [];
  for (let layerIdx = 0; layerIdx < layers.length; layerIdx++) {
    const layer = layers[layerIdx]!;
    for (let nodeIdx = 0; nodeIdx < layer.length; nodeIdx++) {
      const nodeId = layer[nodeIdx]!;
      const original = nodeMap.get(nodeId)!;
      result.push({
        ...original,
        position: {
          x: INITIAL_OFFSET_X + layerIdx * LAYER_SPACING_X,
          y: INITIAL_OFFSET_Y + nodeIdx * NODE_SPACING_Y,
        },
      });
    }
  }

  return result;
}

// ── BPMN XML Export ───────────────────────────────────────────────

/**
 * Generate BPMN 2.0 XML conforming to OMG schema with DI position data.
 * Namespace: http://www.omg.org/spec/BPMN/20100524/MODEL
 */
export function exportBpmnXml(definition: BpmnExportInput): string {
  const processId = `Process_${definition.id.slice(0, 8)}`;
  const processName = esc(definition.name);
  const diagramId = `BPMNDiagram_1`;
  const planeId = `BPMNPlane_1`;

  // Build process elements
  let processXml = "";
  for (const node of definition.elements) {
    const bpmnTag = mapNodeTypeToBpmnTag(node.type);
    processXml += `    <${bpmnTag} id="${esc(node.id)}" name="${esc(node.label)}" />\n`;
  }

  // Build sequence flows
  for (const edge of definition.edges) {
    processXml += `    <sequenceFlow id="${esc(edge.id)}" sourceRef="${esc(edge.source)}" targetRef="${esc(edge.target)}"`;
    if (edge.label) processXml += ` name="${esc(edge.label)}"`;
    processXml += ` />\n`;
  }

  // Build DI data (BPMNDiagram section)
  let diXml = "";
  for (const node of definition.elements) {
    const shapeId = `${node.id}_di`;
    const { width, height } = getNodeDimensions(node.type);
    diXml += `      <bpmndi:BPMNShape id="${esc(shapeId)}" bpmnElement="${esc(node.id)}">\n`;
    diXml += `        <dc:Bounds x="${node.position.x}" y="${node.position.y}" width="${width}" height="${height}" />\n`;
    diXml += `      </bpmndi:BPMNShape>\n`;
  }

  for (const edge of definition.edges) {
    const edgeDiId = `${edge.id}_di`;
    diXml += `      <bpmndi:BPMNEdge id="${esc(edgeDiId)}" bpmnElement="${esc(edge.id)}">\n`;
    if (edge.waypoints && edge.waypoints.length > 0) {
      for (const wp of edge.waypoints) {
        diXml += `        <di:waypoint x="${wp.x}" y="${wp.y}" />\n`;
      }
    } else {
      // Generate default waypoints from source/target positions
      const sourceNode = definition.elements.find((n) => n.id === edge.source);
      const targetNode = definition.elements.find((n) => n.id === edge.target);
      if (sourceNode && targetNode) {
        const { width: sw, height: sh } = getNodeDimensions(sourceNode.type);
        const { height: th } = getNodeDimensions(targetNode.type);
        diXml += `        <di:waypoint x="${sourceNode.position.x + sw}" y="${sourceNode.position.y + sh / 2}" />\n`;
        diXml += `        <di:waypoint x="${targetNode.position.x}" y="${targetNode.position.y + th / 2}" />\n`;
      }
    }
    diXml += `      </bpmndi:BPMNEdge>\n`;
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL"
  xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
  xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"
  xmlns:di="http://www.omg.org/spec/DD/20100524/DI"
  targetNamespace="https://civitasone.in/bpmn"
  id="Definitions_1">
  <process id="${processId}" name="${processName}" isExecutable="true">
${processXml}  </process>
  <bpmndi:BPMNDiagram id="${diagramId}">
    <bpmndi:BPMNPlane id="${planeId}" bpmnElement="${processId}">
${diXml}    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</definitions>`;
}

// ── Helpers ───────────────────────────────────────────────────────

function extractAttr(attrs: string, name: string): string | null {
  const re = new RegExp(`${name}="([^"]*)"`, "i");
  const m = re.exec(attrs);
  return m?.[1] ?? null;
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function mapNodeTypeToBpmnTag(type: string): string {
  switch (type) {
    case "startEvent": return "startEvent";
    case "endEvent": return "endEvent";
    case "userTask": return "userTask";
    case "serviceTask": return "serviceTask";
    case "exclusiveGateway": return "exclusiveGateway";
    case "parallelGateway": return "parallelGateway";
    case "inclusiveGateway": return "inclusiveGateway";
    case "eventBasedGateway": return "eventBasedGateway";
    case "intermediateEvent": return "intermediateCatchEvent";
    default: return "task";
  }
}

function getNodeDimensions(type: string): { width: number; height: number } {
  switch (type) {
    case "startEvent":
    case "endEvent":
    case "intermediateEvent":
      return { width: 36, height: 36 };
    case "exclusiveGateway":
    case "parallelGateway":
    case "inclusiveGateway":
    case "eventBasedGateway":
      return { width: 50, height: 50 };
    default:
      return { width: NODE_WIDTH, height: NODE_HEIGHT };
  }
}

// ── Error Class ───────────────────────────────────────────────────

export class BpmnParseError extends Error {
  constructor(public code: string, message: string) {
    super(message);
    this.name = "BpmnParseError";
  }
}
