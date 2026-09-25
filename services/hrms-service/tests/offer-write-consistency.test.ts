/**
 * MEDIUM finding: the legacy PATCH /v1/hrms/applications/:id/offer path
 * (commands.offerApplication -> consumer.ts's COMMANDS.applicationOffer
 * subscriber) and the compliance approval-chain path (offer-routes.ts's
 * POST /v1/hrms/applications/:id/offers -> f3-consumer.ts's
 * "recruitment_offer_routes__0" case) both write hrms_offers via
 * offer-repo.ts's insertOffer, but used to populate very different column
 * sets and an undefined status value for the legacy row (see consumer.ts's
 * doc comment on the fix). This test drives BOTH real publish-time code
 * paths (not a hand-rolled reimplementation of them) and asserts the two
 * resulting insertOffer call arguments are structurally consistent.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const H = vi.hoisted(() => ({
  insertOfferMock: vi.fn(),
  maxVersionMock: vi.fn(async () => 0),
  claimForOfferMock: vi.fn(async () => true),
}));

vi.mock("../src/shared/db.js", async (io) => {
  // markProcessed() runs insert(...).values(...).onConflictDoNothing().returning()
  // on the tx before either consumer's own write -- same stub used by
  // offer-route.test.ts for the identical reason.
  const stubTx = { insert: () => ({ values: () => ({ onConflictDoNothing: () => ({ returning: async () => [{ messageId: "stub" }] }) }) }) };
  return {
    ...(await io<Record<string, unknown>>()),
    db: { transaction: async (cb: (tx: unknown) => Promise<unknown>) => cb(stubTx) },
  };
});

vi.mock("../src/modules/recruitment/offer-repo.js", async (io) => ({
  ...(await io<Record<string, unknown>>()),
  insertOffer: (...a: unknown[]) => H.insertOfferMock(...a),
  maxOfferVersionTx: (...a: unknown[]) => H.maxVersionMock(...a),
}));

vi.mock("../src/modules/recruitment/repo.js", async (io) => ({
  ...(await io<Record<string, unknown>>()),
  claimApplicationForOffer: (...a: unknown[]) => H.claimForOfferMock(...a),
}));

import { queue } from "../src/shared/infra.js";
import { registerRecruitmentConsumers } from "../src/modules/recruitment/consumer.js";
import { registerF3_recruitment_Consumers } from "../src/modules/recruitment/f3-consumer.js";
import { offerApplication } from "../src/modules/recruitment/commands.js";
import { publishF3Write } from "../src/shared/f3-publish.js";
import type { RequestContext } from "@civitasone/types";

registerRecruitmentConsumers(queue);
registerF3_recruitment_Consumers(queue);

/** Await the in-memory queue's fan-out so both consumers' writes have happened. */
async function drain(): Promise<void> {
  await (queue as unknown as import("@civitasone/queue").MemoryQueue).drain();
}

const TENANT = "aaaaaaaa-1111-4000-8000-00000000ffee";
const ACTOR = "aaaaaaaa-7777-4000-8000-00000000ffee";
const LEGACY_APPLICATION = "cccccccc-0000-4000-8000-00000000e001";
const COMPLIANCE_APPLICATION = "cccccccc-0000-4000-8000-00000000e002";
const COMPLIANCE_OFFER_ID = "dddddddd-0000-4000-8000-00000000f001";

const ctx: RequestContext = {
  tenantId: TENANT, actorId: ACTOR, actorType: "user", roles: ["hr_admin"], correlationId: "corr-consistency-1",
};

const OFFER_STATUS_VOCABULARY = [
  "draft", "pending_approval", "approved", "returned", "released",
  "accepted", "declined", "withdrawn", "expired", "revised",
];

describe("legacy vs compliance offer write consistency", () => {
  beforeEach(() => {
    H.insertOfferMock.mockClear();
    H.maxVersionMock.mockClear();
    H.claimForOfferMock.mockClear();
  });

  it("populate the same column set, agree on gross CTC for equivalent input, and both land on a status offer-domain.ts recognises", async () => {
    // Legacy flow: a single lump-sum ctcMinor, exactly what the real PATCH
    // .../offer route's offerApplicationBody carries.
    await offerApplication(ctx, LEGACY_APPLICATION, { ctcMinor: 6_000_000, currency: "INR", joiningDate: "2026-10-01" });
    await drain();
    expect(H.insertOfferMock).toHaveBeenCalledTimes(1);
    const legacyRow = H.insertOfferMock.mock.calls[0]?.[1] as Record<string, unknown>;

    H.insertOfferMock.mockClear();

    // Compliance flow: driven through the exact same publishF3Write call the
    // real POST /v1/hrms/applications/:id/offers route makes (not a
    // reimplementation) -- an equivalent total attributed entirely to
    // basicMinor, no bonus/relocation/variable, so the two are financially
    // equivalent offers.
    await publishF3Write(ctx, "recruitment_offer_routes__0", COMPLIANCE_OFFER_ID, {
      body: { basicMinor: 6_000_000, joiningBonusMinor: 0, relocationMinor: 0, variablePayMinor: 0, joiningDate: "2026-10-01" },
      params: { id: COMPLIANCE_APPLICATION },
      query: {},
    });
    await drain();
    expect(H.insertOfferMock).toHaveBeenCalledTimes(1);
    const complianceRow = H.insertOfferMock.mock.calls[0]?.[1] as Record<string, unknown>;

    // Same columns populated -- the money breakdown and numbering that used
    // to silently stay at their schema defaults (0 / null) for a legacy row.
    for (const key of [
      "offerNo", "offerVersion", "basicMinor", "joiningBonusMinor",
      "relocationMinor", "variablePayMinor", "grossCtcMinor", "ctcMinor", "status",
    ]) {
      expect(legacyRow, `legacy row missing "${key}"`).toHaveProperty(key);
      expect(complianceRow, `compliance row missing "${key}"`).toHaveProperty(key);
    }
    expect(legacyRow.offerNo).toMatch(/^OFR-/);
    expect(complianceRow.offerNo).toMatch(/^OFR-/);

    // Equivalent input compensation yields the same gross CTC either way.
    expect(legacyRow.grossCtcMinor).toBe(complianceRow.grossCtcMinor);
    expect(legacyRow.grossCtcMinor).toBe(6_000_000n);

    // Same status SEMANTICS, not force-equal values: the compliance chain's
    // whole point is its approval gate, so it legitimately starts at
    // "draft" pending submit -> approve x N -> release, while the legacy
    // shortcut has no approval chain and goes straight to the equivalent
    // "ready for the candidate" state the compliance chain reaches right
    // after ITS OWN /release step. What must be true of both is that
    // neither is the old undefined "sent" value offer-domain.ts's
    // canRelease/isTerminal/isOfferEditable never recognised (which made a
    // legacy offer un-actionable via accept/decline/expire, since all three
    // require status === "released" exactly).
    expect(legacyRow.status).toBe("released");
    expect(legacyRow.releasedAt).toBeInstanceOf(Date);
    expect(complianceRow.status).toBe("draft");
    expect(OFFER_STATUS_VOCABULARY).toContain(legacyRow.status);
    expect(OFFER_STATUS_VOCABULARY).toContain(complianceRow.status);

    // Honest, not fabricated: the legacy path never ran an approval chain,
    // so it must not claim one did.
    expect(legacyRow.approvedAt ?? null).toBeNull();
  });
});
