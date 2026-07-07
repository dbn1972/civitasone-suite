import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { isPreviewEnabled, isPreviewPlugin, isPluginAllowed } from "../src/modules/events/preview.js";
import type { PluginManifest } from "../src/modules/sandbox/types.js";

function makeManifest(opts: { preview?: boolean } = {}): PluginManifest {
  const manifest: PluginManifest & { preview?: boolean } = {
    id: "test-plugin",
    permissions: ["read:tenant"],
    events: ["finance.bill.passed"],
  };
  if (opts.preview !== undefined) {
    manifest.preview = opts.preview;
  }
  return manifest as PluginManifest;
}

describe("Plugin Preview Flag & Feature Gate", () => {
  const originalEnv = process.env.FEATURE_PLUGIN_PREVIEW_ENABLED;

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.FEATURE_PLUGIN_PREVIEW_ENABLED;
    } else {
      process.env.FEATURE_PLUGIN_PREVIEW_ENABLED = originalEnv;
    }
  });

  describe("isPreviewEnabled", () => {
    it("returns true when FEATURE_PLUGIN_PREVIEW_ENABLED=true", () => {
      process.env.FEATURE_PLUGIN_PREVIEW_ENABLED = "true";
      expect(isPreviewEnabled()).toBe(true);
    });

    it("returns false when FEATURE_PLUGIN_PREVIEW_ENABLED is not set", () => {
      delete process.env.FEATURE_PLUGIN_PREVIEW_ENABLED;
      expect(isPreviewEnabled()).toBe(false);
    });

    it("returns false when FEATURE_PLUGIN_PREVIEW_ENABLED=false", () => {
      process.env.FEATURE_PLUGIN_PREVIEW_ENABLED = "false";
      expect(isPreviewEnabled()).toBe(false);
    });

    it("returns false when FEATURE_PLUGIN_PREVIEW_ENABLED is empty", () => {
      process.env.FEATURE_PLUGIN_PREVIEW_ENABLED = "";
      expect(isPreviewEnabled()).toBe(false);
    });
  });

  describe("isPreviewPlugin", () => {
    it("returns true when manifest has preview: true", () => {
      const manifest = makeManifest({ preview: true });
      expect(isPreviewPlugin(manifest)).toBe(true);
    });

    it("returns false when manifest has preview: false", () => {
      const manifest = makeManifest({ preview: false });
      expect(isPreviewPlugin(manifest)).toBe(false);
    });

    it("returns false when manifest does not have preview field", () => {
      const manifest = makeManifest();
      expect(isPreviewPlugin(manifest)).toBe(false);
    });
  });

  describe("isPluginAllowed", () => {
    it("allows non-preview plugins regardless of feature gate", () => {
      delete process.env.FEATURE_PLUGIN_PREVIEW_ENABLED;
      const manifest = makeManifest({ preview: false });
      expect(isPluginAllowed(manifest)).toBe(true);
    });

    it("allows non-preview plugins when no preview field exists", () => {
      delete process.env.FEATURE_PLUGIN_PREVIEW_ENABLED;
      const manifest = makeManifest();
      expect(isPluginAllowed(manifest)).toBe(true);
    });

    it("blocks preview plugins when feature gate is disabled", () => {
      delete process.env.FEATURE_PLUGIN_PREVIEW_ENABLED;
      const manifest = makeManifest({ preview: true });
      expect(isPluginAllowed(manifest)).toBe(false);
    });

    it("allows preview plugins when feature gate is enabled", () => {
      process.env.FEATURE_PLUGIN_PREVIEW_ENABLED = "true";
      const manifest = makeManifest({ preview: true });
      expect(isPluginAllowed(manifest)).toBe(true);
    });

    it("blocks preview plugins when feature gate is explicitly false", () => {
      process.env.FEATURE_PLUGIN_PREVIEW_ENABLED = "false";
      const manifest = makeManifest({ preview: true });
      expect(isPluginAllowed(manifest)).toBe(false);
    });
  });
});
