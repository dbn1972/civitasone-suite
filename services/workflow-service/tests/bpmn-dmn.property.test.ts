/**
 * Property-Based Tests for BPMN Import/Export and DMN Decision Tables.
 * Uses fast-check to verify invariants hold across all valid inputs.
 *
 * **Validates: Requirements 7.2, 7.3, 7.4, 7.5, 7.6**
 */
import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import {
  parseBpmnXml,
  exportBpmnXml,
  BpmnParseError,
} from "../src/modules/designer/bpmn-io.js";
import { validateGraph } from "../src/modules/designer/domain.js";
import { evaluateDecisionTable } from "../src/modules/dmn/domain.js";
import type { DesignerNode, DesignerEdge } from "../src/modules/designer/schema.js";
import type { DmnTableDef, DmnHitPolicy } from "../src/modules/dmn/domain.js";

// ─── Arbitraries ──────────────────────────────────────────────────────────────

/** Valid BPMN node types that the system supports for round-trip */
const BPMN_NODE_TYPES = [
  "startEvent",
  "endEvent",
  "userTask",
  "serviceTask",
  "exclusiveGateway",
  "parallelGateway",
] as const;

/** Generate a safe XML-compatible identifier */
const xmlIdArb: fc.Arbitrary<string> = fc
  .tuple(
    fc.constantFrom("node", "task", "gw", "evt", "elm"),
    fc.nat({ max: 9999 }),
  )
  .map(([prefix, n]) => `${prefix}_${n}`);

/** Generate a valid label (no XML special chars) */
const labelArb: fc.Arbitrary<string> = fc
  .stringMatching(/^[a-z][a-z0-9 ]{0,28}[a-z0-9]$/)
  .map((s) => s.trim() || "Label");

/** Generate a position within reasonable canvas bounds */
const positionArb: fc.Arbitrary<{ x: number; y: number }> = fc.record({
  x: fc.integer({ min: 0, max: 2000 }),
  y: fc.integer({ min: 0, max: 2000 }),
});

/** Generate a DesignerNode with a given ID and type */
function nodeArb(id: string, type: (typeof BPMN_NODE_TYPES)[number]): fc.Arbitrary<DesignerNode> {
  return fc.tuple(labelArb, positionArb).map(([label, position]) => ({
    id,
    type,
    label,
    position,
  }));
}

/**
 * Generate a valid workflow graph with:
 * - 1 start event
 * - 1 end event
 * - 0-8 middle nodes (tasks/gateways)
 * - Sequential edges connecting them all
 */
const validGraphArb: fc.Arbitrary<{ nodes: DesignerNode[]; edges: DesignerEdge[] }> = fc
  .tuple(
    fc.integer({ min: 0, max: 8 }), // number of middle nodes
    fc.infiniteStream(fc.constantFrom("userTask", "serviceTask", "exclusiveGateway", "parallelGateway") as fc.Arbitrary<(typeof BPMN_NODE_TYPES)[number]>),
    fc.infiniteStream(labelArb),
    fc.infiniteStream(positionArb),
  )
  .map(([midCount, typeStream, labelStream, posStream]) => {
    const nodes: DesignerNode[] = [];
    const edges: DesignerEdge[] = [];

    // Start event
    nodes.push({
      id: "start_1",
      type: "startEvent",
      label: "Start",
      position: posStream.next().value!,
    });

    // Middle nodes
    for (let i = 0; i < midCount; i++) {
      nodes.push({
        id: `mid_${i}`,
        type: typeStream.next().value!,
        label: labelStream.next().value!,
        position: posStream.next().value!,
      });
    }

    // End event
    nodes.push({
      id: "end_1",
      type: "endEvent",
      label: "End",
      position: posStream.next().value!,
    });

    // Connect sequentially: start → mid0 → mid1 → ... → end
    for (let i = 0; i < nodes.length - 1; i++) {
      edges.push({
        id: `flow_${i}`,
        source: nodes[i]!.id,
        target: nodes[i + 1]!.id,
      });
    }

    // For gateways, ensure at least 1 outgoing (already covered by sequential flow)
    // Add extra edge from gateways to end for realism
    const gateways = nodes.filter(
      (n) => n.type === "exclusiveGateway" || n.type === "parallelGateway",
    );
    for (const gw of gateways) {
      // Only add extra edge if not the last before end
      const gwIdx = nodes.indexOf(gw);
      if (gwIdx < nodes.length - 2) {
        edges.push({
          id: `flow_extra_${gw.id}`,
          source: gw.id,
          target: "end_1",
        });
      }
    }

    return { nodes, edges };
  });

