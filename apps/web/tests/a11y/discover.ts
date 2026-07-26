/**
 * Full-sweep route discovery for A11Y_FULL=1.
 *
 * Walks apps/web/src/app/(app) for `page.tsx` files and maps each to a URL.
 * Dynamic segments (`[id]`) are skipped — they need a real record id, which the
 * curated set covers explicitly via detail-archetype routes.
 *
 * Persona assignment: a route is opened as the persona whose module it belongs
 * to, falling back to superadmin. Getting this wrong renders a 403 shell, which
 * the spec treats as a route FAILURE (not a pass), so a mis-mapped persona is
 * surfaced rather than silently producing a clean audit of an error page.
 */
import { readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { Persona, RouteSpec } from "./routes.js";

const APP_DIR = join(__dirname, "../../src/app/(app)");

/** Module path prefix → persona that owns it. */
const MODULE_PERSONA: Record<string, Persona> = {
  finance: "financeofficer",
  hr: "hrofficer",
  estab: "hrofficer",
  establishment: "hrofficer",
  procurement: "procurementofficer",
  citizen: "grievanceofficer",
  helpdesk: "grievanceofficer",
  audit: "auditor",
  legal: "legalofficer",
  court: "legalofficer",
};

function personaFor(routePath: string): Persona {
  const top = routePath.split("/").filter(Boolean)[0] ?? "";
  return MODULE_PERSONA[top] ?? "superadmin";
}

function archetypeFor(routePath: string): RouteSpec["archetype"] {
  const segments = routePath.split("/").filter(Boolean);
  if (segments.length <= 1) return "hub";
  if (routePath.includes("dashboard")) return "dashboard";
  if (routePath.includes("new") || routePath.includes("create")) return "form";
  if (routePath.includes("onboard") || routePath.includes("setup")) return "wizard";
  return "list";
}

export function discoverAllRoutes(): RouteSpec[] {
  const out: RouteSpec[] = [];

  const walk = (dir: string, urlPath: string): void => {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        // Skip dynamic segments and private/route-group folders
        if (entry.name.startsWith("[")) continue;
        if (entry.name.startsWith("_")) continue;
        if (entry.name.startsWith("(")) {
          walk(join(dir, entry.name), urlPath);
          continue;
        }
        walk(join(dir, entry.name), `${urlPath}/${entry.name}`);
      } else if (entry.name === "page.tsx") {
        const path = urlPath === "" ? "/" : urlPath;
        out.push({ path, persona: personaFor(path), archetype: archetypeFor(path) });
      }
    }
  };

  walk(APP_DIR, "");
  return out.sort((a, b) => a.path.localeCompare(b.path));
}
