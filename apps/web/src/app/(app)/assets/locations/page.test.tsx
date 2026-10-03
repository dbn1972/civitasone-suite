import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import LocationsPage from "./page";

type Call = { url: string; init?: RequestInit };
let calls: Call[] = [];

function mockFetch(opts: { locations?: unknown[]; orgStatus?: number; orgBody?: unknown; postStatus?: number }) {
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input);
    calls.push({ url, init });
    if (url.includes("/v1/admin/org-hierarchy")) {
      return new Response(JSON.stringify(opts.orgBody ?? { data: [{ name: "Works" }, { name: "Accounts" }] }), { status: opts.orgStatus ?? 200 });
    }
    if (url.includes("/v1/asset/locations") && init?.method === "POST") {
      return new Response(JSON.stringify({ id: "n1" }), { status: opts.postStatus ?? 202 });
    }
    if (url.includes("/v1/asset/locations")) {
      return new Response(JSON.stringify({ data: opts.locations ?? [] }), { status: 200 });
    }
    return new Response("{}", { status: 404 });
  });
}

const ROWS = [
  { id: "p", code: "PLANT", name: "Main plant", orgUnit: null, parentId: null },
  { id: "c", code: "PLANT-B1", name: "Boiler house", orgUnit: "Works", parentId: "p" },
];

