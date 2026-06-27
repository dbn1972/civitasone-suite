/**
 * V-12 — Feature flag resolution integration test.
 *
 * Tests the three-layer resolution logic from admin-service domain:
 * 1. Global enabled=true, no overrides → flag is ON
 * 2. Global enabled=true, edition override=false → flag is OFF
 * 3. Global enabled=false, tenant override=true → flag is ON (tenant wins)
 * 4. Global enabled=false, no overrides → flag is OFF
 *
 * Also tests edge cases: both edition and tenant overrides present, undefined vs explicit false.
 */
import { describe, it, expect } from "vitest";
import { resolveFeatureFlag } from "../../services/admin-service/src/modules/config/domain.js";
import type { FlagLayers } from "../../services/admin-service/src/modules/config/domain.js";

describe("Feature flag resolution: three-layer priority", () => {
  describe("Layer 1: global only (no overrides)", () => {
    it("global enabled=true, no overrides → flag is ON", () => {
      const layers: FlagLayers = { globalEnabled: true };
      expect(resolveFeatureFlag(layers)).toBe(true);
    });

    it("global enabled=false, no overrides → flag is OFF", () => {
      const layers: FlagLayers = { globalEnabled: false };
      expect(resolveFeatureFlag(layers)).toBe(false);
    });
  });

  describe("Layer 2: edition override", () => {
    it("global enabled=true, edition override=false → flag is OFF (edition wins over global)", () => {
      const layers: FlagLayers = { globalEnabled: true, editionEnabled: false };
      expect(resolveFeatureFlag(layers)).toBe(false);
    });

    it("global enabled=false, edition override=true → flag is ON (edition wins over global)", () => {
      const layers: FlagLayers = { globalEnabled: false, editionEnabled: true };
      expect(resolveFeatureFlag(layers)).toBe(true);
    });

    it("global enabled=true, edition override=true → flag stays ON", () => {
      const layers: FlagLayers = { globalEnabled: true, editionEnabled: true };
      expect(resolveFeatureFlag(layers)).toBe(true);
    });

    it("global enabled=false, edition override=false → flag stays OFF", () => {
      const layers: FlagLayers = { globalEnabled: false, editionEnabled: false };
      expect(resolveFeatureFlag(layers)).toBe(false);
    });
  });

  describe("Layer 3: tenant override (highest priority)", () => {
    it("global enabled=false, tenant override=true → flag is ON (tenant wins)", () => {
      const layers: FlagLayers = { globalEnabled: false, tenantOverride: true };
      expect(resolveFeatureFlag(layers)).toBe(true);
    });

    it("global enabled=true, tenant override=false → flag is OFF (tenant wins)", () => {
      const layers: FlagLayers = { globalEnabled: true, tenantOverride: false };
      expect(resolveFeatureFlag(layers)).toBe(false);
    });

    it("tenant override=true overrides both global=false and edition=false", () => {
      const layers: FlagLayers = {
        globalEnabled: false,
        editionEnabled: false,
        tenantOverride: true,
      };
      expect(resolveFeatureFlag(layers)).toBe(true);
    });

    it("tenant override=false overrides both global=true and edition=true", () => {
      const layers: FlagLayers = {
        globalEnabled: true,
        editionEnabled: true,
        tenantOverride: false,
      };
      expect(resolveFeatureFlag(layers)).toBe(false);
    });
  });

  describe("Edge cases: undefined vs explicit boolean", () => {
    it("editionEnabled=undefined does not override global", () => {
      const layers: FlagLayers = { globalEnabled: true, editionEnabled: undefined };
      expect(resolveFeatureFlag(layers)).toBe(true);
    });

    it("tenantOverride=undefined does not override edition", () => {
      const layers: FlagLayers = {
        globalEnabled: false,
        editionEnabled: true,
        tenantOverride: undefined,
      };
      expect(resolveFeatureFlag(layers)).toBe(true);
    });

    it("all layers undefined except global → uses global", () => {
      const layers: FlagLayers = {
        globalEnabled: true,
        editionEnabled: undefined,
        tenantOverride: undefined,
      };
      expect(resolveFeatureFlag(layers)).toBe(true);
    });
  });

  describe("Priority summary: tenant > edition > global", () => {
    it("when all three are explicitly set, tenant always wins", () => {
      // tenant=true wins over edition=false and global=false
      expect(
        resolveFeatureFlag({ globalEnabled: false, editionEnabled: false, tenantOverride: true }),
      ).toBe(true);

      // tenant=false wins over edition=true and global=true
      expect(
        resolveFeatureFlag({ globalEnabled: true, editionEnabled: true, tenantOverride: false }),
      ).toBe(false);
    });

    it("when only edition and global are set, edition wins", () => {
      expect(resolveFeatureFlag({ globalEnabled: true, editionEnabled: false })).toBe(false);
      expect(resolveFeatureFlag({ globalEnabled: false, editionEnabled: true })).toBe(true);
    });

    it("when only global is set, global applies", () => {
      expect(resolveFeatureFlag({ globalEnabled: true })).toBe(true);
      expect(resolveFeatureFlag({ globalEnabled: false })).toBe(false);
    });
  });
});
