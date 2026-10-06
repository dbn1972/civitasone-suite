import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";

import { SampleDataControls } from "./SampleDataControls";

/**
 * GAP-SETUP-HOME-05: the two sample-data calls (locations + finance bills) must
 * be reported per source. A partial failure must never be announced as success,
 * and a partial clear failure must keep the confirm dialog open with the error.
 */

/** Route fetch by URL + method to a status code. */
function routeFetch(map: Record<string, number>) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input);
    const method = (init?.method ?? "GET").toUpperCase();
    const key = `${method} ${url.includes("locations") ? "locations" : "finance"}`;
    const status = map[key] ?? 200;
    return new Response(null, { status });
  });
}

describe("SampleDataControls — add (GAP-SETUP-HOME-05)", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("announces success only when BOTH offices and bills are added", async () => {
    routeFetch({ "POST locations": 200, "POST finance": 200 });
    render(<SampleDataControls />);
    fireEvent.click(screen.getByRole("button", { name: /Add example records/i }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(/offices and bills added/i));
  });

  it("names bills as failed (not success) when finance returns 500 and locations 200", async () => {
    routeFetch({ "POST locations": 200, "POST finance": 500 });
    render(<SampleDataControls />);
    fireEvent.click(screen.getByRole("button", { name: /Add example records/i }));
    await waitFor(() => {
      const status = screen.getByRole("status");
      expect(status).toHaveTextContent(/bills could not be added/i);
      expect(status).not.toHaveTextContent(/offices and bills added/i);
    });
  });

  it("names offices as failed when locations returns 500 and finance 200", async () => {
    routeFetch({ "POST locations": 500, "POST finance": 200 });
    render(<SampleDataControls />);
    fireEvent.click(screen.getByRole("button", { name: /Add example records/i }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(/offices could not be added/i));
  });
});

describe("SampleDataControls — clear (GAP-SETUP-HOME-05)", () => {
  beforeEach(() => vi.restoreAllMocks());

  async function openClearDialog() {
    render(<SampleDataControls />);
    fireEvent.click(screen.getByRole("button", { name: /Clear example records/i }));
    return screen.findByRole("alertdialog");
  }

  it("keeps the dialog open and names the failed source on a partial failure", async () => {
    routeFetch({ "DELETE locations": 200, "DELETE finance": 500 });
    const dialog = await openClearDialog();
    fireEvent.click(within(dialog).getByRole("button", { name: /Clear example records/i }));
    await waitFor(() => expect(within(dialog).getByText(/bills could not be removed/i)).toBeInTheDocument());
    // Dialog is still open (not closed with a false success).
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    expect(screen.queryByText(/Example records removed/i)).toBeNull();
  });

  it("closes the dialog and reports success only when both deletes succeed", async () => {
    routeFetch({ "DELETE locations": 200, "DELETE finance": 200 });
    const dialog = await openClearDialog();
    fireEvent.click(within(dialog).getByRole("button", { name: /Clear example records/i }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(/Example records removed/i));
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });
});