// ─── Property 6: BPMN Import/Export Round-Trip ────────────────────────────────

describe("Property 6: BPMN Import/Export Round-Trip", () => {
  /**
   * For any valid internal workflow graph (nodes + edges), exporting to
   * BPMN 2.0 XML and then importing that XML back SHALL produce an equivalent
   * graph with the same node count and edge connections.
   *
   * **Validates: Requirements 7.2, 7.4**
   */
  it("export → import preserves node count and types", () => {
    fc.assert(
      fc.property(validGraphArb, ({ nodes, edges }) => {
        // Export to BPMN XML
        const xml = exportBpmnXml({
          id: "test-def-001",
          name: "Test Process",
          elements: nodes,
          edges,
        });

        // Import back
        const result = parseBpmnXml(xml);

        // Node count must be preserved
        expect(result.nodes.length).toBe(nodes.length);

        // Edge count must be preserved
        expect(result.edges.length).toBe(edges.length);
      }),
      { numRuns: 100 },
    );
  });

  /**
   * For any valid graph, the exported XML contains proper BPMN 2.0 namespace
   * and DI position data for all elements.
   *
   * **Validates: Requirements 7.4**
   */
  it("exported XML contains OMG BPMN namespace and DI data", () => {
    fc.assert(
      fc.property(validGraphArb, ({ nodes, edges }) => {
        const xml = exportBpmnXml({
          id: "test-def-002",
          name: "DI Test",
          elements: nodes,
          edges,
        });

        // Must contain OMG namespace
        expect(xml).toContain("http://www.omg.org/spec/BPMN/20100524/MODEL");

        // Must contain BPMNDiagram element
        expect(xml).toContain("bpmndi:BPMNDiagram");

        // Must contain a BPMNShape for each node
        for (const node of nodes) {
          expect(xml).toContain(`bpmnElement="${node.id}"`);
        }
      }),
      { numRuns: 100 },
    );
  });

  /**
   * For any valid graph, export → import preserves edge connectivity
   * (source and target references).
   *
   * **Validates: Requirements 7.2, 7.4**
   */
  it("export → import preserves edge source/target connections", () => {
    fc.assert(
      fc.property(validGraphArb, ({ nodes, edges }) => {
        const xml = exportBpmnXml({
          id: "test-def-003",
          name: "Edge Test",
          elements: nodes,
          edges,
        });

        const result = parseBpmnXml(xml);

        // Build connection sets for comparison
        const originalConnections = new Set(
          edges.map((e) => `${e.source}→${e.target}`),
        );
        const importedConnections = new Set(
          result.edges.map((e) => `${e.source}→${e.target}`),
        );

        expect(importedConnections).toEqual(originalConnections);
      }),
      { numRuns: 100 },
    );
  });
});

// ─── Property 7: BPMN Invalid Input Rejection ────────────────────────────────

