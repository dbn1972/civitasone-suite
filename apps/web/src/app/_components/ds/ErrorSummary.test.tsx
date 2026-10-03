import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ErrorSummary } from "./ErrorSummary";

describe("ErrorSummary (GOV.UK pattern)", () => {
  it("renders nothing when there is no message", () => {
    const { container } = render(<ErrorSummary error={{ message: "", fieldErrors: {} }} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("is an alert region, takes focus, and links each field message to its field", () => {
    render(
      <ErrorSummary
        locale="en"
        error={{
          message: "Some details need changing. Check the highlighted fields and try again.",
          fieldErrors: { name: "Enter a name", start: "Choose a start date" },
        }}
        fieldId={(f) => `leave-${f}`}
      />,
    );
    const box = screen.getByRole("alert");
    expect(box).toHaveFocus();
    expect(screen.getByRole("heading", { name: "There is a problem" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Enter a name" })).toHaveAttribute("href", "#leave-name");
    expect(screen.getByRole("link", { name: "Choose a start date" })).toHaveAttribute("href", "#leave-start");
  });

  it("shows the support reference as a quiet secondary line", () => {
    render(<ErrorSummary locale="en" error={{ message: "We couldn't connect.", reference: "req_9f2" }} />);
    expect(screen.getByText("Reference: req_9f2")).toBeInTheDocument();
  });

  it("renders in Hindi", () => {
    render(<ErrorSummary locale="hi" error={{ message: "संदेश" }} />);
    expect(screen.getByRole("heading", { name: "एक समस्या है" })).toBeInTheDocument();
  });

  it("gives each summary its own title id, so two on a page do not collide", () => {
    render(
      <>
        <ErrorSummary locale="en" error={{ message: "First" }} />
        <ErrorSummary locale="en" error={{ message: "Second" }} />
      </>,
    );
    const ids = screen.getAllByRole("heading", { name: "There is a problem" }).map((h) => h.id);
    expect(new Set(ids).size).toBe(2);
    expect(screen.getAllByRole("alert").map((a) => a.getAttribute("aria-labelledby"))).toEqual(ids);
  });
});
