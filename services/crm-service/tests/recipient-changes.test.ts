/**
 * shared/recipient-changes.ts -- which recipients of an escalation rule are re-verified on a save.
 * The one rule behind both the lead-escalation and the task-escalation editors; pure, so tested directly.
 */
import { describe, it, expect } from "vitest";
import { recipientsToVerify } from "../src/shared/recipient-changes.js";

const ROLE = "sales_manager";
const USER = "11111111-2222-4333-8444-555555555555";
const OTHER_USER = "99999999-2222-4333-8444-555555555555";

describe("recipientsToVerify", () => {
  it("a NEW rule verifies every recipient it names", () => {
    expect(recipientsToVerify(undefined, { recipientRole: ROLE, recipientId: USER, enabled: true })).toEqual({ recipientRole: ROLE, recipientId: USER });
    expect(recipientsToVerify(undefined, { recipientRole: ROLE, enabled: false })).toEqual({ recipientRole: ROLE });
    expect(recipientsToVerify(undefined, { recipientId: USER, enabled: true })).toEqual({ recipientId: USER });
  });

  it("a NEW rule with no recipient verifies nothing", () => {
    expect(recipientsToVerify(undefined, { enabled: true })).toEqual({});
    expect(recipientsToVerify(undefined, { recipientRole: "", recipientId: null, enabled: true })).toEqual({});
  });

  it("an unchanged recipient is NOT verified -- the rule can be tuned or disabled once its recipient is gone", () => {
    const current = { recipientRole: ROLE, recipientId: USER, enabled: true };
    expect(recipientsToVerify(current, { ...current })).toEqual({});
    expect(recipientsToVerify(current, { ...current, enabled: false })).toEqual({});
  });

  it("only the recipient that CHANGED is verified", () => {
    const current = { recipientRole: ROLE, recipientId: USER, enabled: true };
    expect(recipientsToVerify(current, { ...current, recipientId: OTHER_USER })).toEqual({ recipientId: OTHER_USER });
    expect(recipientsToVerify(current, { ...current, recipientRole: "lead_desk" })).toEqual({ recipientRole: "lead_desk" });
    expect(recipientsToVerify(current, { recipientRole: "lead_desk", recipientId: OTHER_USER, enabled: true }))
      .toEqual({ recipientRole: "lead_desk", recipientId: OTHER_USER });
  });

  it("clearing a recipient needs no lookup", () => {
    const current = { recipientRole: ROLE, recipientId: USER, enabled: true };
    expect(recipientsToVerify(current, { recipientRole: null, recipientId: USER, enabled: true })).toEqual({});
    expect(recipientsToVerify(current, { recipientRole: ROLE, recipientId: undefined, enabled: true })).toEqual({});
  });

  it("switching a rule back ON verifies every recipient it will have, changed or not", () => {
    const stored = { recipientRole: ROLE, recipientId: USER, enabled: false };
    expect(recipientsToVerify(stored, { ...stored, enabled: true })).toEqual({ recipientRole: ROLE, recipientId: USER });
  });

  it("switching a rule OFF, or leaving it enabled, is not 'enabling'", () => {
    const enabled = { recipientRole: ROLE, enabled: true };
    expect(recipientsToVerify(enabled, { ...enabled, enabled: true })).toEqual({});
    expect(recipientsToVerify({ ...enabled, enabled: false }, { ...enabled, enabled: false })).toEqual({});
    expect(recipientsToVerify(enabled, { ...enabled, enabled: false })).toEqual({});
  });
});