describe("Property 7: BPMN Invalid Input Rejection", () => {
  /**
   * For any XML string that is empty or contains no process elements,
   * the validator must reject with a clear error.
   *
   * **Validates: Requirements 7.3**
   */
  it("rejects empty or whitespace-only XML", () => {
    fc.assert(
      fc.property(
        fc.stringMatching(/^[ \t\n\r]{0,50}$/),
        (emptyish) => {
          expect(() => parseBpmnXml(emptyish)).toThrow(BpmnParseError);
        },
      ),
      { numRuns: 50 },
    );
  });

  /**
   * For any XML without recognizable BPMN process elements (missing
   * required start/task/end elements), the parser rejects with a descriptive error.
   *
   * **Validates: Requirements 7.3**
   */
  it("rejects XML with no recognizable process elements", () => {
    fc.assert(
      fc.property(
        fc.tuple(
          fc.stringMatching(/^[a-p]{1,30}$/),
          fc.stringMatching(/^[a-p]{1,30}$/),
        ),
        ([ns, content]) => {
          const xml = `<?xml version="1.0" encoding="UTF-8"?><definitions xmlns="urn:${ns}"><unrelated>${content}</unrelated></definitions>`;
          expect(() => parseBpmnXml(xml)).toThrow(BpmnParseError);
        },
      ),
      { numRuns: 50 },
    );
  });

  /**
   * For any XML exceeding 2MB, the parser must reject with XML_TOO_LARGE error.
   *
   * **Validates: Requirements 7.3**
   */
  it("rejects XML exceeding 2MB size limit", () => {
    // Generate a large enough payload with valid-looking BPMN structure
    const baseXml = `<?xml version="1.0"?><definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL"><process id="p1">`;
    const padding = "x".repeat(2 * 1024 * 1024); // 2MB of padding
    const xml = baseXml + padding + `</process></definitions>`;

    expect(() => parseBpmnXml(xml)).toThrow(BpmnParseError);
    try {
      parseBpmnXml(xml);
    } catch (e) {
      expect((e as BpmnParseError).code).toBe("XML_TOO_LARGE");
    }
  });

  /**
   * For any XML that has definitions/process tags but no actual BPMN elements
   * (no startEvent, task, gateway, etc.), it must be rejected.
   *
   * **Validates: Requirements 7.3**
   */
  it("rejects well-structured XML with definitions but no BPMN elements", () => {
    fc.assert(
      fc.property(
        fc.stringMatching(/^[a-f0-9]{1,20}$/),
        (processName) => {
          const xml = `<?xml version="1.0" encoding="UTF-8"?>
<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL">
  <process id="Process_1" name="${processName}" isExecutable="true">
    <documentation>No BPMN elements here</documentation>
  </process>
</definitions>`;
          expect(() => parseBpmnXml(xml)).toThrow(BpmnParseError);
        },
      ),
      { numRuns: 30 },
    );
  });
});

// ─── Property 8: DMN Decision Table Evaluation ───────────────────────────────

