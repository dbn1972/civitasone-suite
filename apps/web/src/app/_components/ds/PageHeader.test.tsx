import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { PageHeader } from "./PageHeader";
import { Term } from "./Term";

describe("PageHeader", () => {
  it("renders the title as an h1", () => {
    render(<PageHeader title="Finance Dashboard" />);
    expect(screen.getByRole("heading", { level: 1, name: "Finance Dashboard" })).toBeInTheDocument();
  });

  it("renders subtitle when provided", () => {
    render(<PageHeader title="Bills" subtitle="Manage all bills" />);
    expect(screen.getByText("Manage all bills")).toBeInTheDocument();
  });

  it("does not render subtitle when not provided", () => {
    const { container } = render(<PageHeader title="Bills" />);
    expect(container.querySelector(".sub")).not.toBeInTheDocument();
  });

  it("renders back link when back href is provided", () => {
    render(<PageHeader title="Detail" back="/list" />);
    expect(screen.getByRole("link", { name: "Back" })).toHaveAttribute("href", "/list");
  });

  it("renders custom back label", () => {
    render(<PageHeader title="Detail" back="/list" backLabel="Return to list" />);
    expect(screen.getByRole("link", { name: "Return to list" })).toBeInTheDocument();
  });

  it("renders actions node", () => {
    render(<PageHeader title="Bills" actions={<button>Add bill</button>} />);
    expect(screen.getByRole("button", { name: "Add bill" })).toBeInTheDocument();
  });

  it("renders help link when help slug is provided", () => {
    render(<PageHeader title="Bills" help="bills" />);
    const helpLink = screen.getByRole("link", { name: /how this works/i });
    expect(helpLink).toHaveAttribute("href", "/help/bills");
  });

  it("sets page heading id for aria-labelledby usage", () => {
    render(<PageHeader title="Overview" />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveAttribute("id", "page-heading");
  });

  // UX-007: title/subtitle accept ReactNode so a bare acronym in a page title
  // can carry a real, visible glossary "?" tooltip via the shared Term component,
  // instead of the glossary staying unused. This is additive — every existing
  // caller keeps passing plain strings and renders exactly as before (see the
  // string-based tests above, all still passing unchanged).
  it("renders a Term composed into the title with a working glossary tooltip", () => {
    render(
      <PageHeader
        title={
          <>
            Utilisation Certificates <Term name="UC" />
          </>
        }
      />,
    );
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Utilisation Certificates UC");
    const btn = screen.getByRole("button", { name: "What is UC?" });
    fireEvent.click(btn);
    expect(screen.getByRole("tooltip")).toHaveTextContent(/Utilisation Certificate/);
  });

  it("renders a Term composed into the subtitle", () => {
    render(
      <PageHeader
        title="Advances"
        subtitle={
          <>
            Money paid before a bill is complete <Term name="Advance" />
          </>
        }
      />,
    );
    expect(screen.getByRole("button", { name: "What is Advance?" })).toBeInTheDocument();
  });
});
