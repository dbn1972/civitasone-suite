/**
 * crm-link-integrity.contract.test.ts — finding R5 (contract / link integrity)
 *
 * Enforces the contract between the CRM API surface and the CRM section of the
 * web app. Runs scripts/contract/crm-link-integrity.mjs (static analyzer, no
 * running services) and asserts:
 *
 *   - every internal `/crm/...` link in the web app resolves to a Next.js page
 *     route that exists (no dead navigation tiles / 404 drill-throughs), and
 *   - every `/api/v1/crm/...` (or `/api/proxy/v1/crm/...`) path the web app
 *     calls resolves through the gateway registry onto a route crm-service
 *     actually registers.
 *
 * This test fails the moment a CRM tile goes dead — either because someone adds
 * a link to a page that was never built, or because a page/endpoint is removed
 * while something still links to it.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "../..");
const SCRIPT = join(ROOT, "scripts/contract/crm-link-integrity.mjs");
const ARTEFACT = join(ROOT, "scripts/contract/crm-link-integrity.json");

type CrmLink = {
  file: string;
  line: number;
  kind: string;
  target: string;
  resolved: string;
  ok: boolean;
};

type CrmApiRef = {
  file: string;
  line: number;
  ref: string;
  gatewayPath: string;
  upstreamService: string | null;
  upstreamPath: string | null;
  ok: boolean;
};

type Inventory = {
  gatewayPrefix: string | null;
  counts: {
    crmApiRoutes: number;
    crmNextRoutes: number;
    webNextRoutes: number;
    crmLinks: number;
    deadLinks: number;
    crmApiRefs: number;
    unknownApiRefs: number;
  };
  crmApiRoutes: { method: string; path: string; source: string }[];
  crmNextRoutes: string[];
  links: CrmLink[];
  apiRefs: CrmApiRef[];
  deadLinks: CrmLink[];
  unknownApiRefs: CrmApiRef[];
};

let inventory: Inventory;

beforeAll(() => {
  execSync(`node ${SCRIPT}`, { stdio: "pipe", cwd: ROOT });
  inventory = JSON.parse(readFileSync(ARTEFACT, "utf8")) as Inventory;
}, 60_000);

describe("CRM contract / link integrity (R5)", () => {
  it("generates a non-empty CRM route inventory", () => {
    expect(existsSync(ARTEFACT)).toBe(true);
    // crm-service registers its surface across ~25 *-routes.ts files; a sudden
    // collapse to a handful means the analyzer stopped seeing registrations.
    expect(inventory.counts.crmApiRoutes).toBeGreaterThan(50);
    expect(inventory.counts.crmNextRoutes).toBeGreaterThan(0);
    expect(inventory.counts.crmLinks).toBeGreaterThan(0);
    expect(inventory.counts.crmApiRefs).toBeGreaterThan(0);
  });

  it("exposes CRM through the documented gateway prefix", () => {
    expect(inventory.gatewayPrefix).toBe("/api/v1/crm");
  });

  it("has no dead CRM navigation links (every /crm target is a real page route)", () => {
    const dead = inventory.deadLinks;
    if (dead.length > 0) {
      const detail = dead
        .map((l) => `  [DEAD LINK] ${l.file}:${l.line} (${l.kind}) ${l.target} -> ${l.resolved}`)
        .join("\n");
      expect.fail(
        `${dead.length} CRM link(s) point at Next.js routes that do not exist:\n${detail}\n\n` +
          `Either build the page under apps/web/src/app, or remove the link.\n` +
          `Run: node scripts/contract/crm-link-integrity.mjs --report`,
      );
    }
  });

  it("has no CRM API call that crm-service does not serve", () => {
    const unknown = inventory.unknownApiRefs;
    if (unknown.length > 0) {
      const detail = unknown
        .map((r) => `  [DEAD API] ${r.file}:${r.line} ${r.ref} -> ${r.upstreamPath ?? "unrouted"}`)
        .join("\n");
      expect.fail(
        `${unknown.length} CRM API path(s) referenced by the web app are not registered by crm-service:\n${detail}\n\n` +
          `Run: node scripts/contract/crm-link-integrity.mjs --report`,
      );
    }
  });

  it("keeps the ML lead-scoring drill-through pointed at a real CRM entity page", () => {
    // A CRM "lead" is a row in crm.contacts (crm.lead.created carries contactId
    // and GET /v1/crm/leads/:id/* reads crm.contacts), so lead drill-through
    // must land on the contact detail page. It previously pointed at
    // /crm/pipeline/<id>, which has no [id] segment and 404'd.
    const leadLinks = inventory.links.filter((l) =>
      l.file.endsWith("analytics/ml-insights/leads/page.tsx"),
    );
    expect(leadLinks.length).toBeGreaterThan(0);
    for (const link of leadLinks) {
      expect(link.ok, `${link.target} does not resolve to a page route`).toBe(true);
    }
  });

  it("reports the CRM contract inventory (informational)", () => {
    const c = inventory.counts;
    console.log(
      `\nCRM contract inventory: ${c.crmApiRoutes} crm-service endpoints, ` +
        `${c.crmNextRoutes} CRM page routes, ${c.crmLinks} CRM links (${c.deadLinks} dead), ` +
        `${c.crmApiRefs} CRM API refs (${c.unknownApiRefs} unresolvable)`,
    );
    expect(typeof c.crmApiRoutes).toBe("number");
  });
});
