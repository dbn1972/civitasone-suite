import { describe, it, expect, vi } from "vitest";
import { render as rtlRender, screen, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";
import type { ReactElement } from "react";

function render(ui: ReactElement) {
  return rtlRender(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      {ui}
    </NextIntlClientProvider>,
  );
}

const pushMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
  usePathname: () => "/crm/rti",
  useSearchParams: () => new URLSearchParams(),
}));

import { RtiFilters } from "./RtiFilters";

// GAP-CRM-RTI-06: the section filter names a section exactly as the register table, the
// detail page and the new-request form do (it used to read "§6 — Information").
describe("RtiFilters section options (GAP-CRM-RTI-06)", () => {
  it("lists All sections plus the canonical full section labels", () => {
    render(<RtiFilters status="" section="" search="" />);
    const select = screen.getByLabelText("Filter by section") as HTMLSelectElement;
    const options = Array.from(select.querySelectorAll("option")).map((o) => [(o as HTMLOptionElement).value, o.textContent]);
    expect(options).toEqual([
      ["", "All sections"],
      ["s.6", "§6 — Information Request"],
      ["s.11", "§11 — Third-party Information"],
    ]);
  });

  it("filters by the raw section value", () => {
    pushMock.mockReset();
    render(<RtiFilters status="" section="" search="" />);
    fireEvent.change(screen.getByLabelText("Filter by section"), { target: { value: "s.11" } });
    expect(pushMock).toHaveBeenCalledWith("/crm/rti?section=s.11");
  });
});
