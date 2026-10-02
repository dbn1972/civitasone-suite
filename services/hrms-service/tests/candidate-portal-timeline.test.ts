/**
 * GAP-RECRUITMENT-CAREERS-PORTAL-APPLICATION-DETAIL-01 / -02
 *  - the candidate portal detail payload must never carry HR screening remarks
 *  - terminal stages (rejected / withdrawn) must produce an outcome, not an all-grey rail
 */
import { describe, it, expect, vi } from "vitest";
import Fastify from "fastify";

const APP_ID = "aaaaaaaa-0001-4000-8000-00000000a001";
const state = vi.hoisted(() => ({ stage: "rejected" }));

vi.mock("../src/shared/db.js", async (io) => {
  let call = 0;
  return {
    ...(await io<Record<string, unknown>>()),
    scopedRead: async () => {
      call += 1;
      if (call % 2 === 1) {
        return [{
          id: "aaaaaaaa-0001-4000-8000-00000000a001", applicationNo: "REC/2026/0042", jobOpeningId: "bbbbbbbb-0001-4000-8000-00000000b001",
          stage: state.stage, status: "active", appliedAt: new Date("2026-03-01T10:00:00Z"),
          screeningDecision: "ineligible", screeningRemarks: "SECRET weak communication",
        }];
      }
      return [{ id: "bbbbbbbb-0001-4000-8000-00000000b001", title: "Assistant", refNo: "R1", location: null, description: null, payRange: null, vacancies: 1, closesAt: null }];
    },
  };
});
vi.mock("../src/modules/recruitment/candidate-public-auth-routes.js", () => ({
  verifyCandToken: () => ({ candidateId: "c1", tenantId: "cccccccc-0001-4000-8000-00000000c001", email: "a@example.gov.in" }),
}));

import { candidatePublicPortalRoutes } from "../src/modules/recruitment/candidate-public-portal-routes.js";
import { buildStageTimeline, portalOutcome } from "../src/modules/recruitment/candidate-portal-timeline.js";

describe("candidate portal detail payload", () => {
  it("does not leak internal screeningRemarks and returns a not-selected outcome", async () => {
    const app = Fastify();
    await app.register(candidatePublicPortalRoutes);
    const res = await app.inject({ method: "GET", url: `/v1/careers/portal/applications/${APP_ID}`, headers: { authorization: "Bearer x.y" } });
    expect(res.statusCode).toBe(200);
    expect(res.body).not.toContain("SECRET");
    expect(res.body).not.toContain("ineligible");
    expect(res.body).not.toContain("screeningDecision");
    expect(res.body).not.toContain("screeningRemarks");
    const json = res.json() as { outcome: { kind: string }; timeline: { status: string }[] };
    expect(json.outcome.kind).toBe("not_selected");
    expect(json.timeline.at(-1)?.status).toBe("ended");
    await app.close();
  });
});

describe("candidate portal list payload", () => {
  it("does not leak screeningRemarks or screeningDecision", async () => {
    state.stage = "rejected";
    const app = Fastify();
    await app.register(candidatePublicPortalRoutes);
    const res = await app.inject({ method: "GET", url: "/v1/careers/portal/applications", headers: { authorization: "Bearer x.y" } });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain("REC/2026/0042");
    expect(res.body).not.toContain("SECRET");
    expect(res.body).not.toContain("ineligible");
    expect(res.body).not.toContain("screeningDecision");
    await app.close();
  });
});

describe("buildStageTimeline", () => {
  const appliedAt = new Date("2026-03-01T10:00:00Z");
  it("marks steps before the current stage done and the current active", () => {
    const t = buildStageTimeline({ stage: "shortlisted", appliedAt });
    expect(t.map((e) => e.status)).toEqual(["done", "done", "active", "future", "future", "future"]);
    expect(t[0]!.note).toBe(appliedAt.toISOString());
  });
  it("rejected / not_selected end in a Not selected entry with no active step", () => {
    for (const stage of ["rejected", "not_selected"]) {
      const t = buildStageTimeline({ stage, appliedAt });
      expect(t.map((e) => e.status)).toEqual(["done", "ended"]);
      expect(t[1]!.label).toBe("Not selected");
      expect(portalOutcome(stage)?.kind).toBe("not_selected");
    }
  });
  it("withdrawn ends in Withdrawn by you", () => {
    const t = buildStageTimeline({ stage: "withdrawn", appliedAt });
    expect(t[1]).toMatchObject({ stage: "withdrawn", label: "Withdrawn by you", status: "ended" });
    expect(portalOutcome("withdrawn")?.kind).toBe("withdrawn");
  });
  it("selected is shown as the shortlisted step labelled Selected", () => {
    const t = buildStageTimeline({ stage: "selected", appliedAt });
    expect(t[2]).toMatchObject({ label: "Selected", status: "active" });
  });
  it("in-flight stages have no outcome", () => {
    expect(portalOutcome("offered")).toBeNull();
  });
});
