import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";

const getPara = vi.hoisted(() => vi.fn());
const getEvents = vi.hoisted(() => vi.fn());
const getNames = vi.hoisted(() => vi.fn());
const session = vi.hoisted(() => ({ roles: [] as string[] }));
vi.mock("@/app/_data/loaders", () => ({
  getFinanceAuditParaById: (...a: unknown[]) => getPara(...a),
  getFinanceAuditParaEvents: (...a: unknown[]) => getEvents(...a),
  getFinanceActorNames: (...a: unknown[]) => getNames(...a),
}));
vi.mock("@/lib/auth/roleGuard", () => ({ getSessionRoles: () => session.roles }));
vi.mock("./AuditParaActions", () => ({ AuditParaActions: (p: { actions: string[] }) => <div>para-actions:{p.actions.join(",")}</div> }));

import AuditParaDetailPage from "./page";

const PARA = (over: Record<string, unknown> = {}) => ({
  source: "api", status: 200,
  data: {
    id: "p1", paraNo: "7/2025", source: "CAG", dept: "Roads", moneyValueMinor: "530000000",
    status: "open", createdAt: "2026-09-01T05:30:00.000Z", updatedAt: "2026-09-02T05:30:00.000Z", version: 1, ...over,
  },
});

describe("AuditParaDetailPage (GAP-FINANCE-AUDIT-PARAS-DETAIL-03/05)", () => {
  beforeEach(() => {
    getPara.mockReset(); getEvents.mockReset(); getNames.mockReset();
    getPara.mockResolvedValue(PARA());
    getEvents.mockResolvedValue({ source: "api", data: [] });
    getNames.mockResolvedValue({});
    session.roles = ["audit_officer"];
  });

  it("humanizes the Status card (not the raw 'open') and formats dates as dd Mon yyyy", async () => {
    render(await AuditParaDetailPage({ params: { id: "p1" } }));
    const card = screen.getByText("Status", { selector: ".stat *" }).closest(".stat");
    expect(card).toHaveTextContent("Open");
    expect(card).not.toHaveTextContent(/\bopen\b/);
    expect(screen.getByText("01 Sep 2026")).toBeInTheDocument();
    expect(screen.queryByText(/T05:30:00/)).not.toBeInTheDocument();
  });

  // GAP-FINANCE-AUDIT-PARAS-DETAIL-04
  it("offers the workflow actions the role and status allow, and none to a read-only role", async () => {
    session.roles = ["audit_officer"];
    const a = render(await AuditParaDetailPage({ params: { id: "p1" } }));
    expect(screen.queryByText(/para-actions/)).not.toBeInTheDocument();
    a.unmount();
    session.roles = ["finance_officer"];
    const b = render(await AuditParaDetailPage({ params: { id: "p1" } }));
    expect(screen.getByText("para-actions:respond,escalate")).toBeInTheDocument();
    b.unmount();
    session.roles = ["finance_admin"];
    getPara.mockResolvedValue(PARA({ status: "responded" }));
    render(await AuditParaDetailPage({ params: { id: "p1" } }));
    expect(screen.getByText("para-actions:escalate,settle")).toBeInTheDocument();
  });

  it("a settled para offers no action", async () => {
    session.roles = ["super_admin"];
    getPara.mockResolvedValue(PARA({ status: "settled" }));
    render(await AuditParaDetailPage({ params: { id: "p1" } }));
    expect(screen.queryByText(/para-actions/)).not.toBeInTheDocument();
  });

  it("renders the reply timeline with actor NAMES and notes, never raw ids", async () => {
    getPara.mockResolvedValue(PARA({ status: "responded" }));
    getEvents.mockResolvedValue({
      source: "api",
      data: [
        { id: "e1", action: "respond", fromStatus: "open", toStatus: "responded", note: "Reply dated 12/09 attached", actorId: "11111111-1111-4111-8111-111111111111", createdAt: "2026-09-05T10:00:00.000Z" },
      ],
    });
    getNames.mockResolvedValue({ "11111111-1111-4111-8111-111111111111": "Asha Rao" });
    const { container } = render(await AuditParaDetailPage({ params: { id: "p1" } }));
    const list = screen.getByRole("list", { name: "Audit para timeline" });
    expect(within(list).getByText("Asha Rao")).toBeInTheDocument();
    expect(list).toHaveTextContent("Reply dated 12/09 attached");
    expect(container.textContent).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-4/);
  });

  it("an empty history and a failed history lookup are different states", async () => {
    const a = render(await AuditParaDetailPage({ params: { id: "p1" } }));
    expect(screen.getByText("No reply or action recorded yet")).toBeInTheDocument();
    a.unmount();
    getEvents.mockResolvedValue({ source: "error", status: 503, data: [] });
    render(await AuditParaDetailPage({ params: { id: "p1" } }));
    expect(screen.queryByText("No reply or action recorded yet")).not.toBeInTheDocument();
    expect(screen.getByText(/couldn't load audit para history/i)).toBeInTheDocument();
  });
});
