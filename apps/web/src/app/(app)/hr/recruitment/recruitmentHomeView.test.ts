import { describe, it, expect } from "vitest";
import { buildHubCards, deriveCardsFromOpenings, normaliseRosterStatus } from "./recruitmentHomeView";

const STATS = {
  totalOpenings: 9, openVacancies: 4, publishedVacancies: 3, internshipsApprenticeships: 2,
  applicationsInternal: 5, applicationsPublic: 7,
};
const OPENINGS = [
  { status: "open", applicationsReceived: 3, isPublished: true, vacancyType: "internship" },
  { status: "closed", applicationsReceived: 4, isPublished: false, vacancyType: "regular" },
  { status: "open", applicationsReceived: 0, vacancyType: "apprenticeship" },
];

describe("recruitmentHomeView", () => {
  it("uses the dashboard endpoint when it answered", () => {
    const r = buildHubCards({ statsSource: "api", stats: STATS, openings: OPENINGS, openingsSource: "api" });
    expect(r.mode).toBe("api");
    expect(r.cards).toEqual({ total: 9, open: 4, applications: 12, published: 3, internships: 2 });
  });
  it("derives from the openings list on a 403 (permanent restriction)", () => {
    const r = buildHubCards({ statsSource: "error", statsStatus: 403, stats: STATS, openings: OPENINGS, openingsSource: "api" });
    expect(r.mode).toBe("derived");
    expect(r.cards).toEqual({ total: 3, open: 2, applications: 7, published: 1, internships: 2 });
  });
  it("shows nothing (null => '—') for any other failure, and when the list itself failed too", () => {
    for (const args of [
      { statsStatus: 500, openingsSource: "api" as const },
      { statsStatus: undefined, openingsSource: "api" as const },
      { statsStatus: 403, openingsSource: "error" as const },
    ]) {
      const r = buildHubCards({ statsSource: "error", stats: STATS, openings: [], ...args });
      expect(r.mode).toBe("unavailable");
      expect(Object.values(r.cards).every((v) => v === null)).toBe(true);
    }
  });
  it("deriveCardsFromOpenings tolerates an empty list", () => {
    expect(deriveCardsFromOpenings([])).toEqual({ total: 0, open: 0, applications: 0, published: 0, internships: 0 });
  });
  it("normaliseRosterStatus collapses anything unknown to 'none'", () => {
    expect(normaliseRosterStatus("approved")).toBe("approved");
    expect(normaliseRosterStatus("draft")).toBe("draft");
    expect(normaliseRosterStatus(undefined)).toBe("none");
    expect(normaliseRosterStatus("weird")).toBe("none");
  });
});
