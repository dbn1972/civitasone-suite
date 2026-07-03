import { describe, expect, it } from "vitest";
import {
  PluginState,
  transitionPlugin,
  validTransitions,
} from "../src/lifecycle.js";

describe("lifecycle state machine", () => {
  it("transitions uploaded → installed via install", () => {
    expect(transitionPlugin(PluginState.Uploaded, "install")).toBe(
      PluginState.Installed,
    );
  });

  it("transitions installed → enabled via enable", () => {
    expect(transitionPlugin(PluginState.Installed, "enable")).toBe(
      PluginState.Enabled,
    );
  });

  it("transitions enabled → active via activate", () => {
    expect(transitionPlugin(PluginState.Enabled, "activate")).toBe(
      PluginState.Active,
    );
  });

  it("transitions active → disabled via disable", () => {
    expect(transitionPlugin(PluginState.Active, "disable")).toBe(
      PluginState.Disabled,
    );
  });

  it("transitions enabled → disabled via disable", () => {
    expect(transitionPlugin(PluginState.Enabled, "disable")).toBe(
      PluginState.Disabled,
    );
  });

  it("transitions disabled → uninstalled via uninstall", () => {
    expect(transitionPlugin(PluginState.Disabled, "uninstall")).toBe(
      PluginState.Uninstalled,
    );
  });

  it("transitions installed → uninstalled via uninstall", () => {
    expect(transitionPlugin(PluginState.Installed, "uninstall")).toBe(
      PluginState.Uninstalled,
    );
  });

  it("allows re-enabling from disabled", () => {
    expect(transitionPlugin(PluginState.Disabled, "enable")).toBe(
      PluginState.Enabled,
    );
  });

  it("throws on invalid transition: uploaded → enable", () => {
    expect(() => transitionPlugin(PluginState.Uploaded, "enable")).toThrow(
      /Invalid plugin transition/,
    );
  });

  it("throws on invalid transition: active → install", () => {
    expect(() => transitionPlugin(PluginState.Active, "install")).toThrow(
      /Invalid plugin transition/,
    );
  });

  it("throws on invalid transition: uninstalled → enable", () => {
    expect(() => transitionPlugin(PluginState.Uninstalled, "enable")).toThrow(
      /Invalid plugin transition/,
    );
  });

  it("exports all valid transitions", () => {
    expect(validTransitions.length).toBeGreaterThan(0);
    for (const t of validTransitions) {
      expect(t).toHaveProperty("from");
      expect(t).toHaveProperty("action");
      expect(t).toHaveProperty("to");
    }
  });
});
