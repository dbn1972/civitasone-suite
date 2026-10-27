import { describe, it, expect } from "vitest";
import { registerOpsRoutes } from "./index.js";

/** CodeQL js/prototype-polluting-assignment (#933): route-derived keys must never reach Object.prototype. */
describe("registerOpsRoutes openapi builder", () => {
  it("ignores __proto__/constructor/prototype keys and does not pollute Object.prototype", async () => {
    const handlers = new Map<string, (...a: unknown[]) => unknown>();
    const hooks = new Map<string, (...a: unknown[]) => unknown>();
    const app = {
      get: (path: string, h: (...a: unknown[]) => unknown) => void handlers.set(path, h),
      addHook: (name: string, h: (...a: unknown[]) => unknown) => void hooks.set(name, h),
      routes: [
        { method: "GET", url: "/v1/ok/:id" },
        { method: ["__PROTO__", "CONSTRUCTOR", "POST"], url: "/v1/mixed" },
        { method: "GET", url: "__proto__" },
        { method: "GET", url: "constructor" },
        { method: "GET", url: "prototype" },
      ],
    };
    registerOpsRoutes(app, { service: "svc" });
    await hooks.get("onReady")!();
    const doc = (await handlers.get("/openapi.json")!()) as { paths: Record<string, Record<string, unknown>> };

    expect(Object.keys(doc.paths).sort()).toEqual(["/v1/mixed", "/v1/ok/{id}"]);
    expect(Object.keys(doc.paths["/v1/mixed"]!)).toEqual(["post"]);
    expect(Object.getPrototypeOf(doc.paths)).toBeNull();
    expect(({} as Record<string, unknown>).get).toBeUndefined();
    expect(({} as Record<string, unknown>).post).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(Object.prototype, "summary")).toBe(false);
  });
});
