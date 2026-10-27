import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@/test-utils/intl-render";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("../_data", () => ({ getLocationGeofencesTyped: vi.fn() }));
const roles = vi.hoisted(() => ({ current: [] as string[] }));
vi.mock("@/lib/auth/roleGuard", () => ({ getSessionRoles: () => roles.current }));

import * as data from "../_data";
import Page from "./page";

const rows = [{ id: "6b1a9c9e-6a53-4a51-9a40-8f7d7c1a0002", name: "Depot", type: "site", shape: "circle", radius: "100 m", center: "1.0000, 2.0000", status: "active" }];

describe("locations/geofences page: manage controls follow the role (GAP-LOCATIONS-GEOFENCES-02)", () => {
  beforeEach(() => {
    vi.mocked(data.getLocationGeofencesTyped).mockResolvedValue({ data: rows, source: "api" });
  });

  it("a location admin sees the add form and the row action", async () => {
    roles.current = ["location_admin"];
    render(await Page());
    expect(screen.getByRole("button", { name: "Add geofence" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Deactivate" })).toBeTruthy();
  });

  it("a viewer without a write role sees the register only", async () => {
    roles.current = ["employee"];
    render(await Page());
    expect(screen.getByText("Depot")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Add geofence" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Deactivate" })).toBeNull();
  });
});
