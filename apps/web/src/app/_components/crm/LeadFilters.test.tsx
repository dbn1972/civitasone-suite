import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

import { LeadFilters } from "./LeadFilters";

beforeEach(() => push.mockReset());

describe("LeadFilters (LQ-003)", () => {
  it("pushes selected classification filters onto the URL query", () => {
    render(<LeadFilters initial={{}} />);
    fireEvent.change(screen.getByLabelText("Temperature"), { target: { value: "hot" } });
    fireEvent.change(screen.getByLabelText("Priority"), { target: { value: "high" } });
    fireEvent.change(screen.getByLabelText("Segment"), { target: { value: "Enterprise" } });
    fireEvent.change(screen.getByLabelText("Status"), { target: { value: "qualified" } });
    fireEvent.click(screen.getByRole("button", { name: /apply filters/i }));
    expect(push).toHaveBeenCalledTimes(1);
    const url = push.mock.calls[0][0] as string;
    expect(url).toContain("temperature=hot");
    expect(url).toContain("priority=high");
    // The classification segment goes as segmentName (not the view-mode `segment`).
    expect(url).toContain("segmentName=Enterprise");
    expect(url).not.toMatch(/[?&]segment=/);
    expect(url).toContain("status=qualified");
  });

  it("seeds from initial values (incl. segmentName)", () => {
    render(<LeadFilters initial={{ region: "South", source: "website", segmentName: "Enterprise" }} />);
    expect(screen.getByLabelText("Region")).toHaveValue("South");
    expect(screen.getByLabelText("Source")).toHaveValue("website");
    expect(screen.getByLabelText("Segment")).toHaveValue("Enterprise");
  });

  it("clear resets to the unfiltered list", () => {
    render(<LeadFilters initial={{ temperature: "hot" }} />);
    fireEvent.click(screen.getByRole("button", { name: /clear/i }));
    expect(push).toHaveBeenCalledWith("/crm/contacts");
    expect(screen.getByLabelText("Temperature")).toHaveValue("");
  });
});
