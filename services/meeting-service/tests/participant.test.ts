/**
 * Participant module — unit tests for pure domain logic + Zod validators (task 7.1).
 *
 * Covers role assignment validation (Req 5.1), RSVP resolution incl. decline-reason rule
 * (Req 5.2, 5.6), confirmed-vs-threshold quorum computation (Req 5.3, 5.4), proxy/nominee
 * validation against the approved list (Req 5.5), and special-invitee item scoping (Req 5.7).
 */
import { describe, expect, it } from "vitest";
import {
  PARTICIPANT_ROLES,
  isParticipantRole,
  isQuorumCountingRole,
  assertValidRoleAssignment,
  responseToStatus,
  resolveRsvp,
  computeQuorumConfirmation,
  assertNomineeAllowed,
  canAccessAgendaItem,
} from "../src/modules/participant/domain.js";
import {
  participantAddSchema,
  participantRespondSchema,
  participantNominateSchema,
} from "../src/modules/participant/validators.js";

const ITEM_A = "11111111-1111-1111-1111-111111111111";
const ITEM_B = "22222222-2222-2222-2222-222222222222";
const EMP = "33333333-3333-3333-3333-333333333333";
const NOM = "44444444-4444-4444-4444-444444444444";

describe("role assignment (Req 5.1)", () => {
  it("recognises exactly the six participant roles", () => {
    expect([...PARTICIPANT_ROLES]).toEqual([
      "chairperson",
      "member",
      "secretary",
      "special_invitee",
      "observer",
      "presenter",
    ]);
    expect(isParticipantRole("member")).toBe(true);
    expect(isParticipantRole("bogus")).toBe(false);
  });

  it("counts only chairperson and member toward quorum (Req 5.3)", () => {
    expect(isQuorumCountingRole("chairperson")).toBe(true);
    expect(isQuorumCountingRole("member")).toBe(true);
    expect(isQuorumCountingRole("secretary")).toBe(false);
    expect(isQuorumCountingRole("observer")).toBe(false);
    expect(isQuorumCountingRole("special_invitee")).toBe(false);
  });

  it("rejects an unknown role", () => {
    expect(() => assertValidRoleAssignment({ role: "nope" })).toThrowError(/unknown participant role/);
  });

  it("requires a special_invitee to be scoped to at least one agenda item (Req 5.7)", () => {
    expect(() => assertValidRoleAssignment({ role: "special_invitee" })).toThrowError(
      /scoped to at least one agenda item/,
    );
    expect(() =>
      assertValidRoleAssignment({ role: "special_invitee", agendaItemIds: [ITEM_A] }),
    ).not.toThrow();
  });

  it("forbids agenda-item scoping for non special-invitee roles (Req 5.7)", () => {
    expect(() => assertValidRoleAssignment({ role: "member", agendaItemIds: [ITEM_A] })).toThrowError(
      /only valid for a special_invitee/,
    );
    expect(() => assertValidRoleAssignment({ role: "member" })).not.toThrow();
  });
});

describe("RSVP resolution (Req 5.2, 5.6)", () => {
  it("maps responses to invitation statuses", () => {
    expect(responseToStatus("accept")).toBe("accepted");
    expect(responseToStatus("tentative")).toBe("tentative");
    expect(responseToStatus("decline")).toBe("declined");
  });

  it("requires a reason on decline and forbids one otherwise", () => {
    expect(resolveRsvp({ response: "decline", declineReason: "on leave" })).toBe("declined");
    expect(() => resolveRsvp({ response: "decline" })).toThrowError(/requires a reason/);
    expect(() => resolveRsvp({ response: "decline", declineReason: "  " })).toThrowError(/requires a reason/);
    expect(resolveRsvp({ response: "accept" })).toBe("accepted");
    expect(() => resolveRsvp({ response: "accept", declineReason: "x" })).toThrowError(
      /only valid with a decline/,
    );
  });
});

describe("quorum confirmation tally (Req 5.3, 5.4)", () => {
  const roster = [
    { role: "chairperson", invitationStatus: "accepted" },
    { role: "member", invitationStatus: "accepted" },
    { role: "member", invitationStatus: "tentative" },
    { role: "member", invitationStatus: "declined" },
    { role: "member", invitationStatus: "pending" },
    { role: "secretary", invitationStatus: "accepted" }, // not counted
    { role: "observer", invitationStatus: "accepted" }, // not counted
  ];

  it("counts only quorum-bearing roles and reports the breakdown", () => {
    const q = computeQuorumConfirmation(roster, 3);
    expect(q.confirmedCount).toBe(2);
    expect(q.tentativeCount).toBe(1);
    expect(q.declinedCount).toBe(1);
    expect(q.pendingCount).toBe(1);
    expect(q.met).toBe(false);
    expect(q.shortfall).toBe(1);
  });

  it("reports quorum met with zero shortfall", () => {
    const q = computeQuorumConfirmation(roster, 2);
    expect(q.met).toBe(true);
    expect(q.shortfall).toBe(0);
  });

  it("clamps a negative threshold to zero (always met)", () => {
    const q = computeQuorumConfirmation([], -5);
    expect(q.threshold).toBe(0);
    expect(q.met).toBe(true);
    expect(q.shortfall).toBe(0);
  });
});

