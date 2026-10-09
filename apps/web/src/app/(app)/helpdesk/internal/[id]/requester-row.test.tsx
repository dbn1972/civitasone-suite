/**
 * GAP2-HELPDESK-INTERNAL-DETAIL-01 — the internal-ticket detail must never
 * render an empty "Requester:" label. The helpdesk-service TicketView exposes
 * no requester name (only an opaque created_by uuid), so when no resolved name
 * is available the Requester row is omitted; when a name IS present it renders.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next/link", () => ({ default: (props: { href: string; children: React.ReactNode }) => <a href={props.href}>{props.children}</a> }));

type Ticket = Record<string, unknown> | null;
let ticket: Ticket = null;

vi.mock("../../../../_data/loaders", () => ({
  getInternalHelpdeskTicketById: async () => ({ data: ticket, source: "api", status: 200 }),
}));

vi.mock("@/lib/auth/roleGuard", async (orig) => {
  const actual = await (orig as () => Promise<Record<string, unknown>>)();
  return { ...actual, getSessionRoles: () => ["citizen"] };
});

import Page from "./page";

const base = {
  id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
  subject: "Printer down",
  priority: "High",
  status: "Open",
};

describe("Internal ticket detail — Requester row (GAP2-HELPDESK-INTERNAL-DETAIL-01)", () => {
  beforeEach(() => { ticket = null; });

  it("omits the Requester row (never a blank label) when no requester name is available", async () => {
    ticket = { ...base };
    render(await Page({ params: { id: base.id } }));
    expect(screen.queryByText("Requester")).not.toBeInTheDocument();
  });

  it("renders the Requester row with the resolved name when present", async () => {
    ticket = { ...base, requester: "Asha Rao" };
    render(await Page({ params: { id: base.id } }));
    expect(screen.getByText("Requester")).toBeInTheDocument();
    expect(screen.getByText("Asha Rao")).toBeInTheDocument();
  });
});
