import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const redirect = vi.fn();
vi.mock("next/navigation", () => ({ redirect: (...a: unknown[]) => redirect(...a) }));

const getDocumentStats = vi.fn();
vi.mock("./_data/loaders", () => ({ getDocumentStats: () => getDocumentStats() }));

import DocumentsHome from "./page";

describe("DocumentsHome (GAP-DOCUMENTS-HOME-01)", () => {
  beforeEach(() => { redirect.mockReset(); getDocumentStats.mockReset(); });

  it("renders a landing with Inbox and Library links and does not blanket-redirect", async () => {
    getDocumentStats.mockResolvedValue({ data: { inboxCount: 5, pendingCount: 0, urgentCount: 0, inboxUrgentCount: 0, inboxPendingCount: 0, inboxForwardedCount: 0 }, source: "api" });
    render(await DocumentsHome());
    expect(redirect).not.toHaveBeenCalled();
    expect(screen.getByRole("link", { name: /e-Office Inbox/ })).toHaveAttribute("href", "/documents/inbox");
    expect(screen.getByRole("link", { name: /Document Library/ })).toHaveAttribute("href", "/documents/library");
    expect(screen.getByText("5")).toBeInTheDocument();
  });
});
