import { describe, it, expect } from "vitest";
import { shouldDeliverEvent, filterSubscribedPlugins } from "../src/modules/events/domain.js";
import type { PluginManifest } from "../src/modules/sandbox/types.js";

function makeManifest(events: string[]): PluginManifest {
  return {
    id: "test-plugin-001",
    permissions: ["read:tenant", "emit:event"],
    events,
  };
}

describe("Event Subscription Filtering", () => {
  describe("shouldDeliverEvent", () => {
    it("returns true for exact event match", () => {
      const manifest = makeManifest(["finance.bill.passed"]);
      expect(shouldDeliverEvent(manifest, "finance.bill.passed")).toBe(true);
    });

    it("returns false when event not in manifest", () => {
      const manifest = makeManifest(["finance.bill.passed"]);
      expect(shouldDeliverEvent(manifest, "hrms.leave.approved")).toBe(false);
    });

    it("returns true for wildcard '*' subscription", () => {
      const manifest = makeManifest(["*"]);
      expect(shouldDeliverEvent(manifest, "finance.bill.passed")).toBe(true);
      expect(shouldDeliverEvent(manifest, "hrms.leave.approved")).toBe(true);
      expect(shouldDeliverEvent(manifest, "any.event.type")).toBe(true);
    });

    it("returns true for prefix wildcard match", () => {
      const manifest = makeManifest(["finance.*"]);
      expect(shouldDeliverEvent(manifest, "finance.bill.passed")).toBe(true);
      expect(shouldDeliverEvent(manifest, "finance.payment.created")).toBe(true);
    });

    it("returns false for prefix wildcard with different prefix", () => {
      const manifest = makeManifest(["finance.*"]);
      expect(shouldDeliverEvent(manifest, "hrms.leave.approved")).toBe(false);
    });

    it("returns false when manifest has empty events array", () => {
      const manifest = makeManifest([]);
      expect(shouldDeliverEvent(manifest, "finance.bill.passed")).toBe(false);
    });

    it("returns false when manifest events is undefined", () => {
      const manifest: PluginManifest = {
        id: "test-plugin",
        permissions: [],
        events: undefined as unknown as string[],
      };
      expect(shouldDeliverEvent(manifest, "finance.bill.passed")).toBe(false);
    });

    it("returns false for empty event type", () => {
      const manifest = makeManifest(["*"]);
      expect(shouldDeliverEvent(manifest, "")).toBe(false);
      expect(shouldDeliverEvent(manifest, "  ")).toBe(false);
    });

    it("handles multiple declared events", () => {
      const manifest = makeManifest([
        "finance.bill.passed",
        "hrms.leave.approved",
        "workflow.task.approved",
      ]);
      expect(shouldDeliverEvent(manifest, "finance.bill.passed")).toBe(true);
      expect(shouldDeliverEvent(manifest, "hrms.leave.approved")).toBe(true);
      expect(shouldDeliverEvent(manifest, "workflow.task.approved")).toBe(true);
      expect(shouldDeliverEvent(manifest, "crm.deal.closed")).toBe(false);
    });

    it("exact match takes priority over non-matching prefix", () => {
      const manifest = makeManifest(["finance.bill.passed", "hrms.*"]);
      expect(shouldDeliverEvent(manifest, "finance.bill.passed")).toBe(true);
      expect(shouldDeliverEvent(manifest, "finance.payment.created")).toBe(false);
      expect(shouldDeliverEvent(manifest, "hrms.leave.approved")).toBe(true);
    });

    it("prefix wildcard does not match partial segments", () => {
      // "finance.*" should match "finance.X" but not "financials.X"
      const manifest = makeManifest(["finance.*"]);
      expect(shouldDeliverEvent(manifest, "financials.report.generated")).toBe(false);
    });
  });

  describe("filterSubscribedPlugins", () => {
    it("returns only plugins subscribed to the event", () => {
      const manifests: Array<[string, PluginManifest]> = [
        ["plugin-a", makeManifest(["finance.bill.passed"])],
        ["plugin-b", makeManifest(["hrms.leave.approved"])],
        ["plugin-c", makeManifest(["finance.*"])],
      ];

      const result = filterSubscribedPlugins(manifests, "finance.bill.passed");
      expect(result).toContain("plugin-a");
      expect(result).toContain("plugin-c");
      expect(result).not.toContain("plugin-b");
    });

    it("returns empty array when no plugins match", () => {
      const manifests: Array<[string, PluginManifest]> = [
        ["plugin-a", makeManifest(["finance.bill.passed"])],
        ["plugin-b", makeManifest(["hrms.leave.approved"])],
      ];

      const result = filterSubscribedPlugins(manifests, "crm.deal.closed");
      expect(result).toEqual([]);
    });

    it("returns all plugins for wildcard subscribers", () => {
      const manifests: Array<[string, PluginManifest]> = [
        ["plugin-a", makeManifest(["*"])],
        ["plugin-b", makeManifest(["*"])],
      ];

      const result = filterSubscribedPlugins(manifests, "any.event");
      expect(result).toEqual(["plugin-a", "plugin-b"]);
    });
  });
});
