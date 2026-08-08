/**
 * Notification Service — DND domain tests. 26 packs.
 */
import { describe, it, expect } from "vitest";
import { evaluateWindow, isDndActive, type DndWindow } from "../src/modules/dnd/domain.js";

describe("DND window evaluation", () => {
  it("disabled window is never active", () => {
    const w: DndWindow = { startTime: "00:00", endTime: "23:59", timezone: "Asia/Kolkata", days: ["mon","tue","wed","thu","fri","sat","sun"], enabled: false };
    expect(evaluateWindow(w, new Date("2026-07-15T10:00:00Z"))).toBe(false);
  });
  it("isDndActive: no windows = deliver", () => {
    expect(isDndActive([], new Date()).action).toBe("deliver");
  });
  it("isDndActive: all disabled = deliver", () => {
    const w: DndWindow = { startTime: "22:00", endTime: "06:00", timezone: "UTC", days: ["mon"], enabled: false };
    expect(isDndActive([w], new Date("2026-07-14T23:00:00Z")).action).toBe("deliver");
  });
});
