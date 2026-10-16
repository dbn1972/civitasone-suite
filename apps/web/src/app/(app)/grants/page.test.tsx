import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("../../_components/ModuleHub", () => ({
  ModuleHub: ({ links }: { links: Array<{ label: string; href: string }> }) => (
    <ul>
      {links.map((l) => (
        <li key={l.href}>
          <a href={l.href}>{l.label}</a>
        </li>
      ))}
    </ul>
  ),
}));

import Page from "./page";

describe("Grants hub (GAP-GRANTS-HOME-01)", () => {
  // Given: the grants hub is rendered.
  // When: the user reads tile labels.
  // Then: each label matches its destination page's H1 exactly.
  it("uses 'Grant Schemes' for the schemes tile, matching /grants/schemes H1", () => {
    render(<Page />);
    const link = screen.getByRole("link", { name: "Grant Schemes" });
    expect(link).toHaveAttribute("href", "/grants/schemes");
  });

  it("uses 'Grant Installments' for the installments tile, matching /grants/installments H1", () => {
    render(<Page />);
    const link = screen.getByRole("link", { name: "Grant Installments" });
    expect(link).toHaveAttribute("href", "/grants/installments");
  });

  it("uses 'Grant Releases' for the releases tile, matching /grants/releases H1", () => {
    render(<Page />);
    const link = screen.getByRole("link", { name: "Grant Releases" });
    expect(link).toHaveAttribute("href", "/grants/releases");
  });

  it("uses the en-IN 'utilisation' spelling for the UC tile", () => {
    render(<Page />);
    const link = screen.getByRole("link", { name: "Utilisation Certificates" });
    expect(link).toHaveAttribute("href", "/grants/utilization");
  });

  it("lists tiles in lifecycle order (Schemes before Applications before Grants)", () => {
    render(<Page />);
    const links = screen.getAllByRole("link").map((el) => el.textContent ?? "");
    const schemesIdx = links.indexOf("Grant Schemes");
    const appIdx = links.indexOf("Grant Applications");
    const grantsIdx = links.indexOf("Grants");
    expect(schemesIdx).toBeLessThan(appIdx);
    expect(appIdx).toBeLessThan(grantsIdx);
  });
});
