import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const pushMock = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: pushMock }) }));

import { ReportFilters } from "./ReportFilters";

const DIV_UUID = "11111111-2222-4333-8444-000000000001";

function stubFetch() {
  return vi.spyOn(globalThis, "fetch").mockImplementation((input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("/works/masters/divisions/search")) {
      return Promise.resolve(
        new Response(JSON.stringify({ data: [{ id: DIV_UUID, name: "Nagpur PWD Division", code: "NGP-PWD" }] }), {
          status: 200,
        }),
      );
    }
    return Promise.resolve(new Response("{}", { status: 200 }));
  });
}

describe("GAP-WORKS-REPORTS-01 ReportFilters (division picker)", () => {
  beforeEach(() => {
    pushMock.mockReset();
    vi.restoreAllMocks();
  });

  it("renders a division search combobox instead of a raw 'Division UUID' text box", () => {
    render(<ReportFilters />);
    expect(screen.queryByLabelText("Filter by division UUID")).not.toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: /division/i })).toBeInTheDocument();
  });

  it("selecting a division navigates with its real uuid as ?divisionId=", async () => {
    stubFetch();
    render(<ReportFilters />);
    const combo = screen.getByRole("combobox", { name: /division/i });
    fireEvent.focus(combo);
    fireEvent.change(combo, { target: { value: "nagpur" } });

    const option = await screen.findByText("Nagpur PWD Division");
    fireEvent.mouseDown(option);

    fireEvent.click(screen.getByText("Apply"));
    await waitFor(() => expect(pushMock).toHaveBeenCalled());
    expect(pushMock).toHaveBeenCalledWith(`/works/reports?divisionId=${DIV_UUID}`);
  });

  it("a user cannot type a free-text code into the division field (combobox search only)", async () => {
    stubFetch();
    render(<ReportFilters />);
    // Typing a code yields no matching option (the stub only returns on 'nagpur'),
    // and without a selection the picker holds no value, so Apply navigates with
    // no divisionId — a typed code can never reach the URL.
    const combo = screen.getByRole("combobox", { name: /division/i });
    fireEvent.focus(combo);
    fireEvent.change(combo, { target: { value: "DIV-001" } });
    fireEvent.click(screen.getByText("Apply"));
    await waitFor(() => expect(pushMock).toHaveBeenCalled());
    expect(pushMock).toHaveBeenCalledWith("/works/reports");
  });
});
