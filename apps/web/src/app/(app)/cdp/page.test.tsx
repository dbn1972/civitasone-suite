import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import Page from "./page";

describe("CDP hub page (GAP-CDP-HOME-01 / GAP-CDP-HOME-04)", () => {
  // GAP-CDP-HOME-01: the Segments tile used to say "Create and manage audience
  // segments for campaigns", implying write access that the read-only
  // /cdp/segments route does not offer. It now says "View audience segments …"
  // so the description matches the destination.
  it("Segments tile says View audience segments, never Create and manage (GAP-CDP-HOME-01)", async () => {
    render(await Page());
    expect(screen.getByText(/View audience segments for campaigns/i)).toBeInTheDocument();
    expect(screen.queryByText(/Create and manage audience segments/i)).not.toBeInTheDocument();
  });

  // GAP-CDP-HOME-04: all five tile href destinations must be present so tiles
  // cannot lead to a dead route.
  it("includes all five tile destinations — profiles, identity, segments, events, steward (GAP-CDP-HOME-04)", async () => {
    render(await Page());
    // Each tile renders a <Link> whose accessible role is "link".
    const links = screen.getAllByRole("link");
    const hrefs = links.map((l) => l.getAttribute("href"));
    expect(hrefs).toContain("/cdp/profiles");
    expect(hrefs).toContain("/cdp/identity");
    expect(hrefs).toContain("/cdp/segments");
    expect(hrefs).toContain("/cdp/events");
    expect(hrefs).toContain("/cdp/steward");
  });
});