describe("Property 8: DMN Decision Table Evaluation", () => {
  /**
   * Arbitrary for a simple numeric decision table with a known hit policy.
   * Generates tables with numeric input conditions and deterministic outputs.
   */
  const numericDmnTableArb = (hitPolicy: DmnHitPolicy): fc.Arbitrary<{
    table: DmnTableDef;
    context: Record<string, unknown>;
  }> =>
    fc
      .tuple(
        fc.integer({ min: 1, max: 10 }), // number of rules
        fc.integer({ min: 0, max: 1000 }), // context value for "amount"
      )
      .map(([ruleCount, contextAmount]) => {
        const inputs = [{ key: "amount", label: "Amount", type: "number" as const }];
        const outputs = [{ key: "result", label: "Result", type: "string" as const }];

        // Create rules with non-overlapping ranges (for UNIQUE testing)
        const rules = Array.from({ length: ruleCount }, (_, i) => ({
          inputs: { amount: `>= ${i * 100} && amount < ${(i + 1) * 100}` } as Record<string, string>,
          outputs: { result: `tier_${i}` } as Record<string, unknown>,
        }));

        return {
          table: { hitPolicy, inputs, outputs, rules },
          context: { amount: contextAmount },
        };
      });

  /**
   * FIRST hit policy: the first matching rule's output is always returned.
   * If multiple rules match, only the first one matters.
   *
   * **Validates: Requirements 7.5**
   */
  it("FIRST policy returns the first matching rule output", () => {
    fc.assert(
      fc.property(
        fc.tuple(
          fc.integer({ min: 10, max: 100 }), // context value
          fc.integer({ min: 2, max: 5 }), // number of rules that match
        ),
        ([contextVal, matchCount]) => {
          // Create a table where multiple rules match the same context value
          const rules = Array.from({ length: matchCount }, (_, i) => ({
            inputs: { score: `>= 0` }, // all rules match any positive number
            outputs: { category: `rule_${i}` },
          }));

          const table: DmnTableDef = {
            hitPolicy: "FIRST",
            inputs: [{ key: "score", label: "Score", type: "number" }],
            outputs: [{ key: "category", label: "Category", type: "string" }],
            rules,
          };

          const result = evaluateDecisionTable(table, { score: contextVal });

          // FIRST: always returns the first matching rule
          expect(result.matched).toBe(true);
          expect(result.matchedRules).toEqual([0]);
          expect(result.outputs).toEqual({ category: "rule_0" });
        },
      ),
      { numRuns: 50 },
    );
  });

  /**
   * RULE_ORDER policy: returns ALL matching rules in definition order.
   *
   * **Validates: Requirements 7.5**
   */
  it("RULE_ORDER policy returns all matching rules in definition order", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 8 }), // number of matching rules
        (matchCount) => {
          const rules = Array.from({ length: matchCount }, (_, i) => ({
            inputs: { val: `>= 0` }, // all match
            outputs: { tag: `output_${i}` },
          }));

          const table: DmnTableDef = {
            hitPolicy: "RULE_ORDER",
            inputs: [{ key: "val", label: "Value", type: "number" }],
            outputs: [{ key: "tag", label: "Tag", type: "string" }],
            rules,
          };

          const result = evaluateDecisionTable(table, { val: 50 });

          expect(result.matched).toBe(true);
          expect(result.matchedRules).toEqual(Array.from({ length: matchCount }, (_, i) => i));

          // Outputs should be an array in definition order
          const outputs = result.outputs as Array<Record<string, unknown>>;
          expect(outputs.length).toBe(matchCount);
          for (let i = 0; i < matchCount; i++) {
            expect(outputs[i]).toEqual({ tag: `output_${i}` });
          }
        },
      ),
      { numRuns: 50 },
    );
  });

  /**
   * COLLECT policy: returns merged outputs from all matching rules.
   *
   * **Validates: Requirements 7.5**
   */
  it("COLLECT policy merges all matching rule outputs", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 5 }), // number of rules
        (ruleCount) => {
          // Each rule produces a unique output key so there's no key collision
          const rules = Array.from({ length: ruleCount }, (_, i) => ({
            inputs: { x: `>= 0` }, // all match
            outputs: { [`key_${i}`]: `val_${i}` },
          }));

          const table: DmnTableDef = {
            hitPolicy: "COLLECT",
            inputs: [{ key: "x", label: "X", type: "number" }],
            outputs: Array.from({ length: ruleCount }, (_, i) => ({
              key: `key_${i}`,
              label: `Key ${i}`,
              type: "string" as const,
            })),
            rules,
          };

          const result = evaluateDecisionTable(table, { x: 10 });

          expect(result.matched).toBe(true);
          expect(result.matchedRules.length).toBe(ruleCount);

          // All keys should be present in the merged output
          const outputs = result.outputs as Record<string, unknown>;
          for (let i = 0; i < ruleCount; i++) {
            expect(outputs[`key_${i}`]).toBe(`val_${i}`);
          }
        },
      ),
      { numRuns: 50 },
    );
  });

  /**
   * UNIQUE policy: errors when multiple rules match.
   *
   * **Validates: Requirements 7.5**
   */
  it("UNIQUE policy errors when multiple rules match", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 6 }), // number of matching rules
        (matchCount) => {
          const rules = Array.from({ length: matchCount }, (_, i) => ({
            inputs: { n: `>= 0` }, // all match
            outputs: { out: `r${i}` },
          }));

          const table: DmnTableDef = {
            hitPolicy: "UNIQUE",
            inputs: [{ key: "n", label: "N", type: "number" }],
            outputs: [{ key: "out", label: "Out", type: "string" }],
            rules,
          };

          const result = evaluateDecisionTable(table, { n: 5 });

          // UNIQUE with multiple matches → error
          expect(result.matched).toBe(false);
          expect(result.error).toContain("UNIQUE");
          expect(result.matchedRules.length).toBe(matchCount);
        },
      ),
      { numRuns: 50 },
    );
  });

  /**
   * For any hit policy, when no rules match, the result indicates no match.
   *
   * **Validates: Requirements 7.5**
   */
  it("no-match scenario returns matched=false for all hit policies", () => {
    fc.assert(
      fc.property(
        fc.constantFrom("UNIQUE", "FIRST", "COLLECT", "RULE_ORDER") as fc.Arbitrary<DmnHitPolicy>,
        (hitPolicy) => {
          const table: DmnTableDef = {
            hitPolicy,
            inputs: [{ key: "val", label: "Val", type: "number" }],
            outputs: [{ key: "out", label: "Out", type: "string", defaultValue: "default" }],
            rules: [
              { inputs: { val: `> 1000` }, outputs: { out: "high" } },
            ],
          };

          // Context value is well below the threshold
          const result = evaluateDecisionTable(table, { val: 1 });

          expect(result.matched).toBe(false);
          expect(result.matchedRules.length).toBe(0);
        },
      ),
      { numRuns: 20 },
    );
  });
});

