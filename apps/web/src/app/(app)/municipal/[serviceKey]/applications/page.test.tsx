import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("../../_data/municipalApi", () => ({ fetchMunicipalList: vi.fn() }));

import Page from "./page";
import { fetchMunicipalList } from "../../_data/municipalApi";

const mocked = vi.mocked(fetchMunicipalList);

beforeEach(() => mocked.mockReset());

describe("Municipal per-service applications list page", () => {
  it("renders the resource label and list source for a service with a citizen manifest (trade)", async () => {
    mocked.mockResolvedValue({
      data: { rows: [], meta: { page: 1, pageSize: 20, total: 0 } },
      source: "api",
    });
    render(await Page({ params: { serviceKey: "trade" } }));
    expect(screen.getByRole("heading", { name: /Trade Licence — Applications/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Citizen apply" })).toHaveAttribute(
      "href",
      "/citizen/services/trade-license/apply",
    );
  });

  it("hides the citizen apply link for a service with no citizen-service manifest (building)", async () => {
    mocked.mockResolvedValue({
      data: { rows: [], meta: { page: 1, pageSize: 20, total: 0 } },
      source: "api",
    });
    render(await Page({ params: { serviceKey: "building" } }));
    expect(screen.getByRole("heading", { name: /Building Plan — Applications/i })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Citizen apply" })).not.toBeInTheDocument();
  });

  it("shows an error empty-state when the source is 'error'", async () => {
    mocked.mockResolvedValue({
      data: { rows: [], meta: { page: 1, pageSize: 20, total: 0 } },
      source: "error",
    });
    render(await Page({ params: { serviceKey: "trade" } }));
    expect(screen.getByText(/Could not load applications/i)).toBeInTheDocument();
  });
});
