import { describe, it, expect } from "vitest";
import {
  checkPermission,
  enforcePermission,
  validateManifestPermissions,
  OPERATION_PERMISSION_MAP,
  VALID_PERMISSIONS,
} from "../src/modules/sandbox/permissions.js";
import type { PluginManifest } from "../src/modules/sandbox/types.js";

function makeManifest(permissions: PluginManifest["permissions"] = []): PluginManifest {
  return {
    id: "test-plugin-001",
    permissions,
    events: ["finance.bill.passed"],
  };
}

describe("Plugin Permission Enforcement", () => {
  describe("checkPermission", () => {
    it("returns true when manifest grants the required permission", () => {
      const manifest = makeManifest(["read:tenant"]);
      expect(checkPermission(manifest, "db:read")).toBe(true);
    });

    it("returns false when manifest does not grant the required permission", () => {
      const manifest = makeManifest(["read:tenant"]);
      expect(checkPermission(manifest, "db:write")).toBe(false);
    });

    it("returns false for unknown operations (fail-closed)", () => {
      const manifest = makeManifest(["read:tenant", "write:tenant", "emit:event", "http:outbound", "storage:read", "storage:write"]);
      expect(checkPermission(manifest, "unknown:operation")).toBe(false);
    });

    it("handles empty permissions array", () => {
      const manifest = makeManifest([]);
      expect(checkPermission(manifest, "db:read")).toBe(false);
      expect(checkPermission(manifest, "db:write")).toBe(false);
      expect(checkPermission(manifest, "event:emit")).toBe(false);
      expect(checkPermission(manifest, "http:outbound")).toBe(false);
      expect(checkPermission(manifest, "storage:read")).toBe(false);
      expect(checkPermission(manifest, "storage:write")).toBe(false);
    });

    it("checks each operation → permission mapping correctly", () => {
      // DB read → read:tenant
      expect(checkPermission(makeManifest(["read:tenant"]), "db:read")).toBe(true);
      expect(checkPermission(makeManifest(["write:tenant"]), "db:read")).toBe(false);

      // DB write → write:tenant
      expect(checkPermission(makeManifest(["write:tenant"]), "db:write")).toBe(true);
      expect(checkPermission(makeManifest(["read:tenant"]), "db:write")).toBe(false);

      // Event emit → emit:event
      expect(checkPermission(makeManifest(["emit:event"]), "event:emit")).toBe(true);
      expect(checkPermission(makeManifest(["read:tenant"]), "event:emit")).toBe(false);

      // HTTP outbound → http:outbound
      expect(checkPermission(makeManifest(["http:outbound"]), "http:outbound")).toBe(true);
      expect(checkPermission(makeManifest(["read:tenant"]), "http:outbound")).toBe(false);

      // Storage read → storage:read
      expect(checkPermission(makeManifest(["storage:read"]), "storage:read")).toBe(true);
      expect(checkPermission(makeManifest(["write:tenant"]), "storage:read")).toBe(false);

      // Storage write → storage:write
      expect(checkPermission(makeManifest(["storage:write"]), "storage:write")).toBe(true);
      expect(checkPermission(makeManifest(["storage:read"]), "storage:write")).toBe(false);
    });

    it("handles multiple permissions correctly", () => {
      const manifest = makeManifest(["read:tenant", "write:tenant", "emit:event"]);

      expect(checkPermission(manifest, "db:read")).toBe(true);
      expect(checkPermission(manifest, "db:write")).toBe(true);
      expect(checkPermission(manifest, "event:emit")).toBe(true);
      expect(checkPermission(manifest, "http:outbound")).toBe(false);
      expect(checkPermission(manifest, "storage:read")).toBe(false);
      expect(checkPermission(manifest, "storage:write")).toBe(false);
    });
  });

  describe("enforcePermission", () => {
    it("returns null when permission is granted", () => {
      const manifest = makeManifest(["read:tenant"]);
      expect(enforcePermission(manifest, "db:read")).toBeNull();
    });

    it("returns permission_denied error when permission is not granted", () => {
      const manifest = makeManifest(["read:tenant"]);
      const error = enforcePermission(manifest, "db:write");

      expect(error).not.toBeNull();
      expect(error!.code).toBe("permission_denied");
      expect(error!.message).toBe("Plugin does not have permission: write:tenant");
    });

    it("returns permission_denied for unknown operations", () => {
      const manifest = makeManifest(["read:tenant", "write:tenant"]);
      const error = enforcePermission(manifest, "some:unknown");

      expect(error).not.toBeNull();
      expect(error!.code).toBe("permission_denied");
      expect(error!.message).toBe("Plugin does not have permission: some:unknown");
    });

    it("includes the denied permission name in the error message", () => {
      const manifest = makeManifest([]);

      const httpError = enforcePermission(manifest, "http:outbound");
      expect(httpError!.message).toContain("http:outbound");

      const emitError = enforcePermission(manifest, "event:emit");
      expect(emitError!.message).toContain("emit:event");

      const storageError = enforcePermission(manifest, "storage:write");
      expect(storageError!.message).toContain("storage:write");
    });
  });

  describe("validateManifestPermissions", () => {
    it("returns empty array for valid permissions", () => {
      const manifest = makeManifest(["read:tenant", "write:tenant", "emit:event"]);
      expect(validateManifestPermissions(manifest)).toEqual([]);
    });

    it("returns empty array for all valid permissions", () => {
      const manifest = makeManifest([
        "read:tenant",
        "write:tenant",
        "emit:event",
        "http:outbound",
        "storage:read",
        "storage:write",
      ]);
      expect(validateManifestPermissions(manifest)).toEqual([]);
    });

    it("returns empty array for empty permissions", () => {
      const manifest = makeManifest([]);
      expect(validateManifestPermissions(manifest)).toEqual([]);
    });

    it("detects invalid permissions", () => {
      // Force invalid permissions via type assertion
      const manifest = makeManifest(["read:tenant", "invalid:perm" as never, "another:bad" as never]);
      const invalid = validateManifestPermissions(manifest);
      expect(invalid).toContain("invalid:perm");
      expect(invalid).toContain("another:bad");
      expect(invalid).not.toContain("read:tenant");
    });
  });

  describe("OPERATION_PERMISSION_MAP", () => {
    it("maps all 6 operations to their permissions", () => {
      expect(OPERATION_PERMISSION_MAP["db:read"]).toBe("read:tenant");
      expect(OPERATION_PERMISSION_MAP["db:write"]).toBe("write:tenant");
      expect(OPERATION_PERMISSION_MAP["event:emit"]).toBe("emit:event");
      expect(OPERATION_PERMISSION_MAP["http:outbound"]).toBe("http:outbound");
      expect(OPERATION_PERMISSION_MAP["storage:read"]).toBe("storage:read");
      expect(OPERATION_PERMISSION_MAP["storage:write"]).toBe("storage:write");
    });

    it("has exactly 6 entries", () => {
      expect(Object.keys(OPERATION_PERMISSION_MAP)).toHaveLength(6);
    });
  });

  describe("VALID_PERMISSIONS", () => {
    it("contains exactly the 6 allowed permissions", () => {
      expect(VALID_PERMISSIONS).toHaveLength(6);
      expect(VALID_PERMISSIONS).toContain("read:tenant");
      expect(VALID_PERMISSIONS).toContain("write:tenant");
      expect(VALID_PERMISSIONS).toContain("emit:event");
      expect(VALID_PERMISSIONS).toContain("http:outbound");
      expect(VALID_PERMISSIONS).toContain("storage:read");
      expect(VALID_PERMISSIONS).toContain("storage:write");
    });
  });
});
