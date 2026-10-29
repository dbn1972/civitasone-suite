/**
 * UAT API sweep 2026-10-28: registerSchemaErrorHandler(app, HttpError) must run BEFORE the first
 * route plugin is registered. Fastify encapsulated contexts copy the parent error handler when they
 * are created, so a handler installed after `app.register(<routes>)` only covers the root context and
 * every ZodError thrown in a route module without its own handler falls through to a 500.
 * Locks the four UAT g4 services (admin-service was fixed first, see its uat-api-validation-4xx test).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "../..");

describe.each(["contract-service", "project-service", "stock-service", "works-service"])(
  "%s app.ts registers the schema error handler before any route plugin",
  (svc) => {
    const src = readFileSync(join(ROOT, "services", svc, "src/app.ts"), "utf8");

    it("calls registerSchemaErrorHandler exactly once", () => {
      expect(src.match(/registerSchemaErrorHandler\(app, HttpError\)/g)?.length).toBe(1);
    });

    it("precedes every `app.register(<xRoutes>)`", () => {
      const handlerAt = src.indexOf("registerSchemaErrorHandler(app, HttpError)");
      const firstRouteAt = src.search(/app\.register\(\s*\w*Routes\s*\)/);
      expect(firstRouteAt).toBeGreaterThan(0);
      expect(handlerAt).toBeGreaterThan(0);
      expect(handlerAt).toBeLessThan(firstRouteAt);
    });
  },
);
