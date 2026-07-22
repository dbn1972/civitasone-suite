// scripts/governance/reconcile-services.test.ts
//
// Unit tests against the real `services/` directory (task 6.3).
//
// Verifies reconcileServiceList/reconcilePortMap produce the documented
// results when run against the real repo: the documented 33-service list
// (structure.md) and documented port map (quick-reference.md) are missing 5
// services that exist on disk today (court, meeting, metadata, ml, visitor),
// and only 4 of those 5 have a discoverable port — metadata-service has no
// HTTP entrypoint, no docker-compose entry, and no gateway registry entry.
//
// Feature: agent-context-governance-refresh

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  discoverPort,
  listServiceRegistry,
  reconcilePortMap,
  reconcileServiceList,
  type PortDiscoveryResult,
} from "./reconcile-services.js";

const SUITE_ROOT = join(__dirname, "../..");
const SERVICES_DIR = join(SUITE_ROOT, "services");
const GATEWAY_REGISTRY_PATH = join(SERVICES_DIR, "gateway-service/src/registry.ts");

// The documented service list from .kiro/steering/structure.md's
// "## Services (33 total)" section, verbatim.
const DOCUMENTED_SERVICES = [
  "identity",
  "tenant",
  "policy",
  "audit",
  "notification",
  "finance",
  "procurement",
  "contract",
  "hrms",
  "payroll",
  "estab",
  "asset",
  "stock",
  "inventory",
  "project",
  "grant",
  "citizen",
  "legal",
  "crm",
  "helpdesk",
  "telephony",
  "knowledge",
  "location",
  "report",
  "analytics",
  "workflow",
  "admin",
  "billing",
  "install",
  "plugin",
  "theme",
  "gateway",
  "queue",
];

// The documented port map from .kiro/steering/quick-reference.md's
// "## Port Map (Gateway Registry)" table, verbatim.
const DOCUMENTED_PORTS: Record<string, number> = {
  identity: 3001,
  tenant: 3002,
  policy: 3003,
  audit: 3004,
  install: 3005,
  notification: 3006,
  finance: 3007,
  procurement: 3008,
  contract: 3009,
  estab: 3010,
  stock: 3011,
  hrms: 3012,
  payroll: 3013,
  project: 3014,
  asset: 3015,
  report: 3016,
  plugin: 3017,
  theme: 3018,
  grant: 3019,
  citizen: 3020,
  legal: 3021,
  admin: 3022,
  billing: 3023,
  crm: 3024,
  inventory: 3025,
  telephony: 3026,
  helpdesk: 3027,
  knowledge: 3028,
  workflow: 3029,
  queue: 3030,
  analytics: 3031,
  location: 4012,
  gateway: 8080,
};

function discoverFromRealRepo(gatewayRegistrySource: string): (service: string) => PortDiscoveryResult {
  return (service: string) => discoverPort(join(SERVICES_DIR, `${service}-service`), gatewayRegistrySource);
}

describe("reconcileServiceList against the real services/ directory", () => {
  it("adds exactly [court, meeting, metadata, ml, visitor] when reconciled against the documented 33-service list", () => {
    const registry = listServiceRegistry(SERVICES_DIR);
    const { added, merged } = reconcileServiceList(DOCUMENTED_SERVICES, registry);

    expect(added.sort()).toEqual(["court", "meeting", "metadata", "ml", "visitor"]);

    // Additive only: every documented service is still present, in order.
    for (const service of DOCUMENTED_SERVICES) {
      expect(merged).toContain(service);
    }
    expect(merged.length).toBe(DOCUMENTED_SERVICES.length + added.length);
  });
});

describe("reconcilePortMap against the real services/ directory", () => {
  it("produces needsManualAssignment = [metadata] and correct discovered ports for ml/meeting/court/visitor", () => {
    const registry = listServiceRegistry(SERVICES_DIR);
    const gatewayRegistrySource = readFileSync(GATEWAY_REGISTRY_PATH, "utf8");
    const discover = discoverFromRealRepo(gatewayRegistrySource);

    const { added, needsManualAssignment, merged } = reconcilePortMap(DOCUMENTED_PORTS, registry, discover);

    expect(needsManualAssignment).toEqual(["metadata"]);

    const addedByService = new Map(added.map((entry) => [entry.service, entry.port]));
    expect(addedByService.get("ml")).toBe(3032);
    expect(addedByService.get("meeting")).toBe(3033);
    expect(addedByService.get("court")).toBe(3034);
    expect(addedByService.get("visitor")).toBe(3035);

    // metadata never gets an invented port entry.
    expect(merged.metadata).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(merged, "metadata")).toBe(false);

    // Additive only: every documented port entry is still present, unchanged.
    for (const [service, port] of Object.entries(DOCUMENTED_PORTS)) {
      expect(merged[service]).toBe(port);
    }
  });
});
