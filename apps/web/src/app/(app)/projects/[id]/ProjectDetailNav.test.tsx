import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

// usePathname must be mocked before importing the component.
import { vi } from "vitest";

const mockPathname = vi.fn(() => "/projects/42");
vi.mock("next/navigation", () => ({
  usePathname: () => mockPathname(),
}));
vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    "aria-current": ariaCurrent,
  }: {
    href: string;
    children: React.ReactNode;
    "aria-current"?: React.AriaAttributes["aria-current"];
  }) => (
    <a href={href} aria-current={ariaCurrent}>
      {children}
    </a>
  ),
}));

import { ProjectDetailNav } from "./ProjectDetailNav";

/**
 * GAP-PROJECTS-DETAIL-06: route-based tabs must highlight the active sub-page.
 *
 * Given a project with id="42",
 * When the current pathname is each of the four tab routes,
 * Then exactly that tab has aria-current="page" and the others do not.
 */
describe("ProjectDetailNav", () => {
  const id = "42";

  it("marks Overview active on the project root path", () => {
    mockPathname.mockReturnValue("/projects/42");
    render(<ProjectDetailNav projectId={id} />);
    expect(screen.getByText("Overview").closest("a")).toHaveAttribute("aria-current", "page");
    expect(screen.getByText("Tasks").closest("a")).not.toHaveAttribute("aria-current");
    expect(screen.getByText("Team").closest("a")).not.toHaveAttribute("aria-current");
    expect(screen.getByText("Risks").closest("a")).not.toHaveAttribute("aria-current");
  });

  it("marks Tasks active on /projects/42/tasks", () => {
    mockPathname.mockReturnValue("/projects/42/tasks");
    render(<ProjectDetailNav projectId={id} />);
    expect(screen.getByText("Tasks").closest("a")).toHaveAttribute("aria-current", "page");
    expect(screen.getByText("Overview").closest("a")).not.toHaveAttribute("aria-current");
  });

  it("marks Team active on /projects/42/members", () => {
    mockPathname.mockReturnValue("/projects/42/members");
    render(<ProjectDetailNav projectId={id} />);
    expect(screen.getByText("Team").closest("a")).toHaveAttribute("aria-current", "page");
    expect(screen.getByText("Overview").closest("a")).not.toHaveAttribute("aria-current");
  });

  it("marks Risks active on /projects/42/risks", () => {
    mockPathname.mockReturnValue("/projects/42/risks");
    render(<ProjectDetailNav projectId={id} />);
    expect(screen.getByText("Risks").closest("a")).toHaveAttribute("aria-current", "page");
    expect(screen.getByText("Overview").closest("a")).not.toHaveAttribute("aria-current");
  });

  it("Overview is NOT active on a sub-route (tasks)", () => {
    mockPathname.mockReturnValue("/projects/42/tasks");
    render(<ProjectDetailNav projectId={id} />);
    const overview = screen.getByText("Overview").closest("a");
    expect(overview).not.toHaveAttribute("aria-current", "page");
  });
});
