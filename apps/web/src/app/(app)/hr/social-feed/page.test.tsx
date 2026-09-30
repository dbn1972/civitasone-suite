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

  it("renders a timestamp on each feed item (GAP-HR-SOCIAL-FEED-03)", async () => {
    fetchJsonMock.mockResolvedValue(
      loaderResult(
        [{ type: "kudos", id: "k1", createdAt: "2026-09-20T10:00:00Z", giver_name: "A", receiver_name: "B", badge: "star" }],
        { kudos7d: 1, birthdaysToday: 0, joinees30d: 0, announcementsActive: 0 },
      ),
    );
    await renderPage();
    expect(screen.getByText("20/09/2026")).toBeInTheDocument();
  });

  it("uses one constant card title across empty/filled/error states, and an honest empty message that promises no missing action (GAP-HR-SOCIAL-FEED-06/03)", async () => {
    fetchJsonMock.mockResolvedValue(loaderResult([], { kudos7d: 0, birthdaysToday: 0, joinees30d: 0, announcementsActive: 0 }));
    await renderPage();
    expect(screen.getByText("Latest Updates")).toBeInTheDocument();
    expect(screen.queryByText("Give kudos to a colleague to start the feed!")).not.toBeInTheDocument();
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
