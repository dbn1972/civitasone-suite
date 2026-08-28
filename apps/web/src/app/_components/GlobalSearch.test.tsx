import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";
import { GlobalSearch } from "./GlobalSearch";

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockPush = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
}));

function mockFetchResponse(data: unknown, status = 200) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => data,
  });
}

const SAMPLE_RESULTS = {
  data: [
    {
      id: "bill-001",
      module: "finance",
      name: "Electricity Bill Q4",
      refNumber: "FIN-2024-042",
      description: "Quarterly electricity bill for main office",
      status: "pending",
      snippet: "Electricity Bill Q4 — pending approval",
    },
    {
      id: "po-002",
      module: "procurement",
      name: "Office Supplies PO",
      refNumber: "PRC-2024-108",
      description: "Purchase order for stationery items",
      status: "approved",
      snippet: "Office Supplies — approved on 2024-03-15",
    },
  ],
  meta: { page: 1, pageSize: 20, total: 2 },
};

// ── Test setup ────────────────────────────────────────────────────────────────

beforeEach(() => {
  mockPush.mockReset();
  global.fetch = mockFetchResponse(SAMPLE_RESULTS);
});

afterEach(() => {
  vi.restoreAllMocks();
});

function openPalette() {
  act(() => {
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true }));
  });
}

