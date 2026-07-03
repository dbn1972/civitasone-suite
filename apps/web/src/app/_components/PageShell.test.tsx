import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { PageShell } from "./PageShell";

describe("PageShell", () => {
  it("renders title and description", () => {
    render(
      <PageShell title="Finance" description="Manage budgets and payments">
        <p>content</p>
      </PageShell>,
    );
    expect(screen.getByRole("heading", { name: "Finance" })).toBeInTheDocument();
    expect(screen.getByText("Manage budgets and payments")).toBeInTheDocument();
  });

  it("renders children", () => {
    render(
      <PageShell title="Test" description="desc">
        <div>Child content</div>
      </PageShell>,
    );
    expect(screen.getByText("Child content")).toBeInTheDocument();
  });

  it("renders breadcrumb when provided", () => {
    render(
      <PageShell title="Bills" description="desc" breadcrumb={<span>Home / Finance / Bills</span>}>
        <p>body</p>
      </PageShell>,
    );
    expect(screen.getByText("Home / Finance / Bills")).toBeInTheDocument();
    expect(screen.getByLabelText("Breadcrumb")).toBeInTheDocument();
  });

  it("does not render breadcrumb nav when not provided", () => {
    render(
      <PageShell title="Bills" description="desc">
        <p>body</p>
      </PageShell>,
    );
    expect(screen.queryByLabelText("Breadcrumb")).not.toBeInTheDocument();
  });

  it("renders help link when help slug provided", () => {
    render(
      <PageShell title="Bills" description="desc" help="bills">
        <p>body</p>
      </PageShell>,
    );
    const link = screen.getByRole("link", { name: /how this works/i });
    expect(link).toHaveAttribute("href", "/help/bills");
  });
});
