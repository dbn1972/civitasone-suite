import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

// GAP-DOCUMENTS-INBOX-05: the page now sources its strings from the
// `documentsInbox` i18n namespace. Under plain Vitest next-intl/server resolves
// to a throwing guard, so we mock it to read the real catalogue — `messages`
// is swapped per-test to assert the hi locale renders translated headers.
import enMsgs from "@/messages/en.json";
import hiMsgs from "@/messages/hi.json";
let messages: Record<string, unknown> = enMsgs as Record<string, unknown>;
function resolveMsg(ns: string, key: string, params?: Record<string, unknown>): string {
  const hit = `${ns}.${key}`.split(".").reduce<unknown>((o, k) => (o as Record<string, unknown> | undefined)?.[k], messages);
  if (typeof hit !== "string") throw new Error(`missing message ${ns}.${key}`);
  return params ? hit.replace(/\{(\w+)\}/g, (_m, p) => String(params[p] ?? "")) : hit;
}
vi.mock("next-intl/server", () => ({
  getTranslations: async (ns: string) => (key: string, params?: Record<string, unknown>) => resolveMsg(ns, key, params),
}));

import DocumentInboxPage, { isOverdue, assigneeLabel } from "./page";
const getDocumentInbox = vi.fn();
const getDocumentStats = vi.fn();
vi.mock("../_data/loaders", () => ({
  getDocumentInbox: () => getDocumentInbox(),
  getDocumentStats: () => getDocumentStats(),
}));

const UUID = "11111111-2222-4333-8444-555555555555";

function dak(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: UUID,
    subject: "Property tax file",
    priority: "urgent",
    status: "pending",
    assignedTo: "99999999-8888-4777-8666-555555555555",
    dueDate: "2000-01-01",
    createdAt: "2026-09-01T00:00:00Z",
    ...over,
  };
}

const STATS = {
  inboxCount: 120, pendingCount: 7, urgentCount: 9,
  inboxUrgentCount: 3, inboxPendingCount: 5, inboxForwardedCount: 2,
};

describe("DocumentInboxPage", () => {
  beforeEach(() => { getDocumentInbox.mockReset(); getDocumentStats.mockReset(); messages = enMsgs as Record<string, unknown>; });

  it("INBOX-01: has no <button> without an onClick/href; View is a link to the detail route", async () => {
    getDocumentInbox.mockResolvedValue({ data: [dak()], source: "api" });
    getDocumentStats.mockResolvedValue({ data: STATS, source: "api" });
    const { container } = render(await DocumentInboxPage());
    // No dead "+ New Dak" button, and no bare buttons at all in the server markup.
    expect(screen.queryByRole("button", { name: /new dak/i })).not.toBeInTheDocument();
    expect(container.querySelectorAll("button")).toHaveLength(0);
    const view = screen.getByRole("link", { name: "View" });
    expect(view).toHaveAttribute("href", `/documents/inbox/${UUID}`);
  });

  it("INBOX-01: subtitle no longer promises actions that do not exist on the list", async () => {
    getDocumentInbox.mockResolvedValue({ data: [dak()], source: "api" });
    getDocumentStats.mockResolvedValue({ data: STATS, source: "api" });
    render(await DocumentInboxPage());
    expect(screen.queryByText(/Acknowledge, forward, or submit for approval/)).not.toBeInTheDocument();
  });

  it("INBOX-02: KPI tiles come from the summary, not the (capped) list length", async () => {
    getDocumentInbox.mockResolvedValue({ data: [dak(), dak({ id: UUID.replace(/5/g, "6") })], source: "api" });
    getDocumentStats.mockResolvedValue({ data: STATS, source: "api" });
    render(await DocumentInboxPage());
    // list length is 2, but the summary says 120 — the tile must show 120.
    expect(screen.getByText("120")).toBeInTheDocument();
  });

  it("INBOX-03: priority/status render humanized, not raw lowercase", async () => {
    getDocumentInbox.mockResolvedValue({ data: [dak({ priority: "urgent", status: "pending" })], source: "api" });
    getDocumentStats.mockResolvedValue({ data: STATS, source: "api" });
    render(await DocumentInboxPage());
    const row = screen.getByRole("link", { name: "Property tax file" }).closest("tr")!;
    expect(within(row).getByText("Urgent")).toBeInTheDocument();
    expect(within(row).getByText("Pending")).toBeInTheDocument();
  });

  it("INBOX-03: an overdue, unacknowledged dak is flagged; acknowledged/future are not", () => {
    expect(isOverdue("2000-01-01", "pending")).toBe(true);
    expect(isOverdue("2000-01-01", "acknowledged")).toBe(false);
    expect(isOverdue("2999-01-01", "pending")).toBe(false);
    expect(isOverdue(null, "pending")).toBe(false);
  });

  it("INBOX-04: shows a reference and never prints the raw assignee uuid", async () => {
    getDocumentInbox.mockResolvedValue({ data: [dak()], source: "api" });
    getDocumentStats.mockResolvedValue({ data: STATS, source: "api" });
    const { container } = render(await DocumentInboxPage());
    expect(container.textContent).toContain(UUID); // the dak's own reference is shown
    expect(container.textContent).not.toContain("99999999-8888-4777-8666-555555555555");
    expect(assigneeLabel("99999999-8888-4777-8666-555555555555")).not.toContain("-");
    expect(assigneeLabel(null)).toBe("—");
  });

  it("INBOX-05: headers come from the i18n catalogue — switching to hi renders translated column headers", async () => {
    getDocumentInbox.mockResolvedValue({ data: [dak()], source: "api" });
    getDocumentStats.mockResolvedValue({ data: STATS, source: "api" });
    // English default: the catalogue drives the header text.
    const en = render(await DocumentInboxPage());
    expect(en.getByRole("columnheader", { name: "Subject" })).toBeInTheDocument();
    expect(en.getByRole("columnheader", { name: "Priority" })).toBeInTheDocument();
    en.unmount();
    // Switch locale to hi: the same page must render Hindi headers (parity).
    messages = hiMsgs as Record<string, unknown>;
    const hi = render(await DocumentInboxPage());
    expect(hi.getByRole("columnheader", { name: "विषय" })).toBeInTheDocument();
    expect(hi.getByRole("columnheader", { name: "प्राथमिकता" })).toBeInTheDocument();
  });
});
