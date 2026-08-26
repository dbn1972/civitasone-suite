import { describe, it, expect } from "vitest";
import { COMMANDS } from "./VoiceNav";

// Reachability guard for the voice-navigation command map. Every value must be a
// real route — a voice command that navigates to a 404 is a dead end the user
// cannot recover from by keyboard.
describe("VoiceNav COMMANDS", () => {
  it("maps 'new voucher' to the real voucher-creation route", () => {
    expect(COMMANDS["new voucher"]).toBe("/finance/accounting/vouchers/new");
  });

  it("maps 'new leave' to the real leave-application route", () => {
    expect(COMMANDS["new leave"]).toBe("/hr/leave/apply");
  });

  it("maps 'go to settings' to a route that exists", () => {
    expect(COMMANDS["go to settings"]).toBe("/settings/branding");
  });

  // Fails-before / passes-after: these targets do not exist in the App Router
  // tree (no /finance/vouchers, leave creation is /hr/leave/apply, /settings has
  // no index page) and must never be reintroduced.
  it("never points a command at a known dead route", () => {
    const dead = ["/finance/vouchers/new", "/hr/leave/new", "/settings"];
    for (const target of Object.values(COMMANDS)) {
      expect(dead).not.toContain(target);
    }
  });
});
