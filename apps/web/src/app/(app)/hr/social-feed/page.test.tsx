import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));

import SocialFeedPage from "./page";

async function renderPage() {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      {await SocialFeedPage()}
    </NextIntlClientProvider>,
  );
}

// getData() returns fetchJson()'s result directly, so mocking fetchJson
// means these mocks must be the FINAL LoaderResult<FeedData> shape.
function loaderResult(items: Record<string, unknown>[], counts: Record<string, number>, extra: Record<string, unknown> = {}) {
  return { data: { items, counts }, source: "api", ...extra };
}

describe("SocialFeedPage", () => {
  beforeEach(() => fetchJsonMock.mockReset());

  it("shows real period-total counts, not the truncated feed array's length (GAP-HR-SOCIAL-FEED-02)", async () => {
    // Only 1 item in the (truncated) feed array, but the backend's real
    // 7-day count is 12 -- the stat must show 12, not 1.
    fetchJsonMock.mockResolvedValue(
      loaderResult(
        [{ type: "kudos", id: "k1", createdAt: "2026-09-20T10:00:00Z", giver_name: "A", receiver_name: "B", badge: "star" }],
        { kudos7d: 12, birthdaysToday: 0, joinees30d: 0, announcementsActive: 0 },
      ),
    );
    await renderPage();
    expect(screen.getByText("12")).toBeInTheDocument();
  });

  it("falls back to the star emoji for an unrecognized/legacy badge instead of an empty slot (GAP-HR-SOCIAL-FEED-04)", async () => {
    fetchJsonMock.mockResolvedValue(
      loaderResult(
        [{ type: "kudos", id: "k1", createdAt: "2026-09-20T10:00:00Z", giver_name: "A", receiver_name: "B", badge: "not-a-real-badge" }],
        { kudos7d: 1, birthdaysToday: 0, joinees30d: 0, announcementsActive: 0 },
      ),
    );
    await renderPage();
    expect(screen.getByText("⭐")).toBeInTheDocument();
  });

  it("shows the reaction count on a kudos item only when it has reactions (GAP-HR-SOCIAL-FEED-03)", async () => {
    fetchJsonMock.mockResolvedValue(
      loaderResult(
        [
          { type: "kudos", id: "k1", createdAt: "2026-09-20T10:00:00Z", giver_name: "A", receiver_name: "B", badge: "star", reactions: 3 },
          { type: "kudos", id: "k2", createdAt: "2026-09-19T10:00:00Z", giver_name: "C", receiver_name: "D", badge: "star", reactions: 0 },
        ],
        { kudos7d: 2, birthdaysToday: 0, joinees30d: 0, announcementsActive: 0 },
      ),
    );
    await renderPage();
    expect(screen.getByText("3 reactions")).toBeInTheDocument();
    expect(screen.queryByText(/^0 reactions/)).not.toBeInTheDocument();
  });

  it("renders a timestamp on each feed item (GAP-HR-SOCIAL-FEED-03)", async () => {
    fetchJsonMock.mockResolvedValue(
      loaderResult(
        [{ type: "kudos", id: "k1", createdAt: "2026-09-20T10:00:00Z", giver_name: "A", receiver_name: "B", badge: "star" }],
        { kudos7d: 1, birthdaysToday: 0, joinees30d: 0, announcementsActive: 0 },
      ),
    );
    await renderPage();
    expect(screen.getByText("20 Sep 2026")).toBeInTheDocument();
  });

  it("uses one constant card title across empty/filled/error states, and now that the Give Kudos action genuinely exists, the empty-state copy that names it is honest again (GAP-HR-SOCIAL-FEED-06/03)", async () => {
    fetchJsonMock.mockResolvedValue(loaderResult([], { kudos7d: 0, birthdaysToday: 0, joinees30d: 0, announcementsActive: 0 }));
    await renderPage();
    expect(screen.getByText("Latest Updates")).toBeInTheDocument();
    expect(screen.getByText("Give kudos to a colleague to start the feed!")).toBeInTheDocument();
  });

  it("renders the Give Kudos action in the page header (GAP-HR-SOCIAL-FEED-03)", async () => {
    fetchJsonMock.mockResolvedValue(loaderResult([], { kudos7d: 0, birthdaysToday: 0, joinees30d: 0, announcementsActive: 0 }));
    await renderPage();
    expect(screen.getByRole("button", { name: "+ Give Kudos" })).toBeInTheDocument();
  });

  it("renders a timestamp on birthday and new_joinee items too, not just kudos/announcement", async () => {
    fetchJsonMock.mockResolvedValue(
      loaderResult(
        [
          { type: "birthday", id: "b1", createdAt: "2026-09-20T10:00:00Z", name: "Priya", department: "Finance", designation: "Officer" },
          { type: "new_joinee", id: "j1", createdAt: "2026-09-15T10:00:00Z", name: "Ravi", department: "Works", designation: "Engineer" },
        ],
        { kudos7d: 0, birthdaysToday: 1, joinees30d: 1, announcementsActive: 0 },
      ),
    );
    await renderPage();
    expect(screen.getByText("20 Sep 2026")).toBeInTheDocument();
    expect(screen.getByText("15 Sep 2026")).toBeInTheDocument();
  });

  it("shows the same constant title and a real error message on failure, not a bare 'Feed'", async () => {
    fetchJsonMock.mockResolvedValue({
      data: { items: [], counts: { kudos7d: 0, birthdaysToday: 0, joinees30d: 0, announcementsActive: 0 } },
      source: "error",
    });
    await renderPage();
    expect(screen.getByText("Latest Updates")).toBeInTheDocument();
    expect(screen.getByText("We couldn't load social feed.")).toBeInTheDocument();
  });
});
