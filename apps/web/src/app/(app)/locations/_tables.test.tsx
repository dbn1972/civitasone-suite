import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { InfrastructureTable, GeofencesTable, JurisdictionsTable } from "./_tables";

// GAP2-LOCATIONS-INFRASTRUCTURE-01: the child pages used the generic
// ModuleListPage which flattened every record to ID/Name/Detail/Status/Meta and
// printed row.id.slice(0,8) as a raw-UUID column. These typed tables show the
// defining attributes and NO raw-UUID column. Fails on the old tree
// (_tables.tsx did not exist; the generic table rendered an "ID" column).

describe("InfrastructureTable (GAP2-LOCATIONS-INFRASTRUCTURE-01)", () => {
  const rows = [
    { id: "11111111-1111-4111-8111-111111111111", name: "Main Bridge", type: "bridge", condition: "4/5", status: "active" },
  ];

  it("renders Name/Type/Condition/Status columns", () => {
    render(<InfrastructureTable rows={rows} />);
    expect(screen.getByRole("columnheader", { name: /Type/i })).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: /Condition/i })).toBeTruthy();
    expect(screen.getByText("bridge")).toBeTruthy();
    expect(screen.getByText("4/5")).toBeTruthy();
  });

  it("does NOT render a raw 8-char UUID column", () => {
    render(<InfrastructureTable rows={rows} />);
    // The old generic table printed id.slice(0,8) = "11111111".
    expect(screen.queryByText("11111111")).toBeNull();
    expect(screen.queryByRole("columnheader", { name: /^ID$/i })).toBeNull();
  });
});

describe("GeofencesTable (GAP2-LOCATIONS-INFRASTRUCTURE-01)", () => {
  it("renders Shape/Radius columns and no raw UUID", () => {
    const rows = [
      { id: "22222222-2222-4222-8222-222222222222", name: "City Centre", type: "zone", shape: "circle", radius: "500 m", status: "active" },
    ];
    render(<GeofencesTable rows={rows} />);
    expect(screen.getByRole("columnheader", { name: /Shape/i })).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: /Radius/i })).toBeTruthy();
    expect(screen.getByText("500 m")).toBeTruthy();
    expect(screen.queryByText("22222222")).toBeNull();
  });
});

describe("JurisdictionsTable (GAP2-LOCATIONS-INFRASTRUCTURE-01)", () => {
  it("renders Level/Office columns and no raw UUID", () => {
    const rows = [
      { id: "33333333-3333-4333-8333-333333333333", level: "district", office: "DM Office", unit: "Unit-1" },
    ];
    render(<JurisdictionsTable rows={rows} />);
    expect(screen.getByRole("columnheader", { name: /Level/i })).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: /Office/i })).toBeTruthy();
    expect(screen.getByText("district")).toBeTruthy();
    expect(screen.queryByText("33333333")).toBeNull();
  });
});
