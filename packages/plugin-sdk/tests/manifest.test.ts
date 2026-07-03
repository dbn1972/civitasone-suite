import { describe, expect, it } from "vitest";
import { validateManifest, pluginManifestSchema } from "../src/manifest.js";

describe("manifest validation", () => {
  const validManifest = {
    id: "my-plugin",
    name: "My Plugin",
    version: "1.0.0",
    author: "CivitasOne Team",
    description: "A test plugin",
    license: "MIT",
    minPlatformVersion: "0.1.0",
    permissions: ["finance:invoice:read", "store:data:write"],
    hooks: {
      onEvent: [{ event: "invoice.created", handler: "onInvoiceCreated" }],
      onSchedule: [{ cron: "0 * * * *", handler: "hourlySync" }],
    },
    ui: {
      pages: [{ path: "/plugins/my-plugin", component: "MainPage" }],
      widgets: [{ slot: "dashboard-top", component: "SummaryWidget" }],
    },
    api: {
      routes: [{ method: "GET" as const, path: "/status", handler: "getStatus" }],
    },
    config: {
      schema: { apiKey: { type: "string" } },
    },
  };

  it("parses a valid manifest", () => {
    const result = validateManifest(validManifest);
    expect(result.id).toBe("my-plugin");
    expect(result.name).toBe("My Plugin");
    expect(result.version).toBe("1.0.0");
    expect(result.permissions).toContain("finance:invoice:read");
  });

  it("accepts minimal manifest (only required fields)", () => {
    const minimal = {
      id: "minimal",
      name: "Minimal Plugin",
      version: "0.1.0",
      author: "Dev",
    };
    const result = validateManifest(minimal);
    expect(result.id).toBe("minimal");
    expect(result.permissions).toEqual([]);
  });

  it("rejects manifest with missing id", () => {
    const invalid = { ...validManifest, id: undefined };
    expect(() => validateManifest(invalid)).toThrow();
  });

  it("rejects manifest with invalid id format", () => {
    const invalid = { ...validManifest, id: "My Plugin!" };
    expect(() => validateManifest(invalid)).toThrow();
  });

  it("rejects manifest with invalid version", () => {
    const invalid = { ...validManifest, version: "bad" };
    expect(() => validateManifest(invalid)).toThrow();
  });

  it("rejects manifest with invalid permission", () => {
    const invalid = { ...validManifest, permissions: ["fake:perm:here"] };
    expect(() => validateManifest(invalid)).toThrow();
  });

  it("rejects manifest with empty name", () => {
    const invalid = { ...validManifest, name: "" };
    expect(() => validateManifest(invalid)).toThrow();
  });

  it("rejects manifest with invalid HTTP method in api routes", () => {
    const invalid = {
      ...validManifest,
      api: { routes: [{ method: "INVALID", path: "/x", handler: "h" }] },
    };
    expect(() => validateManifest(invalid)).toThrow();
  });

  it("provides the zod schema for external use", () => {
    expect(pluginManifestSchema).toBeDefined();
    expect(pluginManifestSchema.safeParse).toBeDefined();
  });
});
