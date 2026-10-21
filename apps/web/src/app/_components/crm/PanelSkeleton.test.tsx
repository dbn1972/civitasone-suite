import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { renderWithIntl } from "@/lib/testUtils/intl";
import { PanelSkeleton } from "./PanelSkeleton";

// Every fetch from the detail-page panels hangs, so each stays in its loading state.
vi.mock("@/lib/api/browserClient", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api/browserClient")>("@/lib/api/browserClient");
  return { ...actual, browserFetch: () => new Promise(() => {}) };
});
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

import { ActivityFeed } from "./ActivityFeed";
import { CommunicationLog } from "./CommunicationLog";
import { AddressesEditor } from "./AddressesEditor";
import { ContactRolesEditor } from "./ContactRolesEditor";
import { DocumentAlertsView } from "./DocumentAlertsView";
import { DocumentsPanel } from "./DocumentsPanel";
import { AssignmentLogView } from "./AssignmentLogView";
import { ScoreHistoryView } from "./ScoreHistoryView";
import { QualifyPanel } from "./QualifyPanel";
import { Customer360Panel } from "./Customer360Panel";

describe("PanelSkeleton (GAP-CRM-CONTACTS-DETAIL-06)", () => {
  it("renders aria-busy shimmer rows in a polite status region with a localised label", () => {
    renderWithIntl(<PanelSkeleton rows={4} />);
    const region = screen.getByRole("status");
    expect(region).toHaveAttribute("aria-busy", "true");
    expect(region).toHaveAttribute("aria-live", "polite");
    expect(region.querySelectorAll('div[aria-hidden="true"]')).toHaveLength(4);
    expect(region).toHaveTextContent("Loading…");
  });

  it("falls back to an English label without an intl provider and honours a custom label", () => {
    const { rerender } = render(<PanelSkeleton />);
    expect(screen.getByRole("status")).toHaveTextContent("Loading…");
    rerender(<PanelSkeleton label="Loading timeline…" />);
    expect(screen.getByRole("status")).toHaveTextContent("Loading timeline…");
  });

  it("clamps the row count to 1..5", () => {
    const { container, rerender } = render(<PanelSkeleton rows={0} />);
    expect(container.querySelectorAll('div[aria-hidden="true"]')).toHaveLength(1);
    rerender(<PanelSkeleton rows={99} />);
    expect(container.querySelectorAll('div[aria-hidden="true"]')).toHaveLength(5);
  });
});

describe("contact detail panels share PanelSkeleton while loading (GAP-CRM-CONTACTS-DETAIL-06)", () => {
  beforeEach(() => vi.clearAllMocks());

  const panels: Array<[string, () => JSX.Element]> = [
    ["ActivityFeed", () => <ActivityFeed subjectType="contact" subjectId="c1" />],
    ["CommunicationLog", () => <CommunicationLog subjectType="contact" subjectId="c1" />],
    ["AddressesEditor", () => <AddressesEditor ownerType="contact" ownerId="c1" />],
    ["ContactRolesEditor", () => <ContactRolesEditor contactId="c1" />],
    ["DocumentAlertsView", () => <DocumentAlertsView subjectType="contact" subjectId="c1" />],
    ["DocumentsPanel", () => <DocumentsPanel subjectType="contact" subjectId="c1" canVerify={false} />],
    ["AssignmentLogView", () => <AssignmentLogView leadId="c1" />],
    ["ScoreHistoryView", () => <ScoreHistoryView leadId="c1" />],
    ["QualifyPanel", () => <QualifyPanel leadId="c1" />],
    ["Customer360Panel", () => <Customer360Panel subjectType="contact" subjectId="c1" />],
  ];

  it.each(panels)("%s shows the shimmer skeleton, not a bare 'Loading…' sentence", (_name, make) => {
    const { container } = renderWithIntl(make());
    const busy = container.querySelector('[aria-busy="true"]');
    expect(busy).not.toBeNull();
    expect(busy!.querySelectorAll('div[aria-hidden="true"]').length).toBeGreaterThanOrEqual(1);
    // the old plain-text loading paragraphs are gone
    expect(container.querySelector("p")?.textContent ?? "").not.toMatch(/^Loading|^Checking document/);
  });

  it("Customer360Panel does not claim 'No linked deals' / 'No consent on record' for data that has not arrived", () => {
    renderWithIntl(<Customer360Panel subjectType="contact" subjectId="c1" />);
    expect(screen.queryByText("No linked deals.")).not.toBeInTheDocument();
    expect(screen.queryByText("No consent on record.")).not.toBeInTheDocument();
  });
});
