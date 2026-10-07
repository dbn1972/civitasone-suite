import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: refreshMock }) }));

import { RunQueryForm } from "./RunQueryForm";

const CATALOG = {
  metrics: [{ key: "amount_sum", label: "Total amount", agg: "sum", unit: "paise" }],
  dimensions: [{ key: "source", label: "Source" }],
  filters: [
    { key: "source", label: "Source", type: "string" },
    { key: "amount", label: "Amount", type: "number" },
    { key: "occurred_at", label: "Occurred at", type: "date" },
  ],
  operators: ["eq", "neq", "gt"],
};

function mockFetch(runStatus = 202) {
  return vi.fn((url: string) => {
    if (url.includes("/analytics/catalog")) {
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(CATALOG) } as Response);
    }
    if (url.includes("/analytics/queries/run")) {
      return Promise.resolve({ ok: runStatus < 400, status: runStatus, json: () => Promise.resolve({}) } as Response);
    }
    return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) } as Response);
  });
}

async function renderLoaded(fetchImpl: ReturnType<typeof mockFetch>) {
  vi.stubGlobal("fetch", fetchImpl);
  render(<RunQueryForm />);
  await waitFor(() => expect(screen.getByLabelText(/Query name/)).toBeInTheDocument());
}

describe("RunQueryForm", () => {
  beforeEach(() => refreshMock.mockReset());
  afterEach(() => vi.unstubAllGlobals());

  // GAP-ANALYTICS-QUERIES-07
  it("labels the filter-removal button 'Remove', matching its aria-label", async () => {
    await renderLoaded(mockFetch());
    fireEvent.click(screen.getByRole("button", { name: "+ Add Filter" }));
    const btn = screen.getByRole("button", { name: "Remove filter 1" });
    expect(btn).toHaveTextContent("Remove");
  });

  // GAP-ANALYTICS-QUERIES-06: value input type follows the field's catalog type.
  it("renders a numeric input for a number field and a date input for a date field", async () => {
    await renderLoaded(mockFetch());
    fireEvent.click(screen.getByRole("button", { name: "+ Add Filter" }));
    const valueInput = screen.getByLabelText("Value") as HTMLInputElement;
    // default first filter field is "source" (string) -> text
    expect(valueInput.type).toBe("text");
    // switch to the numeric field
    fireEvent.change(screen.getByLabelText("Field"), { target: { value: "amount" } });
    expect((screen.getByLabelText("Value") as HTMLInputElement).type).toBe("number");
    // switch to the date field
    fireEvent.change(screen.getByLabelText("Field"), { target: { value: "occurred_at" } });
    expect((screen.getByLabelText("Value") as HTMLInputElement).type).toBe("date");
  });

  // GAP-ANALYTICS-QUERIES-06: an empty-valued filter is flagged, not dropped.
  it("blocks submit and shows a field error when a filter row has no value", async () => {
    const f = mockFetch();
    await renderLoaded(f);
    fireEvent.change(screen.getByLabelText(/Query name/), { target: { value: "My query" } });
    fireEvent.click(screen.getByRole("button", { name: "+ Add Filter" }));
    // leave the value empty, submit
    fireEvent.submit(screen.getByRole("form", { name: /Run a new analytics query/ }));
    await waitFor(() => expect(screen.getByText(/filter has no value/i)).toBeInTheDocument());
    // the run endpoint must NOT have been called (only the catalog fetch happened)
    const runCalls = f.mock.calls.filter((c) => String(c[0]).includes("/queries/run"));
    expect(runCalls.length).toBe(0);
    expect(refreshMock).not.toHaveBeenCalled();
  });

  // GAP-ANALYTICS-QUERIES-03: a successful 202 submit refreshes the page.
  it("calls router.refresh after a 202 so the queued run appears", async () => {
    const f = mockFetch(202);
    await renderLoaded(f);
    fireEvent.change(screen.getByLabelText(/Query name/), { target: { value: "My query" } });
    fireEvent.submit(screen.getByRole("form", { name: /Run a new analytics query/ }));
    await waitFor(() => expect(screen.getByText(/Query queued/)).toBeInTheDocument());
    expect(refreshMock).toHaveBeenCalledTimes(1);
  });
});
