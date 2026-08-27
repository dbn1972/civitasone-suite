import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("../../../_data/loaders", () => ({ getCRMActivities: vi.fn() }));
vi.mock("./ActivitiesTable", () => ({ ActivitiesTable: () => <div data-testid="act-table" /> }));
vi.mock("./LogActivityButton", () => ({ LogActivityButton: () => <button>Log Interaction</button> }));
vi.mock("../../../_components/DataSourceBadge", () => ({ DataSourceBadge: () => null }));

import Page from "./page";
import { getCRMActivities } from "../../../_data/loaders";

const mocked = vi.mocked(getCRMActivities);

const today = new Date().toISOString().slice(0, 10);

// 3 overdue, 2 completed, 1 open — each count is distinct for unambiguous assertions
const mockActivities = [
  { id: "1", type: "call",    subject: "Budget review",   relatedTo: "MoF", dueDate: "2026-01-10", owner: "Ravi",   status: "overdue"   },
  { id: "2", type: "meeting", subject: "Site inspection",  relatedTo: "PWD", dueDate: "2026-01-11", owner: "Priya",  status: "overdue"   },
  { id: "3", type: "email",   subject: "RTI response",     relatedTo: "NIC", dueDate: "2026-01-12", owner: "Suresh", status: "overdue"   },
  { id: "4", type: "task",    subject: "Follow-up note",   relatedTo: "DoT", dueDate: "2026-02-01", owner: "Ajay",   status: "completed" },
  { id: "5", type: "note",    subject: "Vendor call",      relatedTo: "DGS", dueDate: today,        owner: "Meera",  status: "completed" },
  { id: "6", type: "call",    subject: "Beneficiary query",relatedTo: "NIC", dueDate: "2026-09-01", owner: "Kiran",  status: "open"      },
] as never;

beforeEach(() => mocked.mockReset());

describe("Stakeholder Interactions page (GoI redesign)", () => {
  it("renders heading Stakeholder Interactions", async () => {
    mocked.mockResolvedValue({ data: mockActivities, source: "api" });
    render(await Page());
    expect(screen.getByText("Stakeholder Interactions")).toBeInTheDocument();
  });

  it("shows overdue count (3) when activities have status overdue", async () => {
    mocked.mockResolvedValue({ data: mockActivities, source: "api" });
    render(await Page());
    expect(screen.getByText("Overdue")).toBeInTheDocument();
    // 3 activities are overdue — the value "3" must appear in the stat grid
    expect(screen.getByText("3")).toBeInTheDocument();
  });

  it("shows completed count (2) correctly", async () => {
    mocked.mockResolvedValue({ data: mockActivities, source: "api" });
    render(await Page());
    expect(screen.getByText("Completed")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
  });

  it("renders ActivitiesTable component", async () => {
    mocked.mockResolvedValue({ data: mockActivities, source: "api" });
    render(await Page());
    expect(screen.getByTestId("act-table")).toBeInTheDocument();
  });

  it("shows em dashes, not fabricated zeros, for every stat when the load fails", async () => {
    // Regression test: the loader falls back to data: [] on a failed fetch, so
    // every count (total/due-today/overdue/completed) used to render a
    // confident "0" instead of signalling the load actually failed.
    mocked.mockResolvedValue({ data: [], source: "error" });
    render(await Page());
    expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(4);
    expect(screen.queryByText("0")).not.toBeInTheDocument();
  });

  it("still renders with no arguments (Next.js may omit searchParams)", async () => {
    mocked.mockResolvedValue({ data: mockActivities, source: "api" });
    render(await Page());
    expect(screen.getByText("Stakeholder Interactions")).toBeInTheDocument();
  });
});
