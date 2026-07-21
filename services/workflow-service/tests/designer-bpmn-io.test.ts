/**
 * Tests for BPMN import/export with auto-layout (Task 8.2).
 * Validates Requirements 7.2, 7.3, 7.4.
 *
 * Covers:
 *   - Import valid BPMN → elements/edges extracted
 *   - Import without DI → auto-layout applied
 *   - Reject oversized XML (>2MB)
 *   - Reject malformed XML
 *   - Export round-trip (import → export → import produces equivalent graph)
 *   - Route-level tests: POST import, GET export
 */
import { describe, it, expect, afterAll, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import {
  parseBpmnXml,
  autoLayout,
  exportBpmnXml,
  BpmnParseError,
} from "../src/modules/designer/bpmn-io.js";
import type { DesignerNode, DesignerEdge } from "../src/modules/designer/schema.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "eeeeeeee-1111-4000-8000-eee000000001";
const ACTOR = "eeeeeeee-3333-4000-8000-eee000000001";

function adminToken() {
  return signToken({ sub: ACTOR, tid: TENANT, roles: ["workflow_admin"], sid: "sess-e01" }, SECRET);
}
function userToken() {
  return signToken({ sub: "eeeeeeee-3333-4000-8000-eee000000002", tid: TENANT, roles: ["workflow_user"], sid: "sess-e02" }, SECRET);
}

afterEach(async () => {
  await db.execute(sql`DELETE FROM workflow.designer_definitions WHERE tenant_id = ${TENANT}`);
});
afterAll(async () => { await sqlClient.end(); });

// ── Sample BPMN XML Fixtures ──────────────────────────────────────

const VALID_BPMN_WITH_DI = `<?xml version="1.0" encoding="UTF-8"?>
<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL"
  xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
  xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"
  xmlns:di="http://www.omg.org/spec/DD/20100524/DI"
  targetNamespace="https://example.com"
  id="Definitions_1">
  <process id="Process_1" name="Test Process" isExecutable="true">
    <startEvent id="Start_1" name="Begin" />
    <userTask id="Task_1" name="Review Document" />
    <endEvent id="End_1" name="Done" />
    <sequenceFlow id="Flow_1" sourceRef="Start_1" targetRef="Task_1" />
    <sequenceFlow id="Flow_2" sourceRef="Task_1" targetRef="End_1" />
  </process>
  <bpmndi:BPMNDiagram id="BPMNDiagram_1">
    <bpmndi:BPMNPlane id="BPMNPlane_1" bpmnElement="Process_1">
      <bpmndi:BPMNShape id="Start_1_di" bpmnElement="Start_1">
        <dc:Bounds x="150" y="200" width="36" height="36" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Task_1_di" bpmnElement="Task_1">
        <dc:Bounds x="300" y="180" width="100" height="80" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="End_1_di" bpmnElement="End_1">
        <dc:Bounds x="500" y="200" width="36" height="36" />
      </bpmndi:BPMNShape>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</definitions>`;

const VALID_BPMN_NO_DI = `<?xml version="1.0" encoding="UTF-8"?>
<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL"
  targetNamespace="https://example.com"
  id="Definitions_1">
  <process id="Process_1" name="No Layout Process" isExecutable="true">
    <startEvent id="Start_1" name="Begin" />
    <userTask id="Task_1" name="Approve" />
    <exclusiveGateway id="GW_1" name="Decision" />
    <userTask id="Task_2" name="Rework" />
    <endEvent id="End_1" name="Done" />
    <sequenceFlow id="Flow_1" sourceRef="Start_1" targetRef="Task_1" />
    <sequenceFlow id="Flow_2" sourceRef="Task_1" targetRef="GW_1" />
    <sequenceFlow id="Flow_3" sourceRef="GW_1" targetRef="End_1" name="Approved" />
    <sequenceFlow id="Flow_4" sourceRef="GW_1" targetRef="Task_2" name="Rejected" />
    <sequenceFlow id="Flow_5" sourceRef="Task_2" targetRef="Task_1" />
  </process>
</definitions>`;

const MALFORMED_XML = `<not-bpmn><random>content</random></not-bpmn>`;

const EMPTY_PROCESS_XML = `<?xml version="1.0" encoding="UTF-8"?>
<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL"
  targetNamespace="https://example.com" id="Definitions_1">
  <process id="Process_1" name="Empty" isExecutable="true">
  </process>
</definitions>`;

// ── Unit Tests: parseBpmnXml ──────────────────────────────────────

describe("parseBpmnXml", () => {
  it("parses valid BPMN with DI positions", () => {
    const result = parseBpmnXml(VALID_BPMN_WITH_DI);
    expect(result.nodes).toHaveLength(3);
    expect(result.edges).toHaveLength(2);
    expect(result.processName).toBe("Test Process");

    const startNode = result.nodes.find((n) => n.id === "Start_1");
    expect(startNode).toBeDefined();
    expect(startNode!.type).toBe("startEvent");
    expect(startNode!.position.x).toBe(150);
    expect(startNode!.position.y).toBe(200);

    const taskNode = result.nodes.find((n) => n.id === "Task_1");
    expect(taskNode).toBeDefined();
    expect(taskNode!.type).toBe("userTask");
    expect(taskNode!.position.x).toBe(300);
    expect(taskNode!.position.y).toBe(180);
  });
});
