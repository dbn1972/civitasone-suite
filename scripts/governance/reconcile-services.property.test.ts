// scripts/governance/reconcile-services.property.test.ts
//
// Property tests for the service/port reconciler (tasks 6.4, 6.5). Uses
// fast-check (already a devDependency) — see design.md's "Correctness
// Properties" section for Property 6 and Property 7's full statements.
//
// Both documented service list/port map and the Service_Registry are
// generated as random sets of service-name strings; port discovery is
// mocked via a fast-check-generated function from service name -> port | null,
// rather than touching the filesystem, so these tests only exercise the pure
// reconcileServiceList/reconcilePortMap merge logic.

import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { reconcilePortMap, reconcileServiceList, type PortDiscoveryResult } from "./reconcile-services.js";

// ── Generators ───────────────────────────────────────────────────────────────

// Small alphabetic service-name strings, distinct from each other within a
// generated set (fc.uniqueArray) to keep documented/registry semantics
// (each is a *set* of service names) faithful to what these functions treat
// them as.
const arbServiceName = fc.stringMatching(/^[a-z][a-z0-9]{1,9}$/);

const arbServiceNameSet = fc.uniqueArray(arbServiceName, { minLength: 0, maxLength: 12 });

const arbPort = fc.integer({ min: 3000, max: 9999 });

/**
 * A mocked discovery function: maps each service name to either a fixed port
 * (from a randomly generated dictionary) or `null` if it's not in the
 * dictionary — modeling "discoverPort returns null for services with no
 * discoverable port" without touching the filesystem.
 */
function buildMockDiscover(portByService: Record<string, number>): (service: string) => PortDiscoveryResult {
  return (service: string): PortDiscoveryResult => {
    const port = Object.prototype.hasOwnProperty.call(portByService, service) ? portByService[service]! : null;
    return { service, port, discoveredFrom: port === null ? null : "index.ts" };
  };
}

