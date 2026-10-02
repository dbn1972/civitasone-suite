/**
 * GAP-RECRUITMENT-CAREERS-PORTAL-APPLICATION-DETAIL-06: the candidate timeline carries the shortlist date and,
 * while shortlisted, the next CONFIRMED interview slot (date/time/mode/venue). Anything not exactly a scheduled
 * slot is never shown to a candidate.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";

const APP_ID = "aaaaaaaa-0006-4000-8000-00000000a006";
const H = vi.hoisted(() => ({
  stage: "shortlisted",
  interviews: [] as Array<Record<string, unknown>>,
  listInterviews: vi.fn(),
}));

vi.mock("../src/shared/db.js", async (io) => {
  let call = 0;
  return {
    ...(await io<Record<string, unknown>>()),
    scopedRead: async () => {
      call += 1;
      if (call % 2 === 1) {
        return [{
          id: "aaaaaaaa-0006-4000-8000-00000000a006", applicationNo: "APP-2026-AB12CD", jobOpeningId: "bbbbbbbb-0006-4000-8000-00000000b006",
          stage: H.stage, status: "active", appliedAt: new Date("2026-03-01T10:00:00Z"),
          screeningDecision: "shortlisted", screenedAt: new Date("2026-03-05T04:30:00Z"),
        }];
      }
      return [{ id: "bbbbbbbb-0006-4000-8000-00000000b006", title: "Assistant", refNo: "R1", location: null, description: null, payRange: null, vacancies: 1, closesAt: null }];
    },
  };
});
vi.mock("../src/modules/recruitment/repo.js", async (io) => ({
  ...(await io<Record<string, unknown>>()),
  listInterviews: (...a: unknown[]) => H.listInterviews(...a),
}));
vi.mock("../src/modules/recruitment/candidate-public-auth-routes.js", () => ({
  verifyCandToken: () => ({ candidateId: "c1", tenantId: "cccccccc-0006-4000-8000-00000000c006", email: "a@example.gov.in" }),
}));

import { candidatePublicPortalRoutes } from "../src/modules/recruitment/candidate-public-portal-routes.js";
import { buildStageTimeline, toTimelineInterview } from "../src/modules/recruitment/candidate-portal-timeline.js";

const slot = (over: Record<string, unknown> = {}) => ({
  id: "i1", applicationId: APP_ID, scheduledDate: "2099-10-05", scheduledTime: "09:30", durationMinutes: 45,
  mode: "in_person", location: "Room 4, Secretariat", meetingLink: null, status: "scheduled", ...over,
});

async function detail() {
  const app = Fastify();
  await app.register(candidatePublicPortalRoutes);
  const res = await app.inject({ method: "GET", url: `/v1/careers/portal/applications/${APP_ID}`, headers: { authorization: "Bearer x.y" } });
  await app.close();
  return res.json() as { timeline: Array<{ stage: string; label: string; status: string; note: string; interview?: Record<string, unknown> }> };
}

describe("toTimelineInterview", () => {
  it("projects a scheduled slot to an ISO instant with venue and https-only link", () => {
    expect(toTimelineInterview(slot() as never)).toEqual({ at: "2099-10-05T09:30:00.000Z", mode: "in_person", durationMinutes: 45, venue: "Room 4, Secretariat", meetingLink: null });
    expect(toTimelineInterview(slot({ meetingLink: "https://meet.example.gov.in/x" }) as never)?.meetingLink).toBe("https://meet.example.gov.in/x");
    expect(toTimelineInterview(slot({ meetingLink: "javascript:alert(1)" }) as never)?.meetingLink).toBeNull();
  });
  it("drops anything that is not a confirmed scheduled slot", () => {
    expect(toTimelineInterview(slot({ status: "cancelled" }) as never)).toBeNull();
    expect(toTimelineInterview(slot({ status: "completed" }) as never)).toBeNull();
    expect(toTimelineInterview(slot({ scheduledTime: "not-a-time" }) as never)).toBeNull();
    expect(toTimelineInterview(null)).toBeNull();
  });
});

describe("buildStageTimeline notes", () => {
  it("has no note for a stage without a timestamp (never an invalid date)", () => {
    const t = buildStageTimeline({ stage: "offered", appliedAt: new Date("2026-03-01T10:00:00Z") });
    expect(t.map((e) => e.note)).toEqual(["2026-03-01T10:00:00.000Z", "", "", "", "", ""]);
  });
  it("labels the interview step 'Interview' unless a slot exists", () => {
    const t = buildStageTimeline({ stage: "shortlisted", appliedAt: null });
    expect(t.find((e) => e.stage === "interview")?.label).toBe("Interview");
  });
  it("adds the shortlist date once shortlisted and the slot to the interview step, making it current", () => {
    const t = buildStageTimeline({ stage: "shortlisted", appliedAt: null, shortlistedAt: new Date("2026-03-05T04:30:00Z"), interview: slot() as never });
    const sl = t.find((e) => e.stage === "shortlisted")!;
    const iv = t.find((e) => e.stage === "interview")!;
    expect(sl).toMatchObject({ status: "done", note: "2026-03-05T04:30:00.000Z" });
    expect(iv).toMatchObject({ status: "active", label: "Interview Scheduled", note: "2099-10-05T09:30:00.000Z" });
    expect(iv.interview?.venue).toBe("Room 4, Secretariat");
  });
  it("does not date the shortlisted step before it is reached", () => {
    const t = buildStageTimeline({ stage: "applied", appliedAt: null, shortlistedAt: new Date("2026-03-05T04:30:00Z") });
    expect(t.find((e) => e.stage === "shortlisted")?.note).toBe("");
  });
});

describe("portal detail route", () => {
  beforeEach(() => { H.stage = "shortlisted"; H.listInterviews.mockReset(); });

  it("publishes the next confirmed slot (earliest first) and never a cancelled one", async () => {
    H.listInterviews.mockResolvedValue([
      slot({ id: "late", scheduledDate: "2099-10-09" }), slot({ id: "gone", scheduledDate: "2099-10-01", status: "cancelled" }), slot(),
    ]);
    const json = await detail();
    const iv = json.timeline.find((e) => e.stage === "interview")!;
    expect(iv.interview).toMatchObject({ at: "2099-10-05T09:30:00.000Z", venue: "Room 4, Secretariat" });
    expect(iv.status).toBe("active");
    expect(json.timeline.find((e) => e.stage === "shortlisted")?.note).toBe("2026-03-05T04:30:00.000Z");
  });

  it("skips a stale past 'scheduled' slot and shows the next future one", async () => {
    H.listInterviews.mockResolvedValue([slot({ id: "stale", scheduledDate: "2020-01-01" }), slot({ id: "next", scheduledDate: "2099-01-02" })]);
    const iv = (await detail()).timeline.find((e) => e.stage === "interview")!;
    expect(iv.interview?.at).toBe("2099-01-02T09:30:00.000Z");
    H.listInterviews.mockResolvedValue([slot({ scheduledDate: "2020-01-01" })]);
    expect((await detail()).timeline.find((e) => e.stage === "interview")?.interview).toBeUndefined();
  });

  it("shows no interview detail when nothing is scheduled", async () => {
    H.listInterviews.mockResolvedValue([slot({ status: "cancelled" })]);
    const json = await detail();
    const iv = json.timeline.find((e) => e.stage === "interview")!;
    expect(iv.interview).toBeUndefined();
    expect(iv.label).toBe("Interview");
    expect(iv.note).toBe("");
  });

  it("does not look up interviews for an application that is not shortlisted", async () => {
    H.stage = "applied";
    await detail();
    expect(H.listInterviews).not.toHaveBeenCalled();
  });
});
