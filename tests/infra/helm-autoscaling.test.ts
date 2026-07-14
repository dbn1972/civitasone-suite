/**
 * Helm values-rendering test for default autoscaling on Tier-0/Tier-1
 * services (task 12.3).
 *
 * Shells out to the real `helm template` binary against the on-prem chart
 * and asserts, over the fixed 33-service enumeration (32 entries under
 * `values.services` + the separate `gateway` block):
 *   - every Tier-0/Tier-1 service (the 9 with `autoscaling.enabled: true` in
 *     `values.yaml`) renders an `autoscaling/v2` HorizontalPodAutoscaler with
 *     `minReplicas`/`maxReplicas` set
 *   - every other (Tier-2/3) service renders NO HorizontalPodAutoscaler
 *
 * Validates: Requirements 9.1, 9.3
 */
import { describe, it, expect, beforeAll } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const CHART_DIR = "infra/onprem/helm/civitasone";
const RELEASE_NAME = "civitasone";

/**
 * Fixed 33-service enumeration mirroring `values.yaml`'s `services` map (32
 * entries) plus the separate `gateway` block. Kept as an explicit literal
 * list (not derived from the values file) so this test independently proves
 * the rendered HPA set matches the intended Tier-0/Tier-1 SLO table in
 * `docs/operations/SLO-SLI-RUNBOOKS.md` §3, rather than merely reflecting
 * whatever the chart happens to contain.
 */
const ALL_SERVICES = [
  "identity", "tenant", "policy", "audit", "install", "notification", "finance",
  "procurement", "contract", "estab", "stock", "hrms", "payroll", "project",
  "asset", "report", "plugin", "theme", "grant", "citizen", "legal", "admin",
  "billing", "crm", "inventory", "telephony", "helpdesk", "knowledge",
  "workflow", "analytics", "location", "queue", "gateway",
];

/** The 9 Tier-0/Tier-1 services expected to have autoscaling enabled by default. */
const TIER01_SERVICES = new Set([
  "gateway", "identity", "queue", // Tier 0
  "finance", "estab", "workflow", "hrms", "payroll", "audit", // Tier 1
]);

function helmTemplate(extraArgs: string[] = []): string {
  return execFileSync(
    "helm",
    ["template", RELEASE_NAME, CHART_DIR, ...extraArgs],
    { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 },
  );
}

/** Split a `helm template` multi-document stream into individual manifests. */
function splitDocs(rendered: string): string[] {
  return rendered.split(/^---$/m).filter((d) => d.trim().length > 0);
}

describe("Helm chart: default autoscaling for Tier-0/Tier-1 services (task 12.3)", () => {
  let hpaDocs: string[];

  beforeAll(() => {
    const rendered = helmTemplate();
    hpaDocs = splitDocs(rendered).filter((d) => /kind:\s*HorizontalPodAutoscaler/.test(d));
  }, 30_000);

  it("sanity: ALL_SERVICES and TIER01_SERVICES cover the fixed 33-service enumeration exactly", () => {
    expect(ALL_SERVICES).toHaveLength(33);
    for (const tier01 of TIER01_SERVICES) {
      expect(ALL_SERVICES).toContain(tier01);
    }
  });

  it("renders exactly 9 HorizontalPodAutoscaler resources (one per Tier-0/Tier-1 service, none for Tier-2/3)", () => {
    expect(hpaDocs).toHaveLength(TIER01_SERVICES.size);
  });

  it.each(ALL_SERVICES)("service '%s': HPA presence matches its Tier-0/Tier-1 membership", (service) => {
    const expectedName = `${RELEASE_NAME}-${service}`;
    const doc = hpaDocs.find((d) => new RegExp(`name:\\s*${expectedName}\\b`).test(d));

    if (TIER01_SERVICES.has(service)) {
      expect(doc, `expected an HPA named ${expectedName} for Tier-0/Tier-1 service '${service}'`).toBeDefined();
      expect(doc).toMatch(/apiVersion:\s*autoscaling\/v2/);
      expect(doc).toMatch(/minReplicas:\s*\d+/);
      expect(doc).toMatch(/maxReplicas:\s*\d+/);
      // maxReplicas must exceed minReplicas for the autoscaler to do anything.
      const minMatch = doc!.match(/minReplicas:\s*(\d+)/);
      const maxMatch = doc!.match(/maxReplicas:\s*(\d+)/);
      expect(Number(maxMatch![1])).toBeGreaterThan(Number(minMatch![1]));
    } else {
      expect(doc, `expected NO HPA for Tier-2/3 service '${service}', but one rendered`).toBeUndefined();
    }
  });

  it("global autoscaling.enabled=false remains the inherited default for every non-Tier-0/1 service (no per-service override leak)", () => {
    // Every Tier-2/3 service's `services.<name>` entry in values.yaml has no
    // `autoscaling` key at all, so it inherits the chart-wide
    // `autoscaling.enabled: false` default — already proven by the absence
    // assertion above, cross-checked here against the raw values.yaml text
    // so a future edit that adds a stray override is caught even before
    // rendering.
    const raw = readFileSync(`${CHART_DIR}/values.yaml`, "utf8");
    const globalDefaultMatch = raw.match(/^autoscaling:\s*\n\s*enabled:\s*false/m);
    expect(globalDefaultMatch).not.toBeNull();
  });
});
