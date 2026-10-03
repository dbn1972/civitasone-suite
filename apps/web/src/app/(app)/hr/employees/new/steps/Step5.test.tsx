import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

vi.mock("@/lib/entityAdapters/employee", () => ({
  resolveEmployees: vi.fn(async () => [{ id: "m1", label: "Mina Rao (E-9)" }]),
  searchEmployees: vi.fn(async () => []),
}));
vi.mock("@/lib/entityAdapters/costCenter", () => ({
  resolveCostCenters: vi.fn(async () => [{ id: "cc1", label: "IT Infrastructure" }]),
  searchCostCenters: vi.fn(async () => []),
}));

import { Step5 } from "./Step5";
import { WIZARD_INIT } from "../wizardTypes";

describe("Step5 review (GAP-HR-EMPLOYEES-NEW-01)", () => {
  it("no row is marked 'not saved' any more, and picked references show names, never raw ids", async () => {
    render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <Step5
          data={{ ...WIZARD_INIT, fullName: "P", maritalStatus: "married", bloodGroup: "O+", grade: "Group-B", shift: "night", managerId: "m1", costCenterId: "cc1" }}
          departments={[]} designations={[]} submitting={false} onGoToStep={() => undefined}
        />
      </NextIntlClientProvider>,
    );
    expect(screen.queryByText(/not saved yet/i)).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("IT Infrastructure")).toBeInTheDocument());
    expect(screen.getByText("Mina Rao (E-9)")).toBeInTheDocument();
    expect(screen.queryByText("cc1")).not.toBeInTheDocument();
    expect(screen.queryByText("m1")).not.toBeInTheDocument();
    expect(screen.getByText("Group-B")).toBeInTheDocument();
  });
});
