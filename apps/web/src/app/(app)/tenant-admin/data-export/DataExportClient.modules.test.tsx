import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@/test-utils/intl-render";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));

import { DataExportClient } from "./DataExportClient";

// F7: the "By Module" dropdown lists only modules that can actually be exported.
function openModulePicker(modules: string[], modulesFailed = false) {
  render(<DataExportClient exports={[]} source="api" modules={modules} modulesFailed={modulesFailed} />);
  const typeSelect = screen.getAllByRole("combobox")[0] as HTMLSelectElement;
  fireEvent.change(typeSelect, { target: { value: "module" } });
}

describe("DataExportClient module dropdown (F7)", () => {
  it("offers exactly the exportable modules the server reported, and nothing else", () => {
    openModulePicker(["admin"]);
    const options = screen.getAllByRole("option").map((o) => o.textContent);
    expect(options).toContain("Admin");
    for (const gone of ["Finance", "Hrms", "Payroll", "Procurement", "Projects", "Assets", "Inventory", "Documents"]) {
      expect(options).not.toContain(gone);
    }
  });

  it("says so, and disables the export, when no module can be exported", () => {
    openModulePicker([]);
    expect(screen.getByText("No module can be exported yet.")).toBeTruthy();
    expect((screen.getByRole("button", { name: /^(Export|Request export|Export data)/i }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("tells a failed list load apart from an empty list", () => {
    openModulePicker([], true);
    expect(screen.getByText("The list of exportable modules could not be loaded. Refresh to try again.")).toBeTruthy();
    expect(screen.queryByText("No module can be exported yet.")).toBeNull();
  });
});