describe("Property 6: Service/port reconciliation only adds, guided strictly by discoverability", () => {
  // Feature: agent-context-governance-refresh, Property 6: For any documented service list/port map and any Service_Registry (both generated as random sets of service-name strings, with a mocked port-discovery function): (a) every registry entry missing from the documented list is added to the merged list; (b) for port reconciliation, a service is added to the merged port map if and only if the mocked discovery function returns a non-null port for it; (c) a service is added to needsManualAssignment if and only if discovery returns null for it; (d) the merged port map never contains an invented port value not returned by the discovery function.

  it("(a) every registry entry missing from the documented list is added to the merged list", () => {
    fc.assert(
      fc.property(arbServiceNameSet, arbServiceNameSet, (documented, registry) => {
        const { merged, added } = reconcileServiceList(documented, registry);

        const documentedSet = new Set(documented);
        const expectedAdded = registry.filter((s) => !documentedSet.has(s));

        expect(new Set(added)).toEqual(new Set(expectedAdded));
        for (const service of expectedAdded) {
          expect(merged).toContain(service);
        }
      }),
      { numRuns: 100 },
    );
  });

  it("(b)+(d) a service is added to the merged port map iff discovery returns non-null, and every merged port value traces back to the discovery function", () => {
    fc.assert(
      fc.property(
        arbServiceNameSet,
        fc.dictionary(arbServiceName, arbPort),
        arbServiceNameSet,
        fc.dictionary(arbServiceName, arbPort),
        (documentedServices, documentedPortsRaw, registry, discoveryPortsRaw) => {
          // Build a documented port map restricted to documentedServices, so
          // the map's keys are exactly the documented service set (mirrors
          // real usage where documentedPorts and the documented service list
          // describe the same set of services).
          const documentedPorts: Record<string, number> = {};
          for (const service of documentedServices) {
            documentedPorts[service] = documentedPortsRaw[service] ?? 3000;
          }

          const discover = buildMockDiscover(discoveryPortsRaw);

          const { merged, added } = reconcilePortMap(documentedPorts, registry, discover);

          for (const service of registry) {
            if (Object.prototype.hasOwnProperty.call(documentedPorts, service)) continue; // already documented, never re-discovered

            const result = discover(service);
            const wasAdded = added.some((entry) => entry.service === service);

            if (result.port === null) {
              expect(wasAdded).toBe(false);
              expect(Object.prototype.hasOwnProperty.call(merged, service)).toBe(false);
            } else {
              expect(wasAdded).toBe(true);
              // (d) the merged port map value is exactly what discovery returned — never invented.
              expect(merged[service]).toBe(result.port);
              const addedEntry = added.find((entry) => entry.service === service);
              expect(addedEntry?.port).toBe(result.port);
            }
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it("(c) a service is added to needsManualAssignment if and only if discovery returns null for it", () => {
    fc.assert(
      fc.property(
        arbServiceNameSet,
        arbServiceNameSet,
        fc.dictionary(arbServiceName, arbPort),
        (documentedServices, registry, discoveryPortsRaw) => {
          const documentedPorts: Record<string, number> = {};
          for (const service of documentedServices) {
            documentedPorts[service] = 3000;
          }

          const discover = buildMockDiscover(discoveryPortsRaw);
          const { needsManualAssignment } = reconcilePortMap(documentedPorts, registry, discover);

          const needsManualSet = new Set(needsManualAssignment);

          for (const service of registry) {
            if (Object.prototype.hasOwnProperty.call(documentedPorts, service)) {
              // Already documented -> never touched, never flagged either way.
              expect(needsManualSet.has(service)).toBe(false);
              continue;
            }
            const result = discover(service);
            expect(needsManualSet.has(service)).toBe(result.port === null);
          }

          // No duplicate/extraneous entries: needsManualAssignment only ever
          // contains registry services not already documented.
          for (const service of needsManualAssignment) {
            expect(registry).toContain(service);
            expect(Object.prototype.hasOwnProperty.call(documentedPorts, service)).toBe(false);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

describe("Property 7: Reconciliation never removes a documented service or port entry", () => {
  // Feature: agent-context-governance-refresh, Property 7: For any documented service list/port map and any Service_Registry (including registries that are missing services present in the documented list, or are entirely disjoint from it), every key present in the original documented list/port map is still present in the merged output afterward.

  it("every documented service is still present in the merged service list, even when the registry is missing documented services or is entirely disjoint", () => {
    fc.assert(
      fc.property(arbServiceNameSet, arbServiceNameSet, (documented, registry) => {
        const { merged } = reconcileServiceList(documented, registry);
        for (const service of documented) {
          expect(merged).toContain(service);
        }
      }),
      { numRuns: 100 },
    );
  });

  it("every documented port entry is still present (with its original value) in the merged port map, even when the registry is missing documented services or is entirely disjoint", () => {
    fc.assert(
      fc.property(
        arbServiceNameSet,
        arbServiceNameSet,
        fc.dictionary(arbServiceName, arbPort),
        (documentedServices, registry, discoveryPortsRaw) => {
          const documentedPorts: Record<string, number> = {};
          for (const [i, service] of documentedServices.entries()) {
            documentedPorts[service] = 3000 + i;
          }

          const discover = buildMockDiscover(discoveryPortsRaw);
          const { merged } = reconcilePortMap(documentedPorts, registry, discover);

          for (const [service, port] of Object.entries(documentedPorts)) {
            expect(merged[service]).toBe(port);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it("documented entries are never overwritten even if the (mocked) discovery function would return a different port for an already-documented service", () => {
    fc.assert(
      fc.property(arbServiceNameSet, fc.integer({ min: 3000, max: 3999 }), fc.integer({ min: 4000, max: 4999 }), (documentedServices, docPort, discoveredPort) => {
        const documentedPorts: Record<string, number> = {};
        for (const service of documentedServices) {
          documentedPorts[service] = docPort;
        }

        // Registry contains all documented services (as if they're all
        // still present on disk); discovery would return a *different* port
        // for every one of them, but since they're already documented, that
        // must never overwrite the documented value.
        const discover = (service: string): PortDiscoveryResult => ({
          service,
          port: discoveredPort,
          discoveredFrom: "index.ts",
        });

        const { merged, added } = reconcilePortMap(documentedPorts, documentedServices, discover);

        for (const service of documentedServices) {
          expect(merged[service]).toBe(docPort);
        }
        expect(added).toEqual([]);
      }),
      { numRuns: 100 },
    );
  });
});