function getSearchInput() {
  return screen.getByRole("combobox");
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("GlobalSearch", () => {
  it("renders nothing when closed", () => {
    const { container } = render(<GlobalSearch />);
    expect(container).toBeEmptyDOMElement();
  });

  it("opens on Ctrl+K keypress", () => {
    render(<GlobalSearch />);
    openPalette();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByRole("combobox")).toBeInTheDocument();
  });

  it("opens on Meta+K keypress", () => {
    render(<GlobalSearch />);
    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true }));
    });
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("closes on Escape keypress", () => {
    render(<GlobalSearch />);
    openPalette();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("shows hint text when query is less than 2 characters", () => {
    render(<GlobalSearch />);
    openPalette();
    expect(screen.getByText("Type at least 2 characters to search")).toBeInTheDocument();
  });

  it("debounces search input and fetches results after 300ms", async () => {
    vi.useFakeTimers();
    render(<GlobalSearch />);
    openPalette();

    const input = getSearchInput();
    fireEvent.change(input, { target: { value: "bill" } });

    // Before debounce, no fetch
    expect(global.fetch).not.toHaveBeenCalled();

    // Advance past debounce
    await act(async () => {
      vi.advanceTimersByTime(300);
    });

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/proxy/v1/search?q=bill"),
      expect.objectContaining({ credentials: "same-origin" }),
    );
    vi.useRealTimers();
  });

  it("does not fetch when query is less than 2 characters", async () => {
    vi.useFakeTimers();
    render(<GlobalSearch />);
    openPalette();

    const input = getSearchInput();
    fireEvent.change(input, { target: { value: "b" } });

    await act(async () => {
      vi.advanceTimersByTime(300);
    });

    expect(global.fetch).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("displays search results with module badges and snippets", async () => {
    render(<GlobalSearch />);
    openPalette();

    const input = getSearchInput();
    fireEvent.change(input, { target: { value: "bill" } });

    await waitFor(() => {
      expect(screen.getByText("Electricity Bill Q4")).toBeInTheDocument();
    });

    // Module badges
    expect(screen.getByText("finance")).toBeInTheDocument();
    expect(screen.getByText("procurement")).toBeInTheDocument();

    // Snippets
    expect(screen.getByText("Electricity Bill Q4 — pending approval")).toBeInTheDocument();

    // Ref numbers
    expect(screen.getByText("FIN-2024-042")).toBeInTheDocument();
  });

  it("shows no results message when search returns empty", async () => {
    global.fetch = mockFetchResponse({ data: [], meta: { page: 1, pageSize: 20, total: 0 } });

    render(<GlobalSearch />);
    openPalette();

    const input = getSearchInput();
    fireEvent.change(input, { target: { value: "zzzznotfound" } });

    await waitFor(() => {
      const matches = screen.getAllByText(/No results found/);
      expect(matches.length).toBeGreaterThan(0);
    });
  });

  it("shows error message on 503 (search unavailable)", async () => {
    global.fetch = mockFetchResponse(
      { error: { code: "SEARCH_UNAVAILABLE", message: "Search service is temporarily unavailable" } },
      503,
    );

    render(<GlobalSearch />);
    openPalette();

    const input = getSearchInput();
    fireEvent.change(input, { target: { value: "test" } });

    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeInTheDocument();
      expect(screen.getByText("Search is temporarily unavailable")).toBeInTheDocument();
    });
  });

  it("supports keyboard navigation with arrow keys", async () => {
    render(<GlobalSearch />);
    openPalette();

    const input = getSearchInput();
    fireEvent.change(input, { target: { value: "bill" } });

    await waitFor(() => {
      expect(screen.getByText("Electricity Bill Q4")).toBeInTheDocument();
    });

    const dialog = screen.getByRole("dialog");

    // Arrow down — first item selected
    fireEvent.keyDown(dialog, { key: "ArrowDown" });
    const firstOption = screen.getByText("Electricity Bill Q4").closest("[role='option']");
    expect(firstOption).toHaveAttribute("aria-selected", "true");

    // Arrow down — second item selected
    fireEvent.keyDown(dialog, { key: "ArrowDown" });
    const secondOption = screen.getByText("Office Supplies PO").closest("[role='option']");
    expect(secondOption).toHaveAttribute("aria-selected", "true");

    // Arrow up — back to first
    fireEvent.keyDown(dialog, { key: "ArrowUp" });
    expect(firstOption).toHaveAttribute("aria-selected", "true");
  });

  it("navigates on Enter when result is selected", async () => {
    render(<GlobalSearch />);
    openPalette();

    const input = getSearchInput();
    fireEvent.change(input, { target: { value: "bill" } });

    await waitFor(() => {
      expect(screen.getByText("Electricity Bill Q4")).toBeInTheDocument();
    });

    const dialog = screen.getByRole("dialog");

    // Select first result
    fireEvent.keyDown(dialog, { key: "ArrowDown" });
    // Press Enter
    fireEvent.keyDown(dialog, { key: "Enter" });

    // finance has no `/finance/[id]` route, so we must NOT push a 404 deep link;
    // the clerk lands on the real module page instead.
    expect(mockPush).toHaveBeenCalledWith("/finance");
  });

  it("navigates on click", async () => {
    render(<GlobalSearch />);
    openPalette();

    const input = getSearchInput();
    fireEvent.change(input, { target: { value: "bill" } });

    await waitFor(() => {
      expect(screen.getByText("Office Supplies PO")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Office Supplies PO"));
    // procurement has no `/procurement/[id]` route -> land on the module page.
    expect(mockPush).toHaveBeenCalledWith("/procurement");
  });

  it("closes on backdrop click", () => {
    render(<GlobalSearch />);
    openPalette();
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    // Backdrop is the div with aria-hidden="true"
    const backdrop = screen.getByRole("dialog").parentElement!.querySelector("[aria-hidden='true']")!;
    fireEvent.click(backdrop);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("shows keyboard shortcut hints in footer", () => {
    render(<GlobalSearch />);
    openPalette();
    expect(screen.getByText("navigate")).toBeInTheDocument();
    expect(screen.getByText("open")).toBeInTheDocument();
    expect(screen.getByText("close")).toBeInTheDocument();
  });

  it("announces result count via live region for screen readers", async () => {
    render(<GlobalSearch />);
    openPalette();

    const input = getSearchInput();
    fireEvent.change(input, { target: { value: "bill" } });

    await waitFor(() => {
      expect(screen.getByText("2 results found")).toBeInTheDocument();
    });
  });

  it("uses combobox role with proper ARIA attributes", () => {
    render(<GlobalSearch />);
    openPalette();

    const input = getSearchInput();
    expect(input).toHaveAttribute("aria-autocomplete", "list");
    expect(input).toHaveAttribute("aria-controls", "search-results-list");
  });

  it("shows result count in footer when results are present", async () => {
    render(<GlobalSearch />);
    openPalette();

    const input = getSearchInput();
    fireEvent.change(input, { target: { value: "bill" } });

    await waitFor(() => {
      // Footer shows "2 results"
      expect(screen.getByText("2 results")).toBeInTheDocument();
    });
  });

  it("handles network errors gracefully", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("Network timeout"));

    render(<GlobalSearch />);
    openPalette();

    const input = getSearchInput();
    fireEvent.change(input, { target: { value: "test" } });

    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeInTheDocument();
      expect(screen.getByText("Unable to reach search service")).toBeInTheDocument();
    });
  });

  it("wraps arrow navigation (down from last goes to first)", async () => {
    render(<GlobalSearch />);
    openPalette();

    const input = getSearchInput();
    fireEvent.change(input, { target: { value: "bill" } });

    await waitFor(() => {
      expect(screen.getByText("Electricity Bill Q4")).toBeInTheDocument();
    });

    const dialog = screen.getByRole("dialog");

    // Go to first, second, then wrap to first
    fireEvent.keyDown(dialog, { key: "ArrowDown" }); // index 0
    fireEvent.keyDown(dialog, { key: "ArrowDown" }); // index 1
    fireEvent.keyDown(dialog, { key: "ArrowDown" }); // wraps to 0

    const firstOption = screen.getByText("Electricity Bill Q4").closest("[role='option']");
    expect(firstOption).toHaveAttribute("aria-selected", "true");
  });

  // ── Reachability guard (fails-before / passes-after) ─────────────────────
  // Before the fix, buildResultHref appended `/<id>` for EVERY module, so a
  // finance hit navigated to `/finance/bill-001` — a route that does not exist
  // (no `/finance/[id]`), i.e. global search dead-ended in a 404 for ~17 of 23
  // modules. These lock in that a result only deep-links when the detail route
  // exists, and otherwise resolves to the module's real landing page.
  it("deep-links only for a module that has a detail route", async () => {
    global.fetch = mockFetchResponse({
      data: [
        {
          id: "proj-42",
          module: "projects",
          name: "Rural Road Upgrade",
          refNumber: "PRJ-2024-042",
          description: null,
          status: "active",
          snippet: "Upgrade of rural connectivity corridor",
        },
      ],
      meta: { page: 1, pageSize: 20, total: 1 },
    });
    render(<GlobalSearch />);
    openPalette();
    fireEvent.change(getSearchInput(), { target: { value: "road" } });
    await waitFor(() => {
      expect(screen.getByText("Rural Road Upgrade")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText("Rural Road Upgrade"));
    expect(mockPush).toHaveBeenCalledWith("/projects/proj-42");
  });

  it("never navigates a result to a non-existent /<module>/<id> route", async () => {
    // finance, procurement, crm, billing, estab, … have no `[id]` child route.
    render(<GlobalSearch />);
    openPalette();
    fireEvent.change(getSearchInput(), { target: { value: "bill" } });
    await waitFor(() => {
      expect(screen.getByText("Electricity Bill Q4")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText("Electricity Bill Q4"));
    const pushed = mockPush.mock.calls.at(-1)?.[0] as string;
    // Must be the module landing page, not a fabricated detail deep link.
    expect(pushed).toBe("/finance");
    expect(pushed).not.toMatch(/\/finance\/.+/);
  });

  it("responds to voicenav:search custom event", async () => {
    render(<GlobalSearch />);

    act(() => {
      window.dispatchEvent(new CustomEvent("voicenav:search", { detail: "budget" }));
    });

    // Should open the dialog and set query
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(getSearchInput()).toHaveValue("budget");
  });
});
