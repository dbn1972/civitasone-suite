import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { GlobalSearch } from "./GlobalSearch";

describe("GlobalSearch", () => {
  it("renders nothing when closed", () => {
    const { container } = render(<GlobalSearch />);
    expect(container).toBeEmptyDOMElement();
  });

  it("opens on Ctrl+K keypress", () => {
    render(<GlobalSearch />);
    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true }));
    });
    expect(screen.getByLabelText("Global search")).toBeInTheDocument();
  });

  it("opens on Meta+K keypress", () => {
    render(<GlobalSearch />);
    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true }));
    });
    expect(screen.getByLabelText("Global search")).toBeInTheDocument();
  });

  it("closes on Escape keypress", () => {
    render(<GlobalSearch />);
    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true }));
    });
    expect(screen.getByLabelText("Global search")).toBeInTheDocument();
    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(screen.queryByLabelText("Global search")).not.toBeInTheDocument();
  });

  it("shows default results when query is empty", () => {
    render(<GlobalSearch />);
    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true }));
    });
    // Should show first 6 items from MODULES
    expect(screen.getByText("Budget Dashboard")).toBeInTheDocument();
  });

  it("filters results based on query", () => {
    render(<GlobalSearch />);
    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true }));
    });
    fireEvent.change(screen.getByLabelText("Global search"), { target: { value: "payroll" } });
    expect(screen.getByText("Payroll")).toBeInTheDocument();
    expect(screen.queryByText("Budget Dashboard")).not.toBeInTheDocument();
  });

  it("shows no results message for non-matching query", () => {
    render(<GlobalSearch />);
    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true }));
    });
    fireEvent.change(screen.getByLabelText("Global search"), { target: { value: "zzzznotfound" } });
    expect(screen.getByText(/No results found/)).toBeInTheDocument();
  });

  it("groups results by module", () => {
    render(<GlobalSearch />);
    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true }));
    });
    expect(screen.getByText("Finance")).toBeInTheDocument();
    expect(screen.getByText("HR")).toBeInTheDocument();
  });

  it("shows keyboard shortcut hints in footer", () => {
    render(<GlobalSearch />);
    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true }));
    });
    expect(screen.getByText("esc close")).toBeInTheDocument();
  });

  it("closes on backdrop click", () => {
    render(<GlobalSearch />);
    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true }));
    });
    // Backdrop is the first div inside the fixed container
    const backdrop = screen.getByLabelText("Global search").closest("[style*='fixed']")!.querySelector("[style*='absolute']")!;
    fireEvent.click(backdrop);
    expect(screen.queryByLabelText("Global search")).not.toBeInTheDocument();
  });
});
