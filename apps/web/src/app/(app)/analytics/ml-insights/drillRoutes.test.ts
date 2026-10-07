import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

/**
 * GAP-ANALYTICS-ML-INSIGHTS-{ANOMALIES,INVENTORY,PROJECTS,SUBSCRIPTIONS,TICKETS}-02/05:
 * every rowLinkPrefix a domain page passes must resolve to a real detail
 * route (…/[id]/page.tsx), otherwise the Entity drill-through 404s. A page
 * that intentionally omits rowLinkPrefix (no safe target yet) is allowed.
 */

const APP_ROOT = join(process.cwd(), "src", "app", "(app)");
const ML_ROOT = join(APP_ROOT, "analytics", "ml-insights");

function readPrefix(domainDir: string): string | null {
  const src = readFileSync(join(ML_ROOT, domainDir, "page.tsx"), "utf8");
  // Only consider real JSX prop lines, not commented-out examples that
  // mention a former/dead prefix inside a // comment.
  for (const line of src.split("\n")) {
    const code = line.replace(/\/\/.*$/, "");
    const m = /rowLinkPrefix="([^"]+)"/.exec(code);
    if (m) return m[1];
  }
  return null;
}

/** A prefix like "/inventory/" -> the detail route dir "inventory/[id]". */
function detailRouteExists(prefix: string): boolean {
  const rel = prefix.replace(/^\//, "").replace(/\/$/, ""); // "inventory", "crm/contacts", "helpdesk/tickets"
  const dir = join(APP_ROOT, ...rel.split("/"), "[id]");
  return existsSync(join(dir, "page.tsx"));
}

describe("ml-insights drill-through prefixes resolve to real routes", () => {
  const domains = ["anomalies", "inventory", "leads", "projects", "subscriptions", "tickets"];
  for (const d of domains) {
    it(`${d}: prefix is unset OR points at an existing […]/page.tsx`, () => {
      const prefix = readPrefix(d);
      if (prefix === null) {
        expect(prefix).toBeNull(); // intentionally no drill-through
        return;
      }
      expect(detailRouteExists(prefix), `${d} -> ${prefix}`).toBe(true);
    });
  }

  it("anomalies has NO dead /finance/anomalies/ prefix", () => {
    expect(readPrefix("anomalies")).toBeNull();
    expect(existsSync(join(APP_ROOT, "finance", "anomalies"))).toBe(false);
  });

  it("inventory links to /inventory/ (stock-item detail via getStockItemById)", () => {
    expect(readPrefix("inventory")).toBe("/inventory/");
    // /inventory/[id] is the stock-item detail that entityId refers to.
    expect(existsSync(join(APP_ROOT, "inventory", "[id]", "page.tsx"))).toBe(true);
  });

  it("subscriptions drops the dead /billing/subscriptions/ prefix", () => {
    expect(readPrefix("subscriptions")).toBeNull();
    expect(existsSync(join(APP_ROOT, "billing", "subscriptions", "[id]"))).toBe(false);
  });

  it("tickets links to the canonical /helpdesk/tickets/ detail", () => {
    expect(readPrefix("tickets")).toBe("/helpdesk/tickets/");
  });

  it("projects drops the wrong /projects/ (task-id vs project-id) prefix", () => {
    expect(readPrefix("projects")).toBeNull();
  });
});