describe("proxy / nominee validation (Req 5.5)", () => {
  it("accepts an approved nominee for a member", () => {
    expect(() =>
      assertNomineeAllowed({
        participantRole: "member",
        participantEmployeeId: EMP,
        nomineeId: NOM,
        approvedNomineeIds: [NOM],
      }),
    ).not.toThrow();
  });

  it("rejects a nominee not in the approved list", () => {
    expect(() =>
      assertNomineeAllowed({
        participantRole: "member",
        participantEmployeeId: EMP,
        nomineeId: NOM,
        approvedNomineeIds: [],
      }),
    ).toThrowError(/approved nominee list/);
  });

  it("rejects self-nomination", () => {
    expect(() =>
      assertNomineeAllowed({
        participantRole: "member",
        participantEmployeeId: EMP,
        nomineeId: EMP,
        approvedNomineeIds: [EMP],
      }),
    ).toThrowError(/cannot nominate themselves/);
  });

  it("forbids non quorum-bearing roles from nominating", () => {
    expect(() =>
      assertNomineeAllowed({
        participantRole: "observer",
        participantEmployeeId: EMP,
        nomineeId: NOM,
        approvedNomineeIds: [NOM],
      }),
    ).toThrowError(/may not designate a proxy/);
  });
});

describe("special-invitee item access (Req 5.7)", () => {
  it("restricts a special invitee to their scoped items", () => {
    const p = { role: "special_invitee", agendaItemIds: [ITEM_A] };
    expect(canAccessAgendaItem(p, ITEM_A)).toBe(true);
    expect(canAccessAgendaItem(p, ITEM_B)).toBe(false);
  });

  it("gives non special-invitee roles unrestricted access", () => {
    expect(canAccessAgendaItem({ role: "member" }, ITEM_B)).toBe(true);
  });

  it("denies a special invitee with no scope", () => {
    expect(canAccessAgendaItem({ role: "special_invitee", agendaItemIds: null }, ITEM_A)).toBe(false);
  });
});

describe("validators (route boundary)", () => {
  it("accepts a valid member add and applies isMandatory default", () => {
    const parsed = participantAddSchema.parse({ employeeId: EMP, role: "member" });
    expect(parsed.isMandatory).toBe(true);
  });

  it("requires agendaItemIds for a special_invitee and rejects it for others", () => {
    expect(() => participantAddSchema.parse({ employeeId: EMP, role: "special_invitee" })).toThrow();
    expect(() =>
      participantAddSchema.parse({ employeeId: EMP, role: "member", agendaItemIds: [ITEM_A] }),
    ).toThrow();
    expect(() =>
      participantAddSchema.parse({ employeeId: EMP, role: "special_invitee", agendaItemIds: [ITEM_A] }),
    ).not.toThrow();
  });

  it("validates PII shape for personalEmail / personalPhone", () => {
    expect(() =>
      participantAddSchema.parse({ employeeId: EMP, role: "member", personalEmail: "not-an-email" }),
    ).toThrow();
    expect(() =>
      participantAddSchema.parse({ employeeId: EMP, role: "member", personalPhone: "abc" }),
    ).toThrow();
    expect(() =>
      participantAddSchema.parse({
        employeeId: EMP,
        role: "member",
        personalEmail: "r@example.gov.in",
        personalPhone: "+919876543210",
      }),
    ).not.toThrow();
  });

  it("enforces decline-reason coupling on respond", () => {
    expect(() => participantRespondSchema.parse({ response: "decline" })).toThrow();
    expect(() =>
      participantRespondSchema.parse({ response: "accept", declineReason: "x" }),
    ).toThrow();
    expect(() =>
      participantRespondSchema.parse({ response: "decline", declineReason: "unavailable" }),
    ).not.toThrow();
  });

  it("requires a uuid nominee on nominate", () => {
    expect(() => participantNominateSchema.parse({ nomineeId: "x" })).toThrow();
    expect(() => participantNominateSchema.parse({ nomineeId: NOM })).not.toThrow();
  });
});