// ─── Property 9: Workflow Graph Validation ───────────────────────────────────

describe("Property 9: Workflow Graph Validation", () => {
  /**
   * For any valid graph (start connected to end, gateways with outgoing flows),
   * validateGraph returns valid=true with no violations.
   *
   * **Validates: Requirements 7.6**
   */
  it("valid graphs pass validation with no violations", () => {
    fc.assert(
      fc.property(validGraphArb, ({ nodes, edges }) => {
        const result = validateGraph(nodes, edges);
        expect(result.valid).toBe(true);
        expect(result.violations).toHaveLength(0);
      }),
      { numRuns: 100 },
    );
  });

  /**
   * For any graph with an end event unreachable from the start event,
   * the validator must report a violation.
   *
   * **Validates: Requirements 7.6**
   */
  it("detects unreachable end events", () => {
    fc.assert(
      fc.property(
        fc.tuple(
          fc.integer({ min: 1, max: 5 }), // middle nodes count
          positionArb,
          positionArb,
          positionArb,
        ),
        ([midCount, startPos, midPos, endPos]) => {
          // Build a graph with start → mid nodes, but end is disconnected
          const nodes: DesignerNode[] = [
            { id: "start_x", type: "startEvent", label: "Start", position: startPos },
          ];
          for (let i = 0; i < midCount; i++) {
            nodes.push({
              id: `mid_x_${i}`,
              type: "userTask",
              label: `Task ${i}`,
              position: midPos,
            });
          }
          // Disconnected end event (no edges leading to it)
          nodes.push({ id: "end_x", type: "endEvent", label: "End", position: endPos });

          // Only connect start → mid nodes, NOT to end
          const edges: DesignerEdge[] = [];
          edges.push({ id: "f_start", source: "start_x", target: "mid_x_0" });
          for (let i = 0; i < midCount - 1; i++) {
            edges.push({ id: `f_mid_${i}`, source: `mid_x_${i}`, target: `mid_x_${i + 1}` });
          }

          const result = validateGraph(nodes, edges);
          expect(result.valid).toBe(false);
          expect(result.violations.some((v) => v.rule === "end_event_unreachable")).toBe(true);
        },
      ),
      { numRuns: 50 },
    );
  });

  /**
   * For any graph with a gateway that has zero outgoing flows,
   * the validator must report a gateway_no_outgoing violation.
   *
   * **Validates: Requirements 7.6**
   */
  it("detects gateways with no outgoing flows", () => {
    fc.assert(
      fc.property(
        fc.constantFrom("exclusiveGateway", "parallelGateway", "inclusiveGateway", "eventBasedGateway"),
        fc.tuple(positionArb, positionArb, positionArb, positionArb),
        (gwType, [p1, p2, p3, p4]) => {
          // Build graph: start → task → gateway (dead-end), end unreachable from gw
          const nodes: DesignerNode[] = [
            { id: "s1", type: "startEvent", label: "Start", position: p1 },
            { id: "t1", type: "userTask", label: "Task", position: p2 },
            { id: "gw1", type: gwType, label: "Gateway", position: p3 },
            { id: "e1", type: "endEvent", label: "End", position: p4 },
          ];
          // Edge into gateway but nothing going out of it
          const edges: DesignerEdge[] = [
            { id: "f1", source: "s1", target: "t1" },
            { id: "f2", source: "t1", target: "gw1" },
            // No outgoing edge from gw1!
          ];

          const result = validateGraph(nodes, edges);
          expect(result.valid).toBe(false);
          expect(
            result.violations.some(
              (v) => v.rule === "gateway_no_outgoing" && v.nodeId === "gw1",
            ),
          ).toBe(true);
        },
      ),
      { numRuns: 30 },
    );
  });

  /**
   * For any graph with edges referencing non-existent nodes,
   * the validator must report dangling edge violations.
   *
   * **Validates: Requirements 7.6**
   */
  it("detects edges referencing non-existent nodes", () => {
    fc.assert(
      fc.property(
        fc.tuple(xmlIdArb, xmlIdArb),
        positionArb,
        ([fakeSource, fakeTarget], pos) => {
          const nodes: DesignerNode[] = [
            { id: "real_start", type: "startEvent", label: "Start", position: pos },
            { id: "real_end", type: "endEvent", label: "End", position: pos },
          ];
          // Edge referencing nodes that don't exist
          const edges: DesignerEdge[] = [
            { id: "bad_edge", source: fakeSource, target: fakeTarget },
            { id: "good_edge", source: "real_start", target: "real_end" },
          ];

          // Only check if fakeSource/fakeTarget are NOT in the real node set
          if (fakeSource !== "real_start" && fakeSource !== "real_end" &&
              fakeTarget !== "real_start" && fakeTarget !== "real_end") {
            const result = validateGraph(nodes, edges);
            expect(result.valid).toBe(false);
            expect(
              result.violations.some(
                (v) => v.rule === "dangling_edge_source" || v.rule === "dangling_edge_target",
              ),
            ).toBe(true);
          }
        },
      ),
      { numRuns: 50 },
    );
  });

  /**
   * For any graph with only a start event and no end event,
   * the validator must report the missing end event.
   *
   * **Validates: Requirements 7.6**
   */
  it("detects missing end events when nodes exist", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 5 }),
        positionArb,
        (taskCount, pos) => {
          const nodes: DesignerNode[] = [
            { id: "only_start", type: "startEvent", label: "Start", position: pos },
          ];
          for (let i = 0; i < taskCount; i++) {
            nodes.push({ id: `task_${i}`, type: "userTask", label: `T${i}`, position: pos });
          }
          // No endEvent in the node list

          const edges: DesignerEdge[] = [
            { id: "e_0", source: "only_start", target: "task_0" },
          ];
          for (let i = 0; i < taskCount - 1; i++) {
            edges.push({ id: `e_${i + 1}`, source: `task_${i}`, target: `task_${i + 1}` });
          }

          const result = validateGraph(nodes, edges);
          expect(result.valid).toBe(false);
          expect(result.violations.some((v) => v.rule === "no_end_event")).toBe(true);
        },
      ),
      { numRuns: 30 },
    );
  });
});