describe("LocationsPage", () => {
  beforeEach(() => { calls = []; });
  afterEach(() => vi.restoreAllMocks());

  it("renders the hierarchy nested and no longer promises a tree it cannot show (GAP-ASSETS-LOCATIONS-01)", async () => {
    mockFetch({ locations: ROWS });
    render(<LocationsPage />);
    const child = await screen.findByText(/— Boiler house/);
    const parentLi = screen.getByText("PLANT").closest("li");
    expect(parentLi?.querySelector("ul")).toContainElement(child);
    expect(screen.getByRole("heading", { name: "Location hierarchy" })).toBeInTheDocument();
    // parent select lists existing locations
    expect(screen.getByRole("option", { name: /PLANT · Main plant/ })).toBeInTheDocument();
  });

  it("shows a skeleton while loading, not an empty-state placeholder (GAP-ASSETS-LOCATIONS-04)", async () => {
    mockFetch({ locations: [] });
    render(<LocationsPage />);
    expect(screen.getByLabelText("Loading locations…")).toBeInTheDocument();
    await screen.findByText("No locations yet");
  });

  it("blocks a duplicate code client-side with no POST (GAP-ASSETS-LOCATIONS-02)", async () => {
    mockFetch({ locations: ROWS });
    render(<LocationsPage />);
    await screen.findByText(/— Boiler house/);
    fireEvent.change(screen.getByLabelText("Location code"), { target: { value: " plant " } });
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Dup" } });
    fireEvent.click(screen.getByRole("button", { name: "Add location" }));
    expect(await screen.findByText(/Code already exists/)).toBeInTheDocument();
    expect(calls.some((c) => c.init?.method === "POST")).toBe(false);
  });

  it("surfaces a server 409 as the same inline duplicate message", async () => {
    mockFetch({ locations: ROWS, postStatus: 409 });
    render(<LocationsPage />);
    await screen.findByText(/— Boiler house/);
    fireEvent.change(screen.getByLabelText("Location code"), { target: { value: "NEW-1" } });
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "New" } });
    fireEvent.click(screen.getByRole("button", { name: "Add location" }));
    expect(await screen.findByText(/Code already exists/)).toBeInTheDocument();
  });

  it("creates a child under the chosen parent with parentId and the picked org unit (GAP-ASSETS-LOCATIONS-01/-05)", async () => {
    mockFetch({ locations: ROWS });
    render(<LocationsPage />);
    await screen.findByText(/— Boiler house/);
    await waitFor(() => expect(screen.getByLabelText("Org unit").tagName).toBe("SELECT"));
    fireEvent.change(screen.getByLabelText("Location code"), { target: { value: "PLANT-B2" } });
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Boiler 2" } });
    fireEvent.change(screen.getByLabelText("Parent location"), { target: { value: "p" } });
    fireEvent.change(screen.getByLabelText("Org unit"), { target: { value: "Works" } });
    fireEvent.click(screen.getByRole("button", { name: "Add location" }));
    await waitFor(() => expect(calls.some((c) => c.init?.method === "POST")).toBe(true));
    const post = calls.find((c) => c.init?.method === "POST");
    expect(JSON.parse(String(post?.init?.body))).toEqual({ code: "PLANT-B2", name: "Boiler 2", orgUnit: "Works", parentId: "p" });
  });

  // GAP-ASSETS-LOCATIONS-02: deactivate / reactivate
  it("deactivates with a required reason, posts it, and offers Reactivate for inactive rows (muted, with a status pill)", async () => {
    mockFetch({ locations: [{ ...ROWS[1]!, isActive: true }, { id: "x", code: "OLD-1", name: "Old shed", orgUnit: null, parentId: null, isActive: false }] });
    render(<LocationsPage />);
    await screen.findByText(/— Boiler house/);
    expect(screen.getByText("Inactive")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reactivate location OLD-1" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Deactivate location OLD-1" })).not.toBeInTheDocument();
    // an inactive location is not offered as a parent for a new one
    expect(screen.queryByRole("option", { name: /OLD-1/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Deactivate location PLANT-B1" }));
    const confirm = await screen.findByRole("button", { name: "Deactivate" });
    expect(confirm).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Reason"), { target: { value: "Boiler house demolished" } });
    fireEvent.click(confirm);
    await waitFor(() => expect(calls.some((c) => c.url.endsWith("/locations/c/deactivate"))).toBe(true));
    const post = calls.find((c) => c.url.endsWith("/locations/c/deactivate"));
    expect(JSON.parse(String(post?.init?.body))).toEqual({ reason: "Boiler house demolished" });
    expect(await screen.findByText(/Location PLANT-B1 deactivated/)).toBeInTheDocument();
  });

  it("explains a refusal to deactivate a parent that still has active children", async () => {
    mockFetch({ locations: ROWS });
    const base = (globalThis.fetch as unknown as (i: string | URL | Request, init?: RequestInit) => Promise<Response>);
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) =>
      String(input).endsWith("/deactivate")
        ? new Response(JSON.stringify({ code: "HAS_ACTIVE_CHILDREN", message: "deactivate the child locations first" }), { status: 409 })
        : base(input, init));
    render(<LocationsPage />);
    await screen.findByText(/— Boiler house/);
    fireEvent.click(screen.getByRole("button", { name: "Deactivate location PLANT" }));
    fireEvent.change(await screen.findByLabelText("Reason"), { target: { value: "Closing the plant" } });
    fireEvent.click(screen.getByRole("button", { name: "Deactivate" }));
    expect(await screen.findByText(/still has active child locations/)).toBeInTheDocument();
    expect(screen.queryByText(/HAS_ACTIVE_CHILDREN/)).not.toBeInTheDocument();
  });

  it("reactivates an inactive location", async () => {
    mockFetch({ locations: [{ id: "x", code: "OLD-1", name: "Old shed", orgUnit: null, parentId: null, isActive: false }] });
    render(<LocationsPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Reactivate location OLD-1" }));
    await waitFor(() => expect(calls.some((c) => c.url.endsWith("/locations/x/reactivate") && c.init?.method === "POST")).toBe(true));
    expect(await screen.findByText(/Location OLD-1 reactivated/)).toBeInTheDocument();
  });

  it("falls back to a free-text org unit when the org hierarchy is forbidden (GAP-ASSETS-LOCATIONS-05)", async () => {
    mockFetch({ locations: ROWS, orgStatus: 403 });
    render(<LocationsPage />);
    await screen.findByText(/— Boiler house/);
    expect(screen.getByLabelText("Org unit").tagName).toBe("INPUT");
  });

  it("edits name/org unit with PATCH and never offers the code (GAP-ASSETS-LOCATIONS-02)", async () => {
    mockFetch({ locations: ROWS });
    vi.spyOn(globalThis, "fetch");
    render(<LocationsPage />);
    await screen.findByText(/— Boiler house/);
    fireEvent.click(screen.getByRole("button", { name: "Edit location PLANT-B1" }));
    fireEvent.change(screen.getByLabelText("Name for PLANT-B1"), { target: { value: "Boiler house 1" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(calls.some((c) => c.init?.method === "PATCH")).toBe(true));
    const patch = calls.find((c) => c.init?.method === "PATCH");
    expect(patch?.url).toContain("/v1/asset/locations/c");
    expect(JSON.parse(String(patch?.init?.body))).toEqual({ name: "Boiler house 1", orgUnit: "Works" });
  });
});
