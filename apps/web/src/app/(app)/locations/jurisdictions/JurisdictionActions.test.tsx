import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from "vitest";
import { fireEvent, waitFor } from "@testing-library/react";
import { render, screen } from "@/test-utils/intl-render";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("../_data", () => ({ getLocationJurisdictionsTyped: vi.fn(), getJurisdictionFormOptions: vi.fn() }));
const roles = vi.hoisted(() => ({ current: [] as string[] }));
vi.mock("@/lib/auth/roleGuard", () => ({ getSessionRoles: () => roles.current }));

import * as data from "../_data";
import Page from "./page";
import { JurisdictionAssignForm, JurisdictionRevoke } from "./JurisdictionActions";
import { JurisdictionsTable } from "../_tables";

const OFFICE = "6b1a9c9e-6a53-4a51-9a40-8f7d7c1a0021";
const UNIT = "6b1a9c9e-6a53-4a51-9a40-8f7d7c1a0022";
const ROW = "6b1a9c9e-6a53-4a51-9a40-8f7d7c1a0023";
const offices = [{ id: OFFICE, label: "DM Office" }];
const units = [{ id: UNIT, label: "Sadar Block" }];
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

let fetchMock: MockInstance<typeof fetch>;
beforeEach(() => { fetchMock = vi.spyOn(globalThis, "fetch"); });
afterEach(() => vi.restoreAllMocks());

describe("JurisdictionAssignForm (GAP-LOCATIONS-JURISDICTIONS-02)", () => {
  it("makes the user choose an office and a unit by name before anything is sent", async () => {
    render(<JurisdictionAssignForm offices={offices} units={units} />);
    fireEvent.click(screen.getByRole("button", { name: "Assign jurisdiction" }));
    expect(await screen.findByText("Choose an office.")).toBeTruthy();
    expect(screen.getByText("Choose an administrative unit.")).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("POSTs office id, unit id, level and primary flag, and reports the 202 as received", async () => {
    fetchMock.mockResolvedValueOnce(json({ id: ROW, status: "accepted" }, 202));
    render(<JurisdictionAssignForm offices={offices} units={units} />);
    fireEvent.change(screen.getByLabelText(/^Office/), { target: { value: OFFICE } });
    fireEvent.change(screen.getByLabelText(/Administrative unit/), { target: { value: UNIT } });
    fireEvent.change(screen.getByLabelText(/^Level/), { target: { value: "block" } });
    fireEvent.click(screen.getByLabelText(/primary jurisdiction/));
    fireEvent.click(screen.getByRole("button", { name: "Assign jurisdiction" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe("/api/proxy/v1/jurisdictions");
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({ officeId: OFFICE, unitId: UNIT, level: "block", isPrimary: true });
    expect(await screen.findByText(/received|accepted/i)).toBeTruthy();
    expect(screen.queryByText(/^Done/)).toBeNull();
  });

  it("explains instead of rendering an unusable form when there is nothing to choose from", () => {
    render(<JurisdictionAssignForm offices={[]} units={units} />);
    expect(screen.getByText(/no offices or administrative units to choose from/i)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Assign jurisdiction" })).toBeNull();
  });

  it("a rejected write shows catalogued copy, never the raw server message", async () => {
    fetchMock.mockResolvedValueOnce(json({ code: "FORBIDDEN", message: "requires one of: location_admin, super_admin, admin" }, 403));
    render(<JurisdictionAssignForm offices={offices} units={units} />);
    fireEvent.change(screen.getByLabelText(/^Office/), { target: { value: OFFICE } });
    fireEvent.change(screen.getByLabelText(/Administrative unit/), { target: { value: UNIT } });
    fireEvent.click(screen.getByRole("button", { name: "Assign jurisdiction" }));
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(document.body.textContent).not.toContain("requires one of");
  });
});

describe("JurisdictionRevoke", () => {
  it("DELETEs the jurisdiction after a confirmation that names the office and unit", async () => {
    fetchMock.mockResolvedValueOnce(json({ id: ROW, status: "accepted" }, 202));
    render(<JurisdictionRevoke id={ROW} office="DM Office" unit="Sadar Block" />);
    fireEvent.click(screen.getByRole("button", { name: "Revoke" }));
    expect(await screen.findByText(/DM Office will no longer cover Sadar Block/)).toBeTruthy();
    fireEvent.click(screen.getAllByRole("button", { name: "Revoke" })[1]!);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe(`/api/proxy/v1/jurisdictions/${ROW}`);
    expect((init as RequestInit).method).toBe("DELETE");
  });
});

describe("JurisdictionsTable / page manage controls follow the role", () => {
  const rows = [{ id: ROW, level: "block", office: "DM Office", unit: "Sadar Block", primary: true }];
  it("shows Revoke only to a manager", () => {
    const { unmount } = render(<JurisdictionsTable rows={rows} canManage />);
    expect(screen.getByRole("button", { name: "Revoke" })).toBeTruthy();
    unmount();
    render(<JurisdictionsTable rows={rows} />);
    expect(screen.queryByRole("button", { name: "Revoke" })).toBeNull();
  });

  beforeEach(() => {
    vi.mocked(data.getLocationJurisdictionsTyped).mockResolvedValue({ data: rows, source: "api" });
    vi.mocked(data.getJurisdictionFormOptions).mockResolvedValue({ data: { offices, units }, source: "api" });
  });
  it("a location admin gets the assign form; a plain viewer does not", async () => {
    roles.current = ["location_admin"];
    const { unmount } = render(await Page());
    expect(screen.getByRole("button", { name: "Assign jurisdiction" })).toBeTruthy();
    unmount();
    roles.current = ["employee"];
    render(await Page());
    expect(screen.queryByRole("button", { name: "Assign jurisdiction" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Revoke" })).toBeNull();
  });
  it("says so when the offices and units cannot be loaded, instead of an empty form", async () => {
    vi.mocked(data.getJurisdictionFormOptions).mockResolvedValue({ data: { offices: [], units: [] }, source: "error", status: 502 });
    roles.current = ["super_admin"];
    render(await Page());
    expect(screen.getByText(/could not be loaded, so jurisdictions cannot be assigned/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Assign jurisdiction" })).toBeNull();
  });
});
