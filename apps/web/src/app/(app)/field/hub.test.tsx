import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const roles: { current: string[] } = { current: [] };
vi.mock("@/lib/auth/roleGuard", async () => {
  const actual = await vi.importActual<typeof import("@/lib/auth/roleGuard")>("@/lib/auth/roleGuard");
  return { ...actual, getSessionRoles: () => roles.current };
});

import FieldHub from "./page";

describe("Field hub agent-roster tile", () => {
  it("is hidden from a field agent (the roster endpoint is supervisor-only)", () => {
    roles.current = ["field_agent"];
    render(<FieldHub />);
    expect(screen.getByText("Tasks")).toBeInTheDocument();
    expect(screen.queryByText("Agents")).not.toBeInTheDocument();
  });

  it("is shown to a field supervisor", () => {
    roles.current = ["field_admin"];
    render(<FieldHub />);
    expect(screen.getByText("Agents")).toBeInTheDocument();
  });
});
