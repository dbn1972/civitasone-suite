import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ProvisionRequestCard, parseRequestId } from "./ProvisionRequestCard";

const ID = "6f1c1d5e-3a0b-4f0e-9c1d-2b7d8a9e4c11";
const detail = { id: ID, org: "Dept of Roads", contact: "J*** D*** · j***@dept.gov.in", requested: "2026-10-01T10:00:00Z", assigned: "", stage: "new request" };

describe("parseRequestId", () => {
  it("accepts a UUID, rejects junk, takes the first of repeated params", () => {
    expect(parseRequestId(ID)).toBe(ID);
    expect(parseRequestId([ID, "x"])).toBe(ID);
    expect(parseRequestId("not-an-id")).toBeNull();
    expect(parseRequestId("../../etc/passwd")).toBeNull();
    expect(parseRequestId(undefined)).toBeNull();
  });
});

describe("ProvisionRequestCard (GAP-ADMIN-ONBOARDING-07)", () => {
  it("shows the request's organisation, MASKED contact and stage", () => {
    render(<ProvisionRequestCard result={{ data: detail, source: "api" }} />);
    expect(screen.getByText("Dept of Roads")).toBeInTheDocument();
    expect(screen.getByText("J*** D*** · j***@dept.gov.in")).toBeInTheDocument();
    expect(screen.getByText("Unassigned")).toBeInTheDocument();
  });
  it("404 / no data is 'not found', not a retry error", () => {
    render(<ProvisionRequestCard result={{ data: null, source: "error", status: 404 }} />);
    expect(screen.getByText(/was not found/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /try again/i })).not.toBeInTheDocument();
  });
  it("a server failure is a load-error state with retry; a 403 is access restricted", () => {
    const { unmount } = render(<ProvisionRequestCard result={{ data: null, source: "error", status: 500 }} />);
    expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument();
    unmount();
    render(<ProvisionRequestCard result={{ data: null, source: "error", status: 403, errorMessage: "requires platform_admin" }} />);
    expect(screen.getByRole("heading", { name: "Access restricted" })).toBeInTheDocument();
  });
});
