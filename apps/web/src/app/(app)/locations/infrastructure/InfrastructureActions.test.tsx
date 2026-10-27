import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from "vitest";
import { fireEvent, waitFor } from "@testing-library/react";
import { render, screen } from "@/test-utils/intl-render";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("../_data", () => ({ getLocationInfrastructureTyped: vi.fn(), getAssetLinkOptions: vi.fn() }));
const roles = vi.hoisted(() => ({ current: [] as string[] }));
vi.mock("@/lib/auth/roleGuard", () => ({ getSessionRoles: () => roles.current }));

import * as data from "../_data";
import Page from "./page";
import { InfrastructureCreateForm } from "./InfrastructureActions";
import { InfrastructureTable } from "../_tables";

const ID = "6b1a9c9e-6a53-4a51-9a40-8f7d7c1a0010";
const ASSET = "6b1a9c9e-6a53-4a51-9a40-8f7d7c1a0099";
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

let fetchMock: MockInstance<typeof fetch>;
beforeEach(() => { fetchMock = vi.spyOn(globalThis, "fetch"); });
afterEach(() => vi.restoreAllMocks());
const fill = (label: RegExp, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });

describe("InfrastructureCreateForm (GAP-LOCATIONS-INFRASTRUCTURE-02)", () => {
  it("does not post an asset with no name or out-of-range coordinates", async () => {
    render(<InfrastructureCreateForm />);
    fill(/^Latitude/, "95");
    fireEvent.click(screen.getByRole("button", { name: "Add asset" }));
    expect(await screen.findByText(/Enter a name for the asset/)).toBeTruthy();
    expect(screen.getByText(/latitude between -90 and 90/)).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("POSTs the typed body (optional fields only when given) and reports the 202 as received", async () => {
    fetchMock.mockResolvedValueOnce(json({ data: { id: ID, status: "accepted" } }, 202));
    fetchMock.mockResolvedValue(json({}, 404));
    render(<InfrastructureCreateForm />);
    fill(/^Name/, "Ring Road Bridge");
    fireEvent.change(screen.getByLabelText(/^Type/), { target: { value: "bridge" } });
    fill(/^Latitude/, "22.57");
    fill(/^Longitude/, "88.36");
    fill(/Capacity/, "40 tonnes");
    fireEvent.change(screen.getByLabelText(/Condition/), { target: { value: "4" } });
    fireEvent.click(screen.getByRole("button", { name: "Add asset" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe("/api/proxy/v1/locations/infrastructure");
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({
      name: "Ring Road Bridge", type: "bridge", lat: 22.57, lng: 88.36, capacity: "40 tonnes", conditionScore: 4,
    });
    expect(await screen.findByText(/received|updating/i)).toBeTruthy();
  });

  it("omits capacity and condition when left blank", async () => {
    fetchMock.mockResolvedValueOnce(json({ data: { id: ID } }, 202));
    fetchMock.mockResolvedValue(json({}, 404));
    render(<InfrastructureCreateForm />);
    fill(/^Name/, "Park 1");
    fill(/^Latitude/, "1");
    fill(/^Longitude/, "2");
    fireEvent.click(screen.getByRole("button", { name: "Add asset" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(JSON.parse(String((fetchMock.mock.calls[0]![1] as RequestInit).body))).toEqual({ name: "Park 1", type: "road", lat: 1, lng: 2 });
  });

  it("a rejected write shows catalogued copy, never the raw server message", async () => {
    fetchMock.mockResolvedValueOnce(json({ code: "FORBIDDEN", message: "requires one of: super_admin, location_admin, asset_admin" }, 403));
    render(<InfrastructureCreateForm />);
    fill(/^Name/, "Park 1");
    fill(/^Latitude/, "1");
    fill(/^Longitude/, "2");
    fireEvent.click(screen.getByRole("button", { name: "Add asset" }));
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(document.body.textContent).not.toContain("requires one of");
  });
});

describe("locations/infrastructure page: the form follows the role", () => {
  beforeEach(() => {
    vi.mocked(data.getAssetLinkOptions).mockResolvedValue({ data: [{ id: ASSET, label: "Ring Road Bridge (AST-001)" }], source: "api" });
    vi.mocked(data.getLocationInfrastructureTyped).mockResolvedValue({ data: [{ id: ID, name: "Old Bridge", type: "bridge", condition: "3/5", status: "active" }], source: "api" });
  });
  it("an asset admin sees the add form", async () => {
    roles.current = ["asset_admin"];
    render(await Page());
    expect(screen.getByRole("button", { name: "Add asset" })).toBeTruthy();
  });
  it("a plain viewer sees the register only", async () => {
    roles.current = ["employee"];
    render(await Page());
    expect(screen.getByText("Old Bridge")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Add asset" })).toBeNull();
  });
});

describe("asset link (GAP-LOCATIONS-INFRASTRUCTURE-06)", () => {
  it("links a row's name to its asset record when one is recorded, plain text otherwise", () => {
    render(
      <InfrastructureTable
        rows={[
          { id: ID, name: "Linked Bridge", type: "bridge", condition: "4/5", status: "active", assetId: ASSET },
          { id: "6b1a9c9e-6a53-4a51-9a40-8f7d7c1a0011", name: "Unlinked Road", type: "road", condition: "—", status: "active" },
        ]}
      />,
    );
    expect(screen.getByRole("link", { name: "Linked Bridge" }).getAttribute("href")).toBe(`/assets/${ASSET}`);
    expect(screen.getByText("Unlinked Road").closest("a")).toBeNull();
  });

  it("sends the chosen asset id with the new asset", async () => {
    fetchMock.mockResolvedValueOnce(json({ data: { id: ID } }, 202));
    fetchMock.mockResolvedValue(json({}, 404));
    render(<InfrastructureCreateForm assetOptions={[{ id: ASSET, label: "Ring Road Bridge (AST-001)" }]} />);
    fill(/^Name/, "Ring Road Bridge");
    fill(/^Latitude/, "22.57");
    fill(/^Longitude/, "88.36");
    fireEvent.change(screen.getByLabelText(/Linked asset record/), { target: { value: ASSET } });
    fireEvent.click(screen.getByRole("button", { name: "Add asset" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(JSON.parse(String((fetchMock.mock.calls[0]![1] as RequestInit).body)).assetId).toBe(ASSET);
  });

  it("leaves the picker out when the asset register cannot be read", () => {
    render(<InfrastructureCreateForm assetOptions={[]} />);
    expect(screen.queryByLabelText(/Linked asset record/)).toBeNull();
  });
});
